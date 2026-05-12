"use strict";
/**
 * lib/project_access.js
 * Multi-user schicht 2: filter + autorisierung pro session.
 *
 * Pure-helper, kein db-zugriff — bekommt die membership-funktionen als deps
 * (getRole/hasRole/listProjectsForUser) injiziert. So testbar ohne sqlite.
 *
 * Zwei kern-konzepte:
 *  - "pair-session" (deviceType !== 'user', kein userId): vollzugriff (legacy)
 *  - "user-session" (deviceType === 'user' bzw. session.userId gesetzt):
 *    sieht nur projekte, in denen sie mitglied ist; schreibt nur wenn role >= MEMBER.
 */

const { ROLES } = require("./project_membership");

/** Schreib-mutations brauchen mindestens MEMBER-rolle. */
const WRITE_MUTATIONS = new Set([
  "PATCH_PROJECT", "REMOVE_PROJECT", "TOGGLE_STAR",
  "ADD_TASK", "SET_TASK_PRIORITY", "MOVE_TASK_PRIORITY", "TOGGLE_TASK",
  "REMOVE_TASK", "EDIT_TASK",
  "ADD_SUBTASK", "TOGGLE_SUBTASK", "REMOVE_SUBTASK",
  "ADD_RULE", "TOGGLE_RULE", "REMOVE_RULE", "EDIT_RULE",
  "ENQUEUE_RULE_DIFFS", "APPROVE_RULE_DIFF", "REJECT_RULE_DIFF",
  "ADD_IDEA", "CONVERT_IDEA", "DISMISS_IDEA", "REACTIVATE_IDEA",
  "REMOVE_IDEA", "EDIT_IDEA",
  "SET_GOALS", "SET_FILES",
  "ADD_ACTIVITY", "CLEAR_ACTIVITY",
  "ADD_SUGGESTION", "SET_SUGGESTION_STATUS", "REMOVE_SUGGESTION",
  "ADD_BUG", "SET_BUG_STATUS", "REMOVE_BUG", "TOGGLE_BUG_AUTO_FIX",
  // team-collab
  "ADD_MESSAGE", "REMOVE_MESSAGE",
  "ADD_NOTE", "EDIT_NOTE", "REMOVE_NOTE",
  "ADD_APPOINTMENT", "EDIT_APPOINTMENT", "REMOVE_APPOINTMENT", "TOGGLE_APPOINTMENT_RSVP",
]);

/** Globale mutations (kein projectId-bezug). Brauchen nur auth, keine rolle. */
const GLOBAL_MUTATIONS = new Set([
  "ADD_PROJECT", "ADD_SYNC_LOG", "CLEAR_SYNC_LOG", "DO_SYNC", "TOGGLE_CC",
]);

function isUserSession(session) {
  return !!(session && session.userId);
}

/**
 * Liefert eine project-id-set, das die session sehen darf.
 * Pair-sessions sehen alle (legacy) — wir geben null zurück als „all access".
 */
function allowedProjectIds(session, deps) {
  if (!isUserSession(session)) return null; // null = alle erlaubt
  const list = deps.listProjectsForUser(session.userId) || [];
  return new Set(list.map((m) => m.projectId));
}

/**
 * Filtert `state.projects` für eine session. Liefert IMMER ein neues object,
 * damit der ws-broadcast pro client unabhängig serialisiert.
 */
function filterStateForSession(state, session, deps) {
  if (!state) return state;
  const allowed = allowedProjectIds(session, deps);
  if (allowed === null) return state; // pair-session: keine filterung
  const projects = (state.projects || []).filter((p) => allowed.has(p.id));
  return { ...state, projects };
}

/**
 * Prüft, ob die session die mutation ausführen darf.
 * @returns {{ok:true} | {ok:false, reason:string, status:number}}
 */
function checkMutationAccess(mutationType, payload, session, deps) {
  if (!mutationType) return { ok: false, reason: "type fehlt", status: 400 };
  // Pair-sessions: legacy vollzugriff
  if (!isUserSession(session)) return { ok: true };

  // Globale mutations: jede authentifizierte session
  if (GLOBAL_MUTATIONS.has(mutationType)) return { ok: true };

  // Lese-only mutation? (alle die nicht in WRITE_MUTATIONS sind und auch nicht GLOBAL)
  // → behandeln wir konservativ: write-pflicht.
  const projectId = payload && payload.projectId;
  if (!projectId) {
    // Mutation hat keinen projectId — wir kennen sie nicht in der whitelist.
    // Default-policy: erlauben, wenn type nicht in WRITE_MUTATIONS steht,
    // sonst ablehnen. Beim aktuellen mutation-set greift das nur für unbekannte.
    if (WRITE_MUTATIONS.has(mutationType)) {
      return { ok: false, reason: "mutation braucht projectId", status: 400 };
    }
    return { ok: true };
  }

  // Project-scoped: mindestens MEMBER-rolle erforderlich
  const allowed = deps.hasRole(projectId, session.userId, ROLES.MEMBER);
  if (!allowed) {
    return { ok: false, reason: "keine berechtigung für projekt " + projectId, status: 403 };
  }
  return { ok: true };
}

module.exports = {
  WRITE_MUTATIONS,
  GLOBAL_MUTATIONS,
  isUserSession,
  allowedProjectIds,
  filterStateForSession,
  checkMutationAccess,
};
