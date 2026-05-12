// E2E-Verschluesselung der Sync-Payloads (AES-256-GCM).
//
// Modell: pro Projekt gibt es ein gemeinsames Geheimnis (vom user
// beim pairing eingerichtet), aus dem via scryptSync ein 32-byte-key
// abgeleitet wird. Sender (mobile/desktop) verschluesselt JSON-payloads
// bevor sie ueber WS/HTTP gehen; Empfaenger entschluesselt mit demselben
// abgeleiteten key. Der server kann mit-entschluesseln, wenn ihm das
// secret bekannt ist, sonst speichert er nur den envelope (true e2e).
//
// Envelope-format: { v:1, iv:<b64>, ct:<b64>, tag:<b64> }
//   - v: schema-version (zukunfts-migration)
//   - iv: 12 byte random nonce (GCM-empfehlung)
//   - ct: ciphertext (base64)
//   - tag: 16 byte GCM-auth-tag (base64) — verhindert tampering

const crypto = require("node:crypto");

const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SCRYPT_COST = 1 << 14; // N=16384, ~64MB, ausreichend gegen offline-brute

/**
 * Leitet einen 32-byte AES-key aus secret+salt ab (scryptSync, deterministisch).
 * @param {string} secret  vom user gewaehltes projekt-passwort
 * @param {string} salt    stabiler salt pro projekt (z.b. projectId)
 * @returns {Buffer}
 */
function deriveProjectKey(secret, salt) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("deriveProjectKey: secret muss nicht-leer string sein");
  }
  if (typeof salt !== "string" || salt.length === 0) {
    throw new Error("deriveProjectKey: salt muss nicht-leer string sein");
  }
  return crypto.scryptSync(secret, salt, KEY_BYTES, { N: SCRYPT_COST });
}

/**
 * Verschluesselt ein beliebiges JSON-serialisierbares objekt.
 * @param {Buffer} key 32 byte key (aus deriveProjectKey)
 * @param {unknown} payload
 * @returns {{v:number, iv:string, ct:string, tag:string}}
 */
function encryptPayload(key, payload) {
  assertKey(key);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify(payload), "utf8");
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: ENVELOPE_VERSION,
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/**
 * Entschluesselt envelope, wirft bei key-mismatch oder tampering.
 * @param {Buffer} key
 * @param {{v:number, iv:string, ct:string, tag:string}} env
 * @returns {unknown}
 */
function decryptPayload(key, env) {
  assertKey(key);
  if (!isEncryptedEnvelope(env)) {
    throw new Error("decryptPayload: kein gueltiger envelope");
  }
  if (env.v !== ENVELOPE_VERSION) {
    throw new Error(`decryptPayload: unbekannte envelope-version ${env.v}`);
  }
  const iv = Buffer.from(env.iv, "base64");
  const ct = Buffer.from(env.ct, "base64");
  const tag = Buffer.from(env.tag, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

function isEncryptedEnvelope(value) {
  return (
    !!value &&
    typeof value === "object" &&
    typeof value.v === "number" &&
    typeof value.iv === "string" &&
    typeof value.ct === "string" &&
    typeof value.tag === "string"
  );
}

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new Error(`key muss Buffer mit ${KEY_BYTES} bytes sein`);
  }
}

module.exports = {
  deriveProjectKey,
  encryptPayload,
  decryptPayload,
  isEncryptedEnvelope,
  ENVELOPE_VERSION,
};
