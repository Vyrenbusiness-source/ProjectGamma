// Desktop screen wireframes. Each screen exports 3 variants by Cloud-Code-Präsenz.
// Variants: "ambient" | "chat" | "dashboard"
// Layout pattern (chat / dashboard variants): main + 280px right rail.

const WF_PROJECTS = ["mood-tracker", "ledger.dart", "ProjectGamma ★", "studio-ui", "wave-fx"];

function WFLayout({ variant, children, sidebarItems = WF_PROJECTS, active = "ProjectGamma ★", title }) {
  const showRail = variant === "chat" || variant === "dashboard";
  return (
    <WFWindow title={title} sidebarItems={sidebarItems} active={active}
              headerRight={variant === "ambient" ? <span className="wf-cc-dot">cloud-code · idle</span> : null}>
      {variant === "ambient" && <WFCloudCode variant="ambient" />}
      <div style={{ display: "grid", gridTemplateColumns: showRail ? "1fr 260px" : "1fr", gap: 14, height: "100%", overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>{children}</div>
        {showRail && <WFCloudCode variant={variant} />}
      </div>
    </WFWindow>
  );
}

// ── 1. Onboarding / Neues Projekt anlegen ─────────────────────────────
function WFOnboarding({ variant }) {
  return (
    <WFWindow title="willkommen" headerRight={variant === "ambient" ? <span className="wf-cc-dot">cloud-code · bereit</span> : null}>
      <div style={{ display: "grid", gridTemplateColumns: variant === "ambient" ? "1fr" : "1fr 240px", gap: 16, height: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560, padding: "10px 4px" }}>
          <div className="wf-eyebrow">schritt 02 / 04</div>
          <h1 className="wf-h1">neues projekt anlegen</h1>
          <p style={{ color: "var(--ink-soft)", margin: 0 }}>
            <span className="wf-squig">cloud code</span> wird gleich verbunden und liest projektstruktur, regeln und ziele ein.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            <label className="wf-eyebrow">projektname</label>
            <input className="wf-input big" defaultValue="ProjectGamma" readOnly />

            <label className="wf-eyebrow" style={{ marginTop: 6 }}>kurzbeschreibung</label>
            <div className="wf-input" style={{ minHeight: 50, color: "var(--ink-soft)" }}>
              flutter/dart projekt-manager mit cloud-code-integration…
            </div>

            <label className="wf-eyebrow" style={{ marginTop: 6 }}>quelle</label>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="wf-btn primary tiny">📁 ordner</button>
              <button className="wf-btn tiny">git clone</button>
              <button className="wf-btn tiny">leer</button>
            </div>
          </div>

          <hr className="wf-div" />
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <button className="wf-btn">zurück</button>
            <button className="wf-btn primary">verbinden &nbsp;→</button>
          </div>
        </div>

        {variant === "chat" && (
          <div className="wf-box" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="wf-eyebrow">// onboarding-chat</div>
            <div style={{ fontSize: 12, background: "rgba(0,0,0,0.05)", padding: 6, borderRadius: 6 }}>hi! ich helfe beim setup.</div>
            <div style={{ fontSize: 12, background: "rgba(0,0,0,0.05)", padding: 6, borderRadius: 6 }}>welche sprache soll ich für regeln nutzen?</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <span className="wf-chip solid">deutsch</span>
              <span className="wf-chip">english</span>
            </div>
          </div>
        )}
        {variant === "dashboard" && (
          <div className="wf-box" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="wf-eyebrow">// agent-checkliste</div>
            <WFTask done meta="0.4s">api-key prüfen</WFTask>
            <WFTask done meta="0.8s">workspace anlegen</WFTask>
            <WFTask meta="…">struktur scannen</WFTask>
            <WFTask meta="—">regeln einlesen</WFTask>
            <WFTask meta="—">ideen-inbox aktivieren</WFTask>
          </div>
        )}
      </div>
    </WFWindow>
  );
}

// ── 2. Projekt-Auswahl / Dashboard ────────────────────────────────────
function WFDashboard({ variant }) {
  const cards = [
    { name: "ProjectGamma", tasks: 12, ideas: 4, sync: "2m", star: true },
    { name: "ledger.dart", tasks: 3, ideas: 0, sync: "1h" },
    { name: "mood-tracker", tasks: 7, ideas: 2, sync: "1d" },
    { name: "wave-fx", tasks: 0, ideas: 1, sync: "3d" },
  ];
  return (
    <WFLayout variant={variant} title="projekte" active="(alle)">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="wf-h1">deine projekte</h1>
        <div style={{ display: "flex", gap: 6 }}>
          <input className="wf-input" placeholder="suchen…" style={{ width: 140 }} />
          <button className="wf-btn primary">+ neu</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, overflow: "hidden" }}>
        {cards.map((c, i) => (
          <div key={i} className={"wf-box" + (i === 0 ? " tilt-l" : "")} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 className="wf-h2">{c.star ? "★ " : ""}{c.name}</h2>
              <span className="wf-cc-dot">cc {c.sync}</span>
            </div>
            <div style={{ display: "flex", gap: 6, fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--ink-soft)" }}>
              <span>{c.tasks} aufgaben</span><span>·</span><span>{c.ideas} ideen</span><span>·</span><span>regeln 5</span>
            </div>
            <div className="wf-ph" style={{ height: 50, marginTop: 4 }}>fortschritts-spark · {c.tasks ? "■■■□□□" : "—"}</div>
          </div>
        ))}
      </div>
      {variant === "ambient" && <WFAnno style={{ top: 60, right: 30 }}>↑ status<br />subtil</WFAnno>}
    </WFLayout>
  );
}

// ── 3. Projekt-Detailansicht ──────────────────────────────────────────
function WFProjectDetail({ variant }) {
  return (
    <WFLayout variant={variant} title="projekt-detail">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div className="wf-eyebrow">// projekt</div>
          <h1 className="wf-h1">★ ProjectGamma</h1>
          <div style={{ color: "var(--ink-soft)", fontSize: 12 }}>flutter · 2 entwickler · cloud-code aktiv</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="wf-btn tiny">öffnen in IDE</button>
          <button className="wf-btn tiny">share</button>
        </div>
      </div>
      <div className="wf-tabs">
        <div className="wf-tab active">übersicht</div>
        <div className="wf-tab">aufgaben</div>
        <div className="wf-tab">regeln</div>
        <div className="wf-tab">ideen</div>
        <div className="wf-tab">verlauf</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, overflow: "hidden" }}>
        <div className="wf-box" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="wf-eyebrow">// dateistruktur</div>
          <div className="wf-mono" style={{ lineHeight: 1.6 }}>
            <div>📁 lib/</div>
            <div style={{ paddingLeft: 14 }}>📁 features/</div>
            <div style={{ paddingLeft: 28 }}>📁 auth/ <span className="wf-chip">3 todo</span></div>
            <div style={{ paddingLeft: 28 }}>📁 sync/</div>
            <div style={{ paddingLeft: 14 }}>📁 shared/</div>
            <div>📁 test/</div>
            <div>📄 pubspec.yaml</div>
          </div>
        </div>
        <div className="wf-box" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="wf-eyebrow">// projektziele</div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            <li>mobile + desktop sync</li>
            <li>cloud-code arbeitet autonom</li>
            <li>ideen aus dem alltag erfassen</li>
            <li>regeln werden immer respektiert</li>
          </ul>
          <hr className="wf-div" />
          <div className="wf-eyebrow">// stats</div>
          <div className="wf-mono" style={{ fontSize: 11, lineHeight: 1.5 }}>
            ▸ aufgaben offen — 12<br />
            ▸ erledigt diese woche — 7<br />
            ▸ regeln aktiv — 5<br />
            ▸ ideen unbearbeitet — 4
          </div>
        </div>
      </div>
    </WFLayout>
  );
}

