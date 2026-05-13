# Desktop-App Navigation Cleanup

**Datum:** 2026-05-13
**Status:** Design — wartet auf Approval
**Scope:** `desktop-app/` only (mobile-app bleibt unangetastet)

## Problem

Die Desktop-App zeigt **8 Top-Level-Tabs** (`übersicht`, `aufgaben`, `regeln`,
`ideen`, `team`, `cloud-code`, `preview`, `sync`) in einer horizontalen
Tab-Bar. Neue Nutzer sind überfordert — sie sehen 8 mögliche Ziele, ohne
Hinweis was Core und was Power-User-Feature ist. Der typische Hauptflow
("Aufgaben durchgehen") ist nicht visuell privilegiert; `aufgaben` ist nur
einer von vielen Tabs.

## Entscheidungen aus dem Brainstorming

1. **Primary Flow:** Aufgaben verwalten — Tasks ist Default-Landing.
2. **Pattern:** Linke Sidebar (Icons + Labels), keine Top-Tabs.
3. **Reduktion:** Echte Reduktion auf **4 Nav-Einträge + 1 Settings-Icon**.
4. **Scope:** Nur `desktop-app/`. Mobile bekommt später ein eigenes Pattern.

## Neue Architektur

### Sidebar-Layout

```
+--------------------+
| * ProjectGamma     |   ← project-selector dropdown / logo
+--------------------+
|                    |
| [v] Aufgaben    8  |   ← default landing, badge = # offen
| [i] Ideen      14  |
| [r] Regeln      9  |
| [c] Cloud-Agent    |   ← cc-status-dot wenn job läuft
|                    |
+--------------------+
| sync-status-dot    |   ← klein, unten links
| [⚙] Einstellungen  |   ← öffnet settings-modal (team, sync-config, …)
+--------------------+
```

**4 primary nav-items** (Aufgaben/Ideen/Regeln/Cloud-Agent), **1 Settings-Icon**
unten. Sync-Status nur noch als farbiger Dot (grün/grau/rot).

### Tab-Migrationen (was passiert mit den alten Tabs)

| Alter Tab    | Neues Zuhause | Begründung |
|---|---|---|
| `übersicht`  | **gestrichen** | Stats + Projektziele wandern als Header-Strip in `Aufgaben`-Screen. Dateistruktur und "alle projekte"-Grid werden gestrichen (siehe Übersicht-Tab-Inhalt-Sektion unten für Details). |
| `aufgaben`   | Sidebar #1 (Default) | Primary flow. |
| `regeln`     | Sidebar #3 | Bleibt eigener Top-Level (cc braucht Regel-Awareness). |
| `ideen`      | Sidebar #2 | Capture bleibt prominent. |
| `team`       | Settings-Modal Tab | Power-User-Feature, gehört unter ⚙. |
| `cloud-code` | Sidebar #4 (umbenannt: "Cloud-Agent") | cc-jobs sind eigene mental category. |
| `preview`    | **gestrichen** | War experimentell. Falls Bedarf, kommt als Toggle-Button in den Aufgaben-Screen-Header. |
| `sync`       | Settings-Modal Tab + Status-Dot unten | Detail-Config in Modal, Status als Dot. |

### Settings-Modal

Neuer `<SettingsModal>`-Component mit drei sub-tabs:
- **Team** (war `ScreenTeam` → `<TeamPanel>`)
- **Sync** (Sync-Status detail + manual sync trigger)
- **Allgemein** (project rename, delete, …)

Trigger: ⚙-Icon unten in der Sidebar.

### Übersicht-Tab-Inhalt: wohin?

Der alte `übersicht`-Tab zeigt aktuell: Dateistruktur-Tree, Projektziele,
Stats (offen/erledigt/regeln aktiv), und "alle projekte"-Grid.

- **Stats**: als kompakte Header-Strip im Aufgaben-Screen (3 zahlen, 1 zeile).
- **Projektziele**: collapsible Panel im Aufgaben-Screen unter den Stats.
- **Dateistruktur**: gestrichen aus der UI (kein klarer use-case). Falls
  später gebraucht, kommt es in den `Cloud-Agent`-Tab als context-card.
