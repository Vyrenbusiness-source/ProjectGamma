# multi_user_collab — konzept (entwurf, nicht implementiert)

> regel "keine änderung ohne checkmark" → dieses dokument ist nur vorschlag.
> bestehender stand: device-pairing (1 user, n geräte). echtes multi-user fehlt.

## ziel
mehrere user (nicht nur geräte eines users) arbeiten gleichzeitig an demselben
projekt: tasks/ideas, rule_diffs, conflict-resolve. live-presence sichtbar.

## annahmen / offene fragen
- vertrauensmodell: nur LAN (host trusted) oder remote-fähig (auth pflicht)?
- identität: account+passwort, oder magic-link/qr-invite analog pair_qr?
- konfliktstrategie: bleibt project.conflicts (gerätesynchron) oder pro-user?
- gerätelokale präferenzen-regel bleibt: theme/ui-state weiter NICHT spiegeln.

## bausteine (alle als isolierte snake_case-module, je <200 zeilen, tdd)

1. **sync-server/lib/user_store.js** — users{id,displayName,authHash,role},
   invites{token,projectId,role,exp}. node:sqlite via sqlite_store.
2. **sync-server/lib/auth_login.js** — POST /api/login (rate-limited wie claim),
   POST /api/invite/accept. session bekommt userId zusätzlich zu deviceType.
3. **sync-server/lib/project_membership.js** — projects.members[{userId,role}].
   alle mutate-handler gaten an membership, nicht nur an pair-token.
4. **sync-server/lib/presence_registry.js** — pro ws-connection {userId,
   currentScreen, cursorTaskId, lastPing}. broadcast PRESENCE_UPDATE bei join/
   leave/screen-wechsel. flüchtig, keine persistenz.
5. **mobile-app/lib/features/presence/** + **desktop-app/presence_panel.jsx** —
   avatar-stack oben rechts, hover/tap zeigt "user X liest tasks".
6. **invite-flow** — host generiert invite-token (qr+code, analog pair_qr),
   neuer user scannt → auth_login.acceptInvite → membership-eintrag.
7. **mutate-attribution** — jede mutation bekommt actorUserId; activity-feed
   zeigt "alex hat task X erledigt" statt nur device.

## reihenfolge (jeweils einzeln vom user per checkmark zu bestätigen)
1) user_store + tests   2) auth_login + rate-limit + tests
3) project_membership + gating in server.js (regression-tests!)
4) presence_registry + ws-broadcast   5) UI presence (mobile+desktop parallel)
6) invite-flow ui + qr   7) mutate-attribution + activity-rendering

## risiken
- bestehende deviceType-rollen-regel: muss um userId-rolle ergänzt werden,
  nicht ersetzt — defense-in-depth bleibt.
- offline_queue + multi-user → konflikte häufiger. evtl. CRDT für notes-text
  später. zunächst LWW pro feld reicht.
- rate-limit auf /api/login + /api/invite/accept zwingend (regel: öffentliche
  unauth endpoints rate-limited).