// ── 4. Aufgaben & Checkmarks ──────────────────────────────────────────
function WFTasks({ variant }) {
  return (
    <WFLayout variant={variant} title="aufgaben">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="wf-h1">aufgaben</h1>
        <div style={{ display: "flex", gap: 6 }}>
          <span className="wf-chip solid">offen 12</span>
          <span className="wf-chip">erledigt 47</span>
          <span className="wf-chip">debt 3</span>
          <button className="wf-btn tiny">+ aufgabe</button>
        </div>
      </div>
      <div className="wf-box" style={{ display: "flex", flexDirection: "column" }}>
        <div className="wf-eyebrow" style={{ marginBottom: 4 }}>// in arbeit</div>
        <WFTask meta="cc · 2m">refactor auth-modul nach regel #3
          <div style={{ paddingLeft: 4, marginTop: 4, display: "flex", flexDirection: "column", gap: 0 }}>
            <WFTask done meta="">tokens kapseln</WFTask>
            <WFTask done meta="">session-store extrahieren</WFTask>
            <WFTask meta="">tests anpassen</WFTask>
          </div>
        </WFTask>
        <WFTask meta="hoch">sync-konflikt mobile ↔ desktop lösen</WFTask>
        <WFTask meta="mittel">ideen-inbox: voice-transkription verbinden</WFTask>
        <div className="wf-eyebrow" style={{ margin: "10px 0 4px" }}>// als nächstes</div>
        <WFTask meta="cc-vorschlag">checkmark-history-view bauen</WFTask>
        <WFTask meta="">keyboard-shortcuts dokumentieren</WFTask>
        <div className="wf-eyebrow" style={{ margin: "10px 0 4px" }}>// erledigt heute</div>
        <WFTask done meta="13:42">datenmodell projekt → regeln</WFTask>
        <WFTask done meta="11:08">schema-migration v3</WFTask>
      </div>
    </WFLayout>
  );
}

