"use strict";
/**
 * lib/users_store.js
 * Multi-user schicht 1: identitaet (users) + session-tokens.
 * Nur dieses modul darf users/sessions-tabellen anfassen (analog sqlite_store-regel).
 *
 * Oeffentliche API:
 *   createUsersStore({ db }) -> store
 *     store.registerUser({ email, passwordHash }) -> { id, email, createdAt }
 *     store.findUserByEmail(email)                -> user | null
 *     store.findUserById(id)                      -> user | null
 *     store.createSession({ userId, ttlMs })      -> { token, userId, expiresAt }
 *     store.resolveSession(token)                 -> { userId, expiresAt } | null
 *     store.revokeSession(token)                  -> void
 *     store.purgeExpired(nowMs)                   -> number (removed count)
 *
 * Hinweis: passwordHash wird hier nicht verifiziert/erzeugt — der aufrufer
 * muss bcrypt/scrypt vorher anwenden (trennung domain<->infra). Email wird
 * lower-cased fuer eindeutigkeit.
 */

const crypto = require("node:crypto");

const TOKEN_BYTES = 24; // 192 bit, base64url ~ 32 zeichen

function createUsersStore({ db }) {
  if (!db || typeof db.exec !== "function") {
    throw new Error("createUsersStore: 'db' (DatabaseSync) erforderlich");
  }

  db.exec(
    "CREATE TABLE IF NOT EXISTS users (" +
      "  id TEXT PRIMARY KEY," +
      "  email TEXT NOT NULL UNIQUE," +
      "  password_hash TEXT NOT NULL," +
      "  created_at INTEGER NOT NULL" +
      ");"
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS user_sessions (" +
      "  token TEXT PRIMARY KEY," +
      "  user_id TEXT NOT NULL," +
      "  expires_at INTEGER NOT NULL," +
      "  created_at INTEGER NOT NULL," +
      "  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE" +
      ");"
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);");

  const insert_user = db.prepare(
    "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)"
  );
  const select_user_by_email = db.prepare(
    "SELECT id, email, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE email = ?"
  );
  const select_user_by_id = db.prepare(
    "SELECT id, email, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE id = ?"
  );
  const insert_session = db.prepare(
    "INSERT INTO user_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  );
  const select_session = db.prepare(
    "SELECT token, user_id AS userId, expires_at AS expiresAt FROM user_sessions WHERE token = ?"
  );
  const delete_session = db.prepare("DELETE FROM user_sessions WHERE token = ?");
  const delete_expired = db.prepare("DELETE FROM user_sessions WHERE expires_at <= ?");

  function normalizeEmail(email) {
    if (!email || typeof email !== "string") {
      throw new Error("registerUser: 'email' erforderlich");
    }
    return email.trim().toLowerCase();
  }

  function registerUser({ email, passwordHash }) {
    const normalized = normalizeEmail(email);
    if (!passwordHash || typeof passwordHash !== "string") {
      throw new Error("registerUser: 'passwordHash' erforderlich");
    }
    if (select_user_by_email.get(normalized)) {
      throw new Error("registerUser: user already exists for email " + normalized);
    }
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    insert_user.run(id, normalized, passwordHash, createdAt);
    return { id, email: normalized, createdAt };
  }

  function findUserByEmail(email) {
    if (!email) return null;
    return select_user_by_email.get(String(email).trim().toLowerCase()) || null;
  }

  function findUserById(id) {
    if (!id) return null;
    return select_user_by_id.get(String(id)) || null;
  }

  function createSession({ userId, ttlMs }) {
    if (!findUserById(userId)) {
      throw new Error("createSession: unknown user " + userId);
    }
    if (typeof ttlMs !== "number") {
      throw new Error("createSession: 'ttlMs' (number) erforderlich");
    }
    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const now = Date.now();
    const expiresAt = now + ttlMs;
    insert_session.run(token, userId, expiresAt, now);
    return { token, userId, expiresAt };
  }

  function resolveSession(token) {
    if (!token || typeof token !== "string") return null;
    const row = select_session.get(token);
    if (!row) return null;
    if (row.expiresAt <= Date.now()) return null;
    return { userId: row.userId, expiresAt: row.expiresAt };
  }

  function revokeSession(token) {
    if (!token) return;
    delete_session.run(String(token));
  }

  function purgeExpired(nowMs) {
    const cutoff = typeof nowMs === "number" ? nowMs : Date.now();
    const info = delete_expired.run(cutoff);
    return Number(info.changes || 0);
  }

  return {
    registerUser,
    findUserByEmail,
    findUserById,
    createSession,
    resolveSession,
    revokeSession,
    purgeExpired,
  };
}

module.exports = { createUsersStore };
