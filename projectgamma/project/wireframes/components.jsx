// Shared sketchy primitives + small helpers for the wireframes
// All components write into window for use by other Babel scripts.

const { useState } = React;

function WFTag({ children }) {
  return <div className="wf-tag">{children}</div>;
}

function WFAnno({ style, children }) {
  return <div className="wf-anno" style={style}>{children}</div>;
}

function WFCheck({ done }) {
  return <span className={"wf-check" + (done ? " done" : "")} />;
}

function WFTask({ done, children, meta }) {
  return (
    <div className={"wf-task" + (done ? " done" : "")}>
      <WFCheck done={done} />
      <div className="wf-task-text">{children}</div>
      {meta ? <div className="wf-task-meta">{meta}</div> : <div />}
    </div>
  );
}

// Window chrome for desktop screens
function WFWindow({ title, children, sidebarItems, active, headerRight }) {
  return (
    <div className="wf-win">
      <div className="wf-titlebar">
        <span className="wf-dot" />
        <span className="wf-dot" />
        <span className="wf-dot" />
        <span style={{ marginLeft: 8 }}>ProjectGamma · {title}</span>
        <span style={{ marginLeft: "auto" }}>{headerRight}</span>
      </div>
      {sidebarItems ? (
        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", height: "100%", overflow: "hidden" }}>
          <div className="wf-side">
            <div className="wf-eyebrow" style={{ marginBottom: 4 }}>// projects</div>
            {sidebarItems.map((it, i) => (
              <div key={i} className={"wf-side-item" + (it === active ? " active" : "")}>{it}</div>
            ))}
            <hr className="wf-div" />
            <div className="wf-cc-dot">cloud-code · idle</div>
          </div>
          <div style={{ padding: 18, overflow: "hidden", display: "flex", flexDirection: "column", gap: 14, position: "relative" }}>
            {children}
          </div>
        </div>
      ) : (
        <div style={{ padding: 18, overflow: "hidden", display: "flex", flexDirection: "column", gap: 14, position: "relative" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// Cloud-Code presence: A) Ambient, B) Chat, C) Dashboard.
// Renders a presence panel/bar that fits the variant.
function WFCloudCode({ variant }) {
  if (variant === "ambient") {
    return (
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "6px 10px", border: "2px dashed var(--line)", borderRadius: 6,
        fontFamily: "JetBrains Mono, monospace", fontSize: 11,
      }}>
        <span className="wf-cc-dot">cloud-code · arbeitet im hintergrund</span>
        <span style={{ color: "var(--ink-soft)", fontSize: 10 }}>3 task offen · last sync 2m</span>
      </div>
    );
  }
  if (variant === "chat") {
    return (
      <div className="wf-box" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6, height: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="wf-eyebrow">// cloud-code chat</div>
          <span className="wf-cc-dot">live</span>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, fontSize: 12, overflow: "hidden" }}>
          <div style={{ background: "rgba(0,0,0,0.05)", padding: "5px 8px", borderRadius: 8, alignSelf: "flex-start", maxWidth: "85%" }}>
            Lese projektregeln…<br /><span className="wf-mono" style={{ fontSize: 10, color: "var(--ink-soft)" }}>5 regeln geladen</span>
          </div>
          <div style={{ background: "var(--ink)", color: "var(--paper)", padding: "5px 8px", borderRadius: 8, alignSelf: "flex-end", maxWidth: "85%" }}>
            Refactor auth-modul nach Regel #3
          </div>
          <div style={{ background: "rgba(0,0,0,0.05)", padding: "5px 8px", borderRadius: 8, alignSelf: "flex-start", maxWidth: "85%" }}>
            ✓ 4 dateien geändert<br />✓ checkmark gesetzt<br />→ siehe diff
          </div>
        </div>
        <div className="wf-input" style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
          <span style={{ color: "var(--ink-faint)" }}>›</span>
          <span style={{ color: "var(--ink-faint)" }}>frage cloud-code…</span>
        </div>
      </div>
    );
  }
  // dashboard
  return (
    <div className="wf-box" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div className="wf-eyebrow">// cloud-code · agent</div>
        <span className="wf-cc-dot">aktiv</span>
      </div>
      <div className="wf-mono" style={{ fontSize: 10, lineHeight: 1.4 }}>
        <div>aktuelle aufgabe</div>
        <div className="wf-squig">refactor auth-modul</div>
      </div>
      <div className="wf-mono" style={{ fontSize: 10, color: "var(--ink-soft)", lineHeight: 1.5, flex: 1, overflow: "hidden" }}>
        <div>► lese src/auth/*.dart</div>
        <div>► prüfe regel #3</div>
        <div>● schreibe auth_service.dart</div>
        <div style={{ color: "var(--ink-faint)" }}>○ tests aktualisieren</div>
        <div style={{ color: "var(--ink-faint)" }}>○ checkmark setzen</div>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button className="wf-btn tiny">pause</button>
        <button className="wf-btn tiny">log</button>
        <button className="wf-btn tiny">stop</button>
      </div>
    </div>
  );
}

Object.assign(window, { WFTag, WFAnno, WFCheck, WFTask, WFWindow, WFCloudCode });
