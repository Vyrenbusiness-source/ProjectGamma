# Mobile Auto-Update über Desktop-Server

## Ziel
Mobile-App empfängt neue APK-Versionen vom desktop sync-server auch ohne USB-Kabel (LAN/WiFi-Pfad). Bestehender USB-adb-Pfad in `server.js:1439-1538` bleibt unverändert.

## Architektur (feature-first, snake_case)

### sync-server
- **Neu:** `sync-server/lib/apk_update_store.js` (≤200 Z., node:test)
  - `getLatestApkMeta(mobileDir)` → `{version, sha256, size, mtime}` oder `null`
  - Pfad: `mobileDir/build/app/outputs/flutter-apk/app-debug.apk`
  - `assertSafeProjectPath` für mobileDir
- **server.js-Wiring** (additiv, kein Code in store):
  - `GET /api/projects/:id/updates/latest` → meta (auth: session-token)
  - `GET /api/projects/:id/updates/apk` → stream binary, rate-limited via `createClaimRateLimiter`-Pattern
  - Nach erfolgreichem `auto-rebuild apk` (Zeile ~1525): `broadcastPushNotification({type:'update_available', sha256, version})`

### mobile-app (Flutter)
- **Neu:** `mobile-app/lib/features/auto_update/`
  - `update_checker.dart` — pure-dart, kein Flutter-Import. Vergleicht `localSha256` ↔ `remoteSha256`.
  - `update_checker_test.dart` — TDD vor Implementation
  - `auto_update_panel.dart` — Widget mit Checkmark-Button. Respektiert `MediaQuery.disableAnimations`.
- **Trigger:** PUSH_NOTIFICATION-Inbox-Eintrag `update_available` öffnet Panel.
- **Install-Strategien (offen, user-Entscheidung):**
  - **A) PackageInstaller-Intent** (empfohlen) — `open_filex` + `REQUEST_INSTALL_PACKAGES`, user bestätigt OS-Dialog
  - **B) adb-over-WiFi** — silent, aber fragil (adb tcpip 5555 nötig)
  - **C) Download-only** — APK in Downloads/, user öffnet manuell

## Regel-Compliance
- `keine änderung ohne checkmark` → Install nur nach user-Tap
- `gerätelokale präferenzen nicht via sync_server` → "auto-check enabled" gehört in SharedPreferences, nicht in project-state
- `öffentliche unauthenticated endpoints rate-limited` → /updates/* mit Limiter
- `ki/heuristik-logik als pure-dart` → `update_checker.dart` ohne Flutter-Imports
- `bestehende state.json-einträge gelten als untrusted` → sha256 als Integritäts-Check vor Install

## TDD-Reihenfolge
1. `apk_update_store.test.js` (rote Tests)
2. `apk_update_store.js`
3. `update_checker_test.dart` (rote Tests)
4. `update_checker.dart`
5. server.js-Wiring (mit spawn_guard.test.js mitlaufen lassen)
6. UI-Panel + Inbox-Wiring

## Offener Entscheidungspunkt
Install-Modus A/B/C — blockiert Implementation bis user-checkmark.
