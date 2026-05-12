# ProjectGamma · Release

Projekt-Manager mit Cloud-Code-Integration. Mobile (Android) + Desktop (Browser) synchron.

## Quickstart Desktop

1. **Doppelklick** auf `Start ProjectGamma.bat`
2. Es öffnen sich 2 cmd-fenster (sync-server + frontend) + dein Browser
3. Fertig — du landest auf `http://localhost:7891`

Voraussetzungen:
- **Node.js** (https://nodejs.org/de/download) — pflicht
- **Python 3** ODER **npm/npx** für den frontend-server (eines reicht)

Wenn das erste mal gestartet wird, registrierst du dich im Browser über den
„🔐 account"-Button. Der ALLERERSTE registrierte User wird automatisch Owner
aller bestehenden Projekte.

## Quickstart Mobile

1. Übertrage `mobile/projectgamma.apk` aufs Android-Handy (USB, Mail, Cloud)
2. Tippe die APK an → install (evtl. „unbekannte quellen erlauben" zulassen)
3. App öffnen → 2 Wege:
   - **QR scannen**: Desktop → „+ handy verbinden" zeigt QR-code
   - **Mit account anmelden**: gleiche email/passwort wie auf desktop

## Verbinden ohne WLAN

Drei wege das phone an den PC zu binden — easy zu schwer:

| Methode | Setup | Funktioniert wenn… |
|---|---|---|
| **LAN** | beide im selben WLAN | normalfall |
| **USB-tunnel** | phone via USB-kabel + adb reverse | start.bat macht's automatisch |
| **Public-IP** | port 7892 im router freischalten | DSL-fritzbox „portforwarding" |

Der QR-code im pair-modal enthält **alle drei** routen — phone probiert
automatisch die erste die antwortet.

## Team-Collab

- **„👥 mitglieder"** → andere user per email einladen (`owner`/`member`/`viewer`)
- **„team"-tab** → chat, notizen, termine
- Bilder im chat: tippe das 📎-icon (mobile) bzw. das attachment-icon (desktop)

## Datenstand

Alle daten liegen in `sync-server/store.sqlite`. **NICHT** mit veröffentlichen
— enthält passwort-hashes, projekte, chats. Beim weitergeben des release-zips
diesen ordner leeren / löschen.

## Cloud-Code

Cloud-Code (Anthropic Claude CLI) installiert sich automatisch beim ersten
„auto-fix"-klick im settings-modal. Alternativ:
```
npm install -g @anthropic-ai/claude-code
claude login
```

API-keys (Anthropic / OpenAI / etc.) trägst du im settings-modal ein. Werden
serverseitig in `sync-server/user_settings.json` gespeichert und beim spawn
von claude+MCPs als env-vars injiziert.

## Onboarding-Doc

Siehe `docs/desktop_onboarding.md` für eine längere führung durch die 5 tabs.
