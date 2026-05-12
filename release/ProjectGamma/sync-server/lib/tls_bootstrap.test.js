const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bootstrapTls } = require("./tls_bootstrap");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tls_bootstrap_test_"));
}

test("bootstrapTls: mode='off' wenn enabled=false", () => {
  const r = bootstrapTls({ enabled: false, dir: tmpDir() });
  assert.equal(r.mode, "off");
  assert.equal(r.httpsOptions, null);
  assert.equal(r.fingerprint, null);
});

test("bootstrapTls: erzeugt self-signed cert + fingerprint wenn enabled=true ohne user-cert", () => {
  const dir = tmpDir();
  const r = bootstrapTls({ enabled: true, dir, hostname: "localhost" });
  assert.equal(r.mode, "self-signed");
  assert.ok(r.httpsOptions && r.httpsOptions.cert && r.httpsOptions.key);
  assert.match(r.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(fs.existsSync(path.join(dir, "cert.pem")));
  assert.ok(fs.existsSync(path.join(dir, "key.pem")));
});

test("bootstrapTls: lädt user-cert wenn vorhanden (mode='user')", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "cert.pem"), "USER_CERT");
  fs.writeFileSync(path.join(dir, "key.pem"), "USER_KEY");
  const r = bootstrapTls({ enabled: true, dir });
  assert.equal(r.mode, "user");
  assert.equal(r.httpsOptions.cert.toString(), "USER_CERT");
  assert.match(r.fingerprint, /^[a-f0-9]{64}$/);
});

test("bootstrapTls: idempotent — zweiter call mit gleichem dir liefert gleichen fingerprint", () => {
  const dir = tmpDir();
  const a = bootstrapTls({ enabled: true, dir });
  const b = bootstrapTls({ enabled: true, dir });
  assert.equal(a.fingerprint, b.fingerprint);
});