// ── 5. Projektregeln-Editor ───────────────────────────────────────────
function WFRules({ variant }) {
  const cats = [
    { name: "code-stil", count: 4, items: ["kein unnötiger code", "snake_case für dateien", "max. 200 zeilen / file", "öffentliche api dokumentiert"] },
    { name: "architektur", count: 3, items: ["bestehende ordnerstruktur respektieren", "feature-first organisation", "domain ↔ infra trennung"] },
    { name: "workflow", count: 2, items: ["keine änderung ohne checkmark", "mobile + desktop sync beachten"] },
  ];
  return (
    <WFLayout variant={variant} title="projektregeln">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="wf-h1">projektregeln</h1>
          <div style={{ color: "var(--ink-soft)", fontSize: 12 }}>cloud code respektiert diese regeln bei jeder änderung.</div>
        </div>
        <button className="wf-btn primary tiny">+ regel</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, overflow: "hidden" }}>
        {cats.map((c, i) => (
          <div key={i} className="wf-box" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="wf-eyebrow">// {c.name}</span>
              <span className="wf-chip">{c.count}</span>
            </div>
            {c.items.map((it, j) => (
              <div key={j} style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "4px 0", borderBottom: "1px dashed rgba(0,0,0,0.15)" }}>
                <span style={{ width: 14, height: 14, border: "2px solid var(--line)", borderRadius: 3, marginTop: 2, background: "var(--ink)" }} />
                <span style={{ fontSize: 12, flex: 1 }}>{it}</span>
              </div>
            ))}
            <button className="wf-btn tiny" style={{ alignSelf: "flex-start", marginTop: 4 }}>+ hinzufügen</button>
          </div>
        ))}
      </div>
      {variant === "ambient" && <WFAnno style={{ bottom: 30, right: 50 }}>regeln gelten<br />immer →</WFAnno>}
    </WFLayout>
  );
}

