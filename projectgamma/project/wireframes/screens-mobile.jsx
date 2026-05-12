// Mobile screen: Ideen-Inbox.
// 3 capture-method variants: "quick" | "voice" | "chat"
// Each rendered inside an iOS frame from the starter component.

function WFMobIdea({ method }) {
  return (
    <IOSDevice width={320} height={640}>
      <div className="wf-mob-shell">
        <div className="wf-mob-header">
          <div>
            <div className="wf-eyebrow">★ ProjectGamma</div>
            <h2 className="wf-h2">ideen</h2>
          </div>
          <span className="wf-cc-dot">cc 2m</span>
        </div>

        <div className="wf-mob-body">
          {/* Captured ideas — same in all three */}
          <div className="wf-box" style={{ padding: 8 }}>
            <div className="wf-eyebrow" style={{ marginBottom: 4 }}>// inbox · 4</div>
            <div style={{ borderBottom: "1px dashed rgba(0,0,0,0.2)", padding: "5px 0" }}>
              <div style={{ fontSize: 13 }}>füge ein belohnungssystem hinzu</div>
              <div className="wf-mono" style={{ fontSize: 9, color: "var(--ink-soft)" }}>vor 2m · noch nicht verarbeitet</div>
            </div>
            <div style={{ borderBottom: "1px dashed rgba(0,0,0,0.2)", padding: "5px 0" }}>
              <div style={{ fontSize: 13 }}>onboarding kürzer machen</div>
              <div className="wf-mono" style={{ fontSize: 9, color: "var(--ink-soft)" }}>14:02 · ✓ aufgabe erstellt</div>
            </div>
            <div style={{ padding: "5px 0" }}>
              <div style={{ fontSize: 13 }}>haptic feedback bei checkmark</div>
              <div className="wf-mono" style={{ fontSize: 9, color: "var(--ink-soft)" }}>gestern · ✓ verarbeitet</div>
            </div>
          </div>

          {/* Variant-specific capture surface */}
          {method === "quick" && (
            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="wf-eyebrow">// schnelle notiz</div>
              <textarea className="wf-input big" rows={3}
                placeholder="was ist die idee?"
                defaultValue=""
                style={{ resize: "none" }} />
              <div style={{ display: "flex", gap: 6, justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 4 }}>
                  <span className="wf-chip">#feature</span>
                  <span className="wf-chip">+tag</span>
                </div>
                <button className="wf-btn primary tiny">speichern</button>
              </div>
            </div>
          )}

          {method === "voice" && (
            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
              <div className="wf-eyebrow">// halten zum sprechen</div>
              <div className="wf-waveform" style={{ width: "100%" }}>
                {[20,40,60,80,55,90,40,70,30,50,75,35,60,45,25,55,40].map((h, i) => (
                  <span key={i} style={{ height: h + "%" }} />
                ))}
              </div>
              <div className="wf-mono" style={{ fontSize: 10, color: "var(--ink-soft)", textAlign: "center" }}>
                „füge ein belohnungssystem hinzu wenn man drei tasks erledigt"
              </div>
              <button className="wf-btn primary" style={{ width: 84, height: 84, borderRadius: "50%", fontSize: 24 }}>●</button>
              <div className="wf-mono" style={{ fontSize: 9, color: "var(--ink-soft)" }}>00:08 · transkribiert live</div>
            </div>
          )}

          {method === "chat" && (
            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="wf-eyebrow">// gespräch mit cloud-code</div>
              <div style={{ background: "var(--ink)", color: "var(--paper)", padding: "5px 8px", borderRadius: 8, alignSelf: "flex-end", maxWidth: "85%", fontSize: 12 }}>
                belohnungs-system, 3 tasks → +1 stern
              </div>
              <div style={{ background: "rgba(0,0,0,0.06)", padding: "5px 8px", borderRadius: 8, alignSelf: "flex-start", maxWidth: "85%", fontSize: 12 }}>
                soll ich daraus eine epic mit 4 unter-aufgaben anlegen?
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                <button className="wf-btn tiny">ja, anlegen</button>
                <button className="wf-btn tiny">nur als idee</button>
              </div>
              <div className="wf-input" style={{ display: "flex", gap: 6, padding: "6px 8px", marginTop: 6, fontSize: 12 }}>
                <span style={{ color: "var(--ink-faint)" }}>›</span>
                <span style={{ color: "var(--ink-faint)" }}>antwort tippen…</span>
                <span style={{ marginLeft: "auto", fontSize: 14 }}>⏺</span>
              </div>
            </div>
          )}
        </div>

        <div className="wf-mob-tabbar">
          <div><div className="glyph" /><span>projekt</span></div>
          <div><div className="glyph" /><span>aufgaben</span></div>
          <div className="active"><div className="glyph" /><span>ideen</span></div>
          <div><div className="glyph" /><span>regeln</span></div>
        </div>
      </div>
    </IOSDevice>
  );
}

Object.assign(window, { WFMobIdea });
