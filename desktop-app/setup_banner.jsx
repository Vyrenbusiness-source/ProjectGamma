// SetupBanner · zeigt fehlende deps prominent für first-user.
// Verschwindet automatisch wenn alle critical-deps verfügbar sind.
// Pollt /api/setup-check alle 30s; nutzt cached-result. 0 LLM-tokens.
//
// Auto-dismiss via localStorage wenn user es schließt — nur wenn nichts kritisch
// fehlt. Bei critical-missing kann user nicht permanent dismissen (würde cc kaputt
// machen).

(function () {
  const { useState, useEffect } = React;
  if (!React) return;

  const DISMISS_KEY = "pg-setup-dismissed-v1";

  function SetupBanner({ serverUrl }) {
    const [data, setData] = useState(null);
    const [dismissed, setDismissed] = useState(() => {
      try { return localStorage.getItem(DISMISS_KEY) === "1"; }
      catch (_) { return false; }
    });
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
      let stop = false;
      async function tick() {
        try {
          const r = await fetch((serverUrl || "") + "/api/setup-check");
          if (!stop && r.ok) setData(await r.json());
        } catch (_) {}
      }
      tick();
      const t = setInterval(tick, 30000);
      return () => { stop = true; clearInterval(t); };
    }, [serverUrl]);

    if (!data) return null;
    const missing = (data.checks || []).filter(c => !c.available);
    if (missing.length === 0) return null; // alles gut, banner aus

    const critical = missing.filter(c => c.severity === "critical");
    const optional = missing.filter(c => c.severity === "optional");
    const canDismiss = critical.length === 0;
    if (dismissed && canDismiss) return null;

    const bg = critical.length > 0 ? "#FFF3E0" : "#F4F1E9";
    const borderColor = critical.length > 0 ? "#CC8800" : "var(--ink-faint)";

    return (
      <div style={{
        background: bg,
        borderBottom: "2px solid " + borderColor,
        padding: collapsed ? "6px 16px" : "10px 16px",
        fontSize: 12,
        fontFamily: "JetBrains Mono, monospace",
        color: critical.length > 0 ? "#8A5500" : "var(--ink-soft)",
      }}>
        {collapsed ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>⚠ {missing.length} setup-warnung(en)</span>
            <button className="btn tiny" onClick={() => setCollapsed(false)}>details</button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <strong style={{ fontSize: 13 }}>
                {critical.length > 0 ? "⚠ setup unvollständig" : "ⓘ optionale tools fehlen"}
              </strong>
              <span style={{ flex: 1 }}>
                {critical.length > 0
                  ? `${critical.length} kritisch · ${optional.length} optional`
                  : `${optional.length} optional`}
              </span>
              <button className="btn tiny" onClick={() => setCollapsed(true)}>minimieren</button>
              {canDismiss && (
                <button className="btn tiny" onClick={() => {
                  try { localStorage.setItem(DISMISS_KEY, "1"); } catch (_) {}
                  setDismissed(true);
                }}>✕</button>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {missing.map(c => (
                <div key={c.name} style={{
                  display: "flex", alignItems: "baseline", gap: 8,
                  paddingLeft: 6,
                  color: c.severity === "critical" ? "#8A5500" : "var(--ink-soft)",
                }}>
                  <span style={{ minWidth: 16 }}>{c.severity === "critical" ? "❌" : "·"}</span>
                  <strong style={{ minWidth: 90 }}>{c.name}</strong>
                  <span style={{ flex: 1 }}>{c.hint}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  window.SetupBanner = SetupBanner;
})();
