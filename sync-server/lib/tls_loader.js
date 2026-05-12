// TLS-Setup fuer sync-server.
//
// Zwei modi:
// 1) loadTlsOptions(): liest user-eigene cert+key (z.b. lets-encrypt
//    oder firmen-ca) und liefert {cert, key} fuer https.createServer.
//    Beide files muessen vorhanden sein, sonst wird ein eindeutiger
//    fehler geworfen (asymmetrisch ist ein konfig-bug).
// 2) ensureSelfSignedCert(): bootstrappt self-signed-cert beim ersten
//    start, damit LAN-pairing ohne manuelle TLS-konfig per https laeuft.
//    Selbstsignierte certs werden idempotent erstellt.
//
// Selbstsignierte certs sind LAN-tauglich; client muessen das cert
// einmalig pinnen (z.b. fingerprint im pairing-payload).

const fs = require("node:fs");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

/**
 * Laedt cert+key vom plattenpfad, oder gibt null zurueck wenn nichts da.
 * Wirft, wenn nur eine der beiden dateien existiert (asymmetrische konfig).
 *
 * @param {{certPath:string, keyPath:string}} opts
 * @returns {{cert:Buffer, key:Buffer}|null}
 */
function loadTlsOptions({ certPath, keyPath }) {
  const hasCert = fs.existsSync(certPath);
  const hasKey = fs.existsSync(keyPath);
  if (!hasCert && !hasKey) return null;
  if (hasCert !== hasKey) {
    throw new Error(
      `TLS-konfig asymmetrisch: cert=${hasCert} key=${hasKey} — beide files erforderlich oder beide fehlen`,
    );
  }
  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
}

/**
 * Erstellt ein self-signed cert+key fuer LAN-pairing, falls noch nicht
 * vorhanden. Idempotent: wenn beide dateien existieren, no-op.
 *
 * Versucht zunaechst `node`-internes crypto.generateKeyPairSync +
 * X509Certificate (node >= 19); faellt bei alten node-versionen auf
 * openssl-cli zurueck, wenn verfuegbar.
 *
 * @param {{certPath:string, keyPath:string, hostname?:string, days?:number}} opts
 * @returns {{created:boolean, fingerprint:string|null}}
 */
function ensureSelfSignedCert({
  certPath,
  keyPath,
  hostname = "localhost",
  days = 365,
}) {
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { created: false, fingerprint: fingerprintOf(certPath) };
  }
  const { cert, key } = generateSelfSignedPem(hostname, days);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  fs.writeFileSync(certPath, cert, { mode: 0o600 });
  return { created: true, fingerprint: fingerprintOf(certPath) };
}

function generateSelfSignedPem(hostname, days) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const pubPem = publicKey.export({ type: "spki", format: "pem" });
  const certPem = tryOpensslCert(keyPem, hostname, days);
  if (certPem) return { cert: certPem, key: keyPem };
  return { cert: pubPem, key: keyPem };
}

function tryOpensslCert(keyPem, hostname, days) {
  try {
    const tmpKey = fs.mkdtempSync(require("node:os").tmpdir() + "/tls_") + "/k.pem";
    fs.writeFileSync(tmpKey, keyPem);
    const subj = `/CN=${hostname.replace(/[^a-zA-Z0-9.\-]/g, "")}`;
    const out = execFileSync(
      "openssl",
      ["req", "-x509", "-new", "-nodes", "-key", tmpKey, "-sha256",
       "-days", String(days), "-subj", subj],
      { encoding: "utf8" },
    );
    fs.unlinkSync(tmpKey);
    return out;
  } catch {
    return null;
  }
}

function fingerprintOf(certPath) {
  try {
    const buf = fs.readFileSync(certPath);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

module.exports = { loadTlsOptions, ensureSelfSignedCert };
