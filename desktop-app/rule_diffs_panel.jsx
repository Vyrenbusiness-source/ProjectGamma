// Pending rule-diffs panel — zeigt cloud-code-vorschläge zum
// aktivieren/deaktivieren bestehender regeln und löst APPROVE_RULE_DIFF
// bzw. REJECT_RULE_DIFF aus. Isoliertes modul, damit app.jsx nicht weiter
// wächst (architektur-regel: feature-first).
//
// Erwartet, dass `RuleDiffsViewHelpers` und `sync` als globals existieren
// (siehe index.html). React kommt aus der UMD-bundle global.
(function () {
  const { useMemo } = React;
  const helpers = window.RuleDiffsViewHelpers;

  function RuleDiffsPanel({ project }) {
    const pending = useMemo(
      () => helpers.selectPending(project),
      [project && project.ruleDiffs],
    );
    if (!pending.length) return null;

    const approve = (id) =>
      sync.mutate("APPROVE_RULE_DIFF", { projectId: project.id, diffId: id });
    const reject = (id) =>
      sync.mutate("REJECT_RULE_DIFF", { projectId: project.id, diffId: id });

    return (
      <div className="box recommended-box" style={{ marginBottom: 12 }}>
        <div className="eyebrow">
          // cloud-code regel-vorschläge · {pending.length} ausstehend ·
          checkmark zum bestätigen
        </div>
        <div className="rule-diffs-list">
          {pending.map((d) => (
            <div
              key={d.id}
              className="rule-diff-row"
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                padding: "6px 0",
                borderBottom: "1px dashed rgba(0,0,0,.15)",
              }}
            >
              <span
                className="chip"
                style={{
                  borderColor: d.action === "deactivate" ? "#c33" : "#393",
                  color: d.action === "deactivate" ? "#c33" : "#393",
                }}
              >
                {d.action === "deactivate" ? "− deaktivieren" : "+ aktivieren"}
              </span>
              <span style={{ flex: 1 }}>{d.text}</span>
              <button
                className="btn tiny"
                title="ablehnen"
                onClick={() => reject(d.id)}
              >
                ✕
              </button>
              <button
                className="btn primary tiny"
                title="bestätigen"
                onClick={() => approve(d.id)}
              >
                ✓
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  window.RuleDiffsPanel = RuleDiffsPanel;
})();
