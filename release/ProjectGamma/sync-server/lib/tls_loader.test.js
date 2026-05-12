const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadTlsOptions, ensureSelfSignedCert } = require("./tls_loader");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tls_loader_test_"));
}

test("loadTlsOptions: null wenn weder cert noch key existieren", () => {
  const dir = tmpDir();
  const res = loadTlsOptions({ certPath: path.join(dir, "c.pem"), keyPath: path.join(dir, "k.pem") });
  assert.equal(res, null);
});

test("loadTlsOptions: liefert {cert,key} wenn beide files vorhanden", () => {
  const dir = tmpDir();
  const cert = path.join(dir, "c.pem");
  const key = path.join(dir, "k.pem");
  fs.writeFileSync(cert, "CERT");
  fs.writeFileSync(key, "KEY");
  const res = loadTlsOptions({ certPath: cert, keyPath: key });
  assert.equal(res.cert.toString(), "CERT");
  assert.equal(res.key.toString(), "KEY");
});

test("loadTlsOptions: wirft bei nur key vorhanden (asymmetrisch)", () => {
  const dir = tmpDir();
  const cert = path.join(dir, "c.pem");
  const key = path.join(dir, "k.pem");
  fs.writeFileSync(key, "KEY");
  assert.throws(() => loadTlsOptions({ certPath: cert, keyPath: key }), /asymmetrisch|fehlt/);
});

test("ensureSelfSignedCert: erstellt cert+key wenn nicht vorhanden, idempotent", () => {
  const dir = tmpDir();
  const cert = path.join(dir, "c.pem");
  const key = path.join(dir, "k.pem");
  const a = ensureSelfSignedCert({ certPath: cert, keyPath: key, hostname: "localhost" });
  assert.equal(a.created, true);
  assert.ok(fs.existsSync(cert) && fs.existsSync(key));
  const certBefore = fs.readFileSync(cert);
  const b = ensureSelfSignedCert({ certPath: cert, keyPath: key, hostname: "localhost" });
  assert.equal(b.created, false);
  assert.deepEqual(fs.readFileSync(cert), certBefore);
});
