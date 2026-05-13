"use strict";
/**
 * lib/project_membership.js
 * Multi-user schicht 2: n:m join projects <-> users mit rolle.
 * Nur dieses modul darf project_members-tabelle anfassen.
 *
 * Oeffentliche API:
 *   createProjectMembershipStore({ db }) -> store
 *     store.addMember({ projectId, userId, role, addedBy }) -> { projectId, userId, role, addedAt, addedBy }
 *     store.removeMember(projectId, userId)                 -> void
 *     store.listMembers(projectId)                          -> [{ userId, role, addedAt, addedBy }]
 *     store.listProjectsForUser(userId)                     -> [{ projectId, role, addedAt }]
 *     store.getRole(projectId, userId)                      -> role | null
 *     store.hasRole(projectId, userId, minRole)             -> boolean
 *
 *   ROLES: { OWNER, MEMBER, VIEWER } — string-enum, owner > member > viewer.
 *
 * Hinweis: identitaet (users) wird ausschliesslich von users_store gepflegt;
 * dieser store referenziert nur user.id per FK.
 */

const ROLES = Object.freeze({ OWNER: "owner", MEMBER: "member", VIEWER: "viewer" });
const ROLE_RANK = Object.freeze({ owner: 3, member: 2, viewer: 1 });

function assertValidRole(role) {
  if (!ROLE_RANK[role]) {
    throw new Error("project_membership: ungueltige role '" + role + "'");
  }
}

function createProjectMembershipStore({ db }) {
  if (!db || typeof db.exec !== "function") {
    throw new Error("createProjectMembershipStore: 'db' (DatabaseSync) erforderlich");
  }

  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS project_members (" +
      "  project_id TEXT NOT NULL," +
      "  user_id TEXT NOT NULL," +
      "  role TEXT NOT NULL," +
      "  added_at INTEGER NOT NULL," +
      "  added_by TEXT," +
      "  PRIMARY KEY(project_id, user_id)," +
      "  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE" +
      ");"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);"
  );
  // Pending-invites: owner kann auf vorrat einladen, bevor der user
  // registriert ist. Bei /api/auth/register wird claimPendingForEmail
  // aufgerufen → invites werden als memberships übernommen + gelöscht.
  // Löst das "user nicht gefunden"-problem im invite-flow.
  db.exec(
    "CREATE TABLE IF NOT EXISTS pending_invites (" +
      "  email TEXT NOT NULL," +
      "  project_id TEXT NOT NULL," +
      "  role TEXT NOT NULL," +
      "  added_at INTEGER NOT NULL," +
      "  added_by TEXT," +
      "  PRIMARY KEY(email, project_id)" +
      ");"
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_pending_invites_email ON pending_invites(email);");

  const upsert = db.prepare(
    "INSERT INTO project_members (project_id, user_id, role, added_at, added_by) " +
      "VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role"
  );
  const remove = db.prepare(
    "DELETE FROM project_members WHERE project_id = ? AND user_id = ?"
  );
  const select_by_project = db.prepare(
    "SELECT user_id AS userId, role, added_at AS addedAt, added_by AS addedBy " +
      "FROM project_members WHERE project_id = ? ORDER BY added_at ASC"
  );
  const select_by_user = db.prepare(
    "SELECT project_id AS projectId, role, added_at AS addedAt " +
      "FROM project_members WHERE user_id = ? ORDER BY added_at ASC"
  );
  const select_role = db.prepare(
    "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?"
  );
  const upsert_pending = db.prepare(
    "INSERT INTO pending_invites (email, project_id, role, added_at, added_by) " +
      "VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(email, project_id) DO UPDATE SET role = excluded.role"
  );
  const select_pending_by_project = db.prepare(
    "SELECT email, role, added_at AS addedAt, added_by AS addedBy " +
      "FROM pending_invites WHERE project_id = ? ORDER BY added_at ASC"
  );
  const select_pending_by_email = db.prepare(
    "SELECT email, project_id AS projectId, role, added_at AS addedAt, added_by AS addedBy " +
      "FROM pending_invites WHERE email = ?"
  );
  const delete_pending = db.prepare(
    "DELETE FROM pending_invites WHERE email = ? AND project_id = ?"
  );
  const delete_pending_email = db.prepare("DELETE FROM pending_invites WHERE email = ?");

  function addMember({ projectId, userId, role, addedBy }) {
    if (!projectId || typeof projectId !== "string") {
      throw new Error("addMember: 'projectId' erforderlich");
    }
    if (!userId || typeof userId !== "string") {
      throw new Error("addMember: 'userId' erforderlich");
    }
    assertValidRole(role);
    const addedAt = Date.now();
    try {
      upsert.run(projectId, userId, role, addedAt, addedBy || null);
    } catch (err) {
      if (/FOREIGN KEY|foreign key/i.test(String(err && err.message))) {
        throw new Error("addMember: unknown user " + userId);
      }
      throw err;
    }
    return { projectId, userId, role, addedAt, addedBy: addedBy || null };
  }

  function removeMember(projectId, userId) {
    if (!projectId || !userId) return;
    remove.run(String(projectId), String(userId));
  }

  function listMembers(projectId) {
    if (!projectId) return [];
    return select_by_project.all(String(projectId));
  }

  function listProjectsForUser(userId) {
    if (!userId) return [];
    return select_by_user.all(String(userId));
  }

  function getRole(projectId, userId) {
    if (!projectId || !userId) return null;
    const row = select_role.get(String(projectId), String(userId));
    return row ? row.role : null;
  }

  function hasRole(projectId, userId, minRole) {
    assertValidRole(minRole);
    const role = getRole(projectId, userId);
    if (!role) return false;
    return ROLE_RANK[role] >= ROLE_RANK[minRole];
  }

  function _normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function addPendingInvite({ projectId, email, role, addedBy }) {
    if (!projectId) throw new Error("addPendingInvite: 'projectId' erforderlich");
    const normalized = _normalizeEmail(email);
    if (!normalized || !/@/.test(normalized)) {
      throw new Error("addPendingInvite: 'email' erforderlich");
    }
    assertValidRole(role);
    const addedAt = Date.now();
    upsert_pending.run(normalized, projectId, role, addedAt, addedBy || null);
    return { email: normalized, projectId, role, addedAt, addedBy: addedBy || null };
  }

  function listPendingForProject(projectId) {
    if (!projectId) return [];
    return select_pending_by_project.all(String(projectId));
  }

  function removePendingInvite(projectId, email) {
    if (!projectId || !email) return;
    delete_pending.run(_normalizeEmail(email), String(projectId));
  }

  // Wird beim register() aufgerufen — alle pending-invites für diese email
  // werden zu memberships, dann gelöscht. Idempotent: doppelte addMember per
  // upsert ist no-op.
  function claimPendingForEmail(email, userId) {
    const normalized = _normalizeEmail(email);
    if (!normalized || !userId) return [];
    const rows = select_pending_by_email.all(normalized);
    const claimed = [];
    for (const row of rows) {
      try {
        const m = addMember({
          projectId: row.projectId, userId, role: row.role, addedBy: row.addedBy,
        });
        claimed.push(m);
      } catch (e) {
        // FK-fehler etc. — skip, weiter mit nächstem
        continue;
      }
    }
    if (claimed.length > 0) delete_pending_email.run(normalized);
    return claimed;
  }

  return {
    addMember, removeMember, listMembers, listProjectsForUser, getRole, hasRole,
    addPendingInvite, listPendingForProject, removePendingInvite, claimPendingForEmail,
  };
}

module.exports = { createProjectMembershipStore, ROLES };
