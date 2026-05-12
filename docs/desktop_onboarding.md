# Desktop · erste schritte

Ein 5-minuten-rundgang durch ProjectGamma am PC. Voraussetzung: du hast den
sync-server und die desktop-app gestartet (entweder per `start.bat` im
projekt-root, oder manuell).

---

## 1. server + browser starten

```
doppelklick auf start.bat
```

Das öffnet 2 fenster:

- **Sync-Server** (Port 7892) — die zentrale db, läuft im hintergrund
- **Desktop-Server** (Port 7891) — liefert das frontend an deinen browser

Browser geht automatisch auf `http://localhost:7891/index.html`.

**Was du auf dem Desktop-Server-Fenster sehen solltest:**

```
┌─ ProjectGamma Sync-Server ───────────────────────
│  TLS: off
│  http://localhost:7892
│  http://192.168.x.x:7892  (LAN)   ← die brauchst du fürs handy
│  ws://...:7892/ws?token=...
│  projects: 1  sessions: …
└──────────────────────────────────────────────────
```

Schließ die fenster NICHT — solange sie laufen, läuft die app.

---

## 2. das hauptfenster verstehen

Oben in der titel-leiste eines projekts findest du die action-buttons:

| Button | Was er macht |
|---|---|
| **öffnen in IDE** | startet vscode mit dem projekt-pfad |
| **export** | lädt alle daten als json runter (backup) |
| **↻ sync** | macht einen sync-tick — selten manuell nötig |
| **+ handy verbinden** | zeigt einen 6-stelligen pairing-code + QR |
| **👥 mitglieder** | rollen-management (siehe unten) |
| **🔐 account** | login / register mit email + passwort |
| **löschen** | projekt entfernen (⚠️ unwiderruflich) |

Darunter sind die **5 tabs**:

- **übersicht** — stats + nächste aufgabe + cloud-code-status
- **aufgaben** — todo-liste, priorisierung per pfeil ↑/↓
- **regeln** — projekt-spezifische guardrails, cloud-code respektiert sie
- **ideen** — quick-capture-inbox (auch vom handy)
- **cloud-code** — start/stop, output-stream, vorschläge, bug-hunt

---

## 3. die zwei verbindungs-modi

Du kannst auf zwei wegen einsteigen — wähle einen:

### a) device-pairing (legacy, einfach)

Wenn du **alleine** arbeitest oder das handy einmalig anlernen willst:

1. Klick „+ handy verbinden" → 6-stelliger code erscheint
2. Auf dem handy: app öffnen → QR scannen oder code eintippen
3. Phone ist verbunden, kein passwort nötig

**Wichtig:** pair-tokens sind „legacy-vollzugriff" — jeder mit token sieht
alles und darf alles. Für mehrere personen → variante b nutzen.

### b) account-login (multi-user, mit rollen)

Wenn **mehrere personen** am selben projekt arbeiten:

1. Klick „🔐 account" → tab „registrieren" → email + min. 8 zeichen passwort
2. **wichtig:** der allererste account, der je registriert wird, bekommt
   automatisch OWNER auf alle bestehenden projekte
3. Klick „👥 mitglieder" → siehst dich selbst als owner
4. „+ mitglied einladen" → email des kollegen + rolle (owner/member/viewer)
5. Kollege registriert sich auf seinem desktop oder handy → sieht das projekt sofort

**Rollen kurzform:**

- **owner** — alles, inkl. mitglieder ein-/aussortieren
- **member** — schreiben (aufgaben/regeln/ideen ändern), aber keine member verwalten
- **viewer** — nur lesen

---

## 4. die kern-workflows

### neue idee erfassen
„ideen"-tab → text eingeben → speichern. Vom handy aus geht das genauso —
synchronisiert in echtzeit.

### idee zu aufgabe machen
In der idee-zeile auf den kleinen `✓ als aufgabe: ...`-button tippen
(ki-vorschlag), oder den `→ aufgabe`-button rechts.

### regel anlegen
„regeln"-tab → kategorie wählen (code-stil/architektur/workflow) → text
→ aktiv-checkbox setzen. Cloud-code liest aktive regeln bei jedem run.

### cloud-code starten
„cloud-code"-tab → „starten" oder das auto-pump-toggle (oben rechts in der
übersicht). Cloud-code arbeitet automatisch durch deine offene aufgaben-liste,
priorität-sortiert.

### vorschläge / bug-hunt
„cloud-code"-tab → buttons „vorschläge" oder „bug-hunt" → cloud-code scannt
dein projekt und liefert eine liste, die du per checkmark akzeptierst.

### cloud-code regel-vorschläge
Cloud-code kann während eines runs neue regeln vorschlagen oder bestehende
aktivieren/deaktivieren. Solche vorschläge landen NICHT direkt im projekt —
sie erscheinen als checkmark-liste oben im regel-tab („cloud-code
regel-vorschläge"). Du bestätigst (✓) oder verwirfst (✕) jede einzeln.

---

## 5. häufige stolperer

**„cloud-code blockiert (rule_linter)"** — meist heißt das: pending
rule-diffs offen. Geh in „regeln" und bestätige/verwirf die obersten
checkmark-vorschläge.

**„keine berechtigung für projekt X"** — du bist mit user-account
eingeloggt, aber kein mitglied. Bitte einen owner um eine einladung, oder
nutze stattdessen den pair-flow.

**handy findet server nicht** — die LAN-IP im pairing-screen muss zur
desktop-LAN-IP passen (im server-fenster oben sichtbar). Alternativ per
USB-kabel und `adb reverse tcp:7892 tcp:7892`, dann findet das handy
`localhost` automatisch.

**WLAN bricht ab, handy verliert verbindung** — der mobile-client probiert
nach 2 fehlgeschlagenen reconnects automatisch `localhost:<port>` (nutzbar
mit `adb reverse`).

**alles weg nach reboot** — daten liegen in `sync-server/store.sqlite`.
Solange das file da ist, kommt alles zurück.

**audit: wer hat was wann geändert** — `GET
/api/projects/<id>/ops?since=0` liefert die komplette mutation-history mit
deviceId + timestamp.

---

## 6. wenn du fertig bist

- fenster schließen → server stoppt
- daten bleiben in `store.sqlite`
- nächster start: einfach wieder `start.bat`

Beim ausloggen aus dem account-modal („ausloggen") wird der user-token
serverseitig invalidiert und der browser lädt neu. Pair-tokens bleiben
unabhängig davon erhalten — die musst du im „handy verbinden"-modal
(deviceview) explizit revoken.
