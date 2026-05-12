// Tests für pair_qr (node:test, keine extra-deps).
// Lädt das Modul im Node-Context — `toQrSvg` wird hier NICHT getestet
// (braucht das CDN-`qrcode`-Global und einen Browser-Kontext).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildPairQrPayload } = require("./pair_qr");

test("baut payload mit host, port, code", () => {
  const out = buildPairQrPayload({ host: "192.168.1.20", port: 5077, code: "ABC123" });
  assert.equal(out, "pgamma://pair?host=192.168.1.20&port=5077&code=ABC123");
});

test("encodiert host und code url-safe", () => {
  const out = buildPairQrPayload({ host: "fe80::1%25eth0", port: 80, code: "X Y" });
  assert.match(out, /^pgamma:\/\/pair\?host=fe80%3A%3A1%2525eth0&port=80&code=X%20Y$/);
});

test("wirft bei fehlenden pflichtfeldern", () => {
  assert.throws(() => buildPairQrPayload({ host: "", port: 80, code: "A" }), /host/);
  assert.throws(() => buildPairQrPayload({ host: "h", port: 0, code: "A" }), /port/);
  assert.throws(() => buildPairQrPayload({ host: "h", port: 80, code: "" }), /code/);
});

test("port wird zu integer-string normalisiert", () => {
  const out = buildPairQrPayload({ host: "h", port: "5077", code: "C" });
  assert.match(out, /port=5077/);
  assert.throws(() => buildPairQrPayload({ host: "h", port: "abc", code: "C" }), /port/);
});
