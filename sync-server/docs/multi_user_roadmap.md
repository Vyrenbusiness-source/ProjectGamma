# multi-user + live-collab roadmap

ziel: mehrere user können gleichzeitig live an einem projekt arbeiten
(mobile + desktop), regeln werden bei jeder mutation respektiert.

## drei schichten — niemals vermischen

1. **identity** — wer ist der user? (users_store.js, sessions)
2. **membership** — welche user dürfen welches projekt? (project_membership)
3. **presence** — wer schaut gerade wo hin? (flüchtig, ws-broadcast, NICHT persistent)

## rollout-reihenfolge (je ein PR, niemals bündeln)

- [x] schicht 1a: users_store.js + tests (fertig, 9 tests grün)
- [ ] schicht 1b: server.js-wiring — /api/auth/register, /api/auth/login,
      session-middleware. neues modul lib/auth_routes.js (<200 zeilen).
      vorbedingung für alles weitere.
- [ ] schicht 2: lib/project_membership.js — guard pro mutate-handler.
      deviceType allein reicht nicht mehr.
- [ ] schicht 3: invite-flow — projekt-owner generiert invite-token, neuer
      user redeemed → wird member.
- [ ] schicht 4: presence-broadcast — currentScreen, cursorTaskId per ws,
      KEINE persistenz in sqlite_store.
- [ ] schicht 5: ui-wiring mobile + desktop (avatars, "X bearbeitet gerade Y").

## live-collab-mechanik (schicht 4 detail)

- presence-channel = ws-room pro projektId
- jeder client sendet alle 5s PRESENCE_TICK {userId, screen, taskId}
- server merged in-memory map, broadcastet diff an room
- bei disconnect: tombstone nach 30s
- konflikte (zwei user editieren denselben task) → bestehender
  conflict_resolver_store-pfad greift, keine neue mechanik

## offene fragen

- e2e-crypto (payload_crypto.js) wiring vor oder nach schicht 1b?
  → vorschlag: parallel, da unabhängig
- multi-projekt-membership pro user (n:m) — ja, von anfang an als
  join-tabelle, nicht später nachrüsten