// ── 6. Cloud-Code-Status / Live-Aktivität ─────────────────────────────
function WFCloudStatus({ variant }) {
  return (
    <WFLayout variant={variant} title="cloud-code">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 className="wf-h1">cloud-code aktivität</h1>
          <div style={{ color: "var(--ink-soft)", fontSize: 12 }}>
            <span className="wf-cc-dot">verbunden</span> · session 02:14 · 4 dateien geändert
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="wf-btn tiny">pause</button>
          <button className="wf-btn tiny">log download</button>
        </div>
      </div>
      <div className="wf-box" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="wf-eyebrow">// live-feed</div>
        <div className="wf-feed-row"><span className="wf-feed-glyph">●</span><span>schreibt <code>auth_service.dart</code></span><span className="wf-task-meta">jetzt</span></div>
        <div className="wf-feed-row"><span className="wf-feed-glyph">✓</span><span>checkmark gesetzt: <i>tokens kapseln</i></span><span className="wf-task-meta">12s</span></div>
        <div className="wf-feed-row"><span className="wf-feed-glyph">✓</span><span>regel #3 geprüft</span><span className="wf-task-meta">28s</span></div>
        <div className="wf-feed-row"><span className="wf-feed-glyph">►</span><span>liest <code>session_store.dart</code></span><span className="wf-task-meta">42s</span></div>
        <div className="wf-feed-row"><span className="wf-feed-glyph">!</span><span>technische schuld erkannt — siehe debt #04</span><span className="wf-task-meta">1m</span></div>
        <div className="wf-feed-row"><span className="wf-feed-glyph">✎</span><span>idee verarbeitet → neue aufgabe</span><span className="wf-task-meta">3m</span></div>
        <div className="wf-feed-row"><span className="wf-feed-glyph">↻</span><span>sync mobile ↔ desktop</span><span className="wf-task-meta">5m</span></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="wf-box">
          <div className="wf-eyebrow">// metriken (heute)</div>
          <div className="wf-mono" style={{ fontSize: 11, lineHeight: 1.6 }}>
            ▸ aufgaben erledigt &nbsp; 7<br />
            ▸ commits &nbsp; 14<br />
            ▸ regeln verletzt &nbsp; 0<br />
            ▸ token-verbrauch &nbsp; 42k
          </div>
        </div>
        <div className="wf-box">
          <div className="wf-eyebrow">// nächster schritt</div>
          <div className="wf-squig" style={{ fontSize: 16 }}>tests aktualisieren</div>
          <div style={{ color: "var(--ink-soft)", fontSize: 11, marginTop: 4 }}>nach abschluss von <i>auth_service</i></div>
        </div>
      </div>
    </WFLayout>
  );
}

// ── 7. Sync-Status / Verlauf ──────────────────────────────────────────
function WFSync({ variant }) {
  return (
    <WFLayout variant={variant} title="sync">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 className="wf-h1">sync &amp; verlauf</h1>
          <div style={{ color: "var(--ink-soft)", fontSize: 12 }}>handy ↔ desktop ↔ cloud · letzter sync vor 2 min</div>
        </div>
        <button className="wf-btn tiny">jetzt synchronisieren</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {[
          { name: "📱 handy", state: "live", last: "2m" },
          { name: "💻 desktop (this)", state: "this", last: "—" },
          { name: "☁ cloud", state: "live", last: "0s" },
        ].map((d, i) => (
          <div key={i} className="wf-box" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 16 }}>{d.name}</div>
            <span className="wf-cc-dot">{d.state}</span>
            <div className="wf-mono" style={{ fontSize: 10, color: "var(--ink-soft)" }}>last sync · {d.last}</div>
          </div>
        ))}
      </div>
      <div className="wf-box" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="wf-eyebrow">// änderungs-verlauf</div>
        <div className="wf-feed-row"><span className="wf-feed-glyph">📱→</span><span>idee „belohnungssystem hinzufügen" hinzugefügt</span><span className="wf-task-meta">2m</span></div>
        <div className="wf-feed-row"><span className="wf-feed-glyph">☁</span><span>cc · checkmark gesetzt: tokens kapseln</span><span className="wf-task-meta">8m</span></div>
        <div className="wf-feed-row"><span className="wf-feed-glyph">💻→</span><span>regel hinzugefügt: <i>max. 200 zeilen / file</i></span><span className="wf-task-meta">22m</span></div>
        <div className="wf-feed-row"><span className="wf-feed-glyph">📱→</span><span>aufgabe „voice-transkription" erstellt</span><span className="wf-task-meta">1h</span></div>
        <div className="wf-feed-row"><span className="wf-feed-glyph">☁</span><span>cc · 4 dateien geändert in feature/auth</span><span className="wf-task-meta">3h</span></div>
        <div className="wf-feed-row"><span className="wf-feed-glyph">!</span><span>konflikt aufgelöst (regeln) — <span className="wf-squig">manuell</span></span><span className="wf-task-meta">gestern</span></div>
      </div>
    </WFLayout>
  );
}

Object.assign(window, {
  WFOnboarding, WFDashboard, WFProjectDetail, WFTasks, WFRules, WFCloudStatus, WFSync
});