- **"alle projekte"-Grid**: gestrichen. Project-Wechsel passiert via dem
  bereits existierenden Project-Selector links oben.

## Implementation-Scope

### Files

| Datei | Änderung |
|---|---|
| `desktop-app/app.jsx` | `TABS`-array reduzieren auf 4. `MainHead` → `SidebarNav`. Tab-render-block (~line 3360-3395) umbauen. `<ScreenOverview>` und `<ScreenPreview>` aus dem render-tree entfernen. Stats/Goals als Header in `<ScreenTasks>` einbetten. |
| `desktop-app/styles.css` | Neue Sidebar-Klassen (`.nav-sidebar`, `.nav-item`, `.nav-badge`). Alte `.tab-bar` / `.tab` Styles streichen oder retiren. Grid-layout: 2-spalten (sidebar 220px + main-flex). |
| `desktop-app/index.html` | Vermutlich keine Änderung — bekomm nur das neue grid-layout durch styles. |
| Neu: `desktop-app/settings_modal.jsx` | Settings-Modal-Component mit Team/Sync/Allgemein sub-tabs. |
| Bestehend: `desktop-app/team_panel.jsx` (falls separates File) | Wird in SettingsModal eingehängt statt als eigener Tab. |

### Migrations-Strategie

1. Sidebar-Component bauen, parallel zur bestehenden TopTab-Bar (Feature-Flag
   `state.uiLayout = "sidebar" | "tabs"`).
2. Stats/Goals/Files-Migration in `<ScreenTasks>` einbauen.
3. SettingsModal bauen, team + sync rein.
4. preview + overview aus render-tree entfernen (mit `git rm` für die
   `<ScreenOverview>`-/-`<ScreenPreview>`-Component-Files, falls separate).
5. Feature-Flag entfernen, alte Tab-Bar löschen.

Das Feature-Flag ist nur transient für die PR-Iteration — am Ende der
Implementation wird er entfernt. Kein bleibendes Setting.

## Testing

- **Manuell**: Alle 4 Sidebar-items klickbar, badges zeigen korrekte Zahlen,
  cc-status-dot blinkt bei laufendem job.
- **Settings-Modal**: öffnet via ⚙, alle 3 sub-tabs rendern.
- **Stats-Strip**: zeigt korrekte aufgaben-/regeln-/ideen-zahlen im
  Aufgaben-Header.
- **Project-Switch**: project-selector links oben funktioniert weiterhin.
- **Regression-Check**: cc-pipeline-trigger (`/api/cc/run` button) ist im
  `Cloud-Agent`-Tab weiterhin erreichbar.

## Out of Scope

- **Mobile-App**: bleibt mit ihrer aktuellen Navigation. Eigenes Design später.
- **Visual-Refresh** (Farben, Typography, Icons-Style): Nur das Layout/IA
  ändert sich. Die existierende sketchy-B&W-Ästhetik bleibt.
- **Onboarding-Tour**: kein guided-tour-overlay in diesem Scope.
- **Keyboard-Shortcuts** für Tab-Switching: existieren ggf. schon, werden
  auf neue Sidebar-IDs gemappt aber nicht neu erfunden.
- **Command-Palette (⌘K)**: war Alternative-Option im Brainstorming,
  abgelehnt. Bleibt als optionaler future-add.

## Risiken

1. **State-Migration**: `client.activeTab === "overview"` etc. ist im Code
   verstreut. `grep activeTab` zeigt mindestens 9 Stellen in `app.jsx`. Risk:
   eine vergessen → toter Branch. Mitigation: nach Refactor `grep` auf alte
   Tab-IDs (`"overview"`, `"preview"`, `"team"`, `"sync"` als activeTab-werte)
   muss leer sein.
2. **WebSocket-Events**: Server broadcasted ggf. tab-spezifische events
   (z.B. `CC_STATUS` für cloud-Tab). Muss vor merge geprüft werden.
3. **Existing user habits**: Stamm-User die "übersicht" gewohnt sind. Mitigation:
   keine — clean cut, alte stats sind im Aufgaben-Header weiterhin sichtbar.
