// TLS-Bootstrap fuer sync-server.
//
// Vereint loadTlsOptions + ensureSelfSignedCert zu einem aufruf, den
// server.js beim boot benutzt. Liefert {mode, httpsOptions, fingerprint},
// wobei fingerprint im pairing-payload mitgeschickt wird (cert-pinning).
//
// modi:
//   off          -> kein TLS (clear http, kompatibel zum bisherigen flow)
//   user         -> cert.pem/key.pem im dir liegen bereits (z.b. lets-encrypt)
//   self-signed  -> beim ersten start automatisch erzeugt (LAN-pairing)

const fs = require("node:fs");
const path = require("node:path");
const { loadTlsOptions, ensureSelfSignedCert } = require("./tls_loader");

const CERT_NAME = "cert.pem";
const KEY_NAME = "key.pem";

/**
 * Bootstrap-Helper fuer TLS.
 *
 * @param {{enabled:boolean, dir:string, hostname?:string}} opts
 * @returns {{mode:'off'|'user'|'self-signed', httpsOptions:object|null, fingerprint:string|null}}
 */
function bootstrapTls({ enabled, dir, hostname = "localhost" }) {
  if (!enabled) return { mode: "off", httpsOptions: null, fingerprint: null };
  fs.mkdirSync(dir, { recursive: true });
  const certPath = path.join(dir, CERT_NAME);
  const keyPath = path.join(dir, KEY_NAME);
  const userOpts = loadTlsOptions({ certPath, keyPath });
  if (userOpts) {
    return {
      mode: "user",
      httpsOptions: userOpts,
      fingerprint: fingerprintOf(certPath),
    };
  }
  ensureSelfSignedCert({ certPath, keyPath, hostname });
  return {
    mode: "self-signed",
    httpsOptions: {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    },
    fingerprint: fingerprintOf(certPath),
  };
}

function fingerprintOf(certPath) {
  const crypto = require("node:crypto");
  const buf = fs.readFileSync(certPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

module.exports = { bootstrapTls };
