// ConflictModal — pending konflikt-resolution für desktop.
// Zeigt einen pending-konflikt (project.conflicts) als overlay-modal mit
// zwei vorschau-kacheln (lokal/remote) und löst RESOLVE_CONFLICT via
// sync.mutate aus (gerätesynchron). Pure helpers in conflict_view_helpers.js.
//
// Erwartet globals: ConflictViewHelpers, sync, React (siehe index.html).
(function () {
  const { useMemo, useState, useEffect } = React;
  const H = window.ConflictViewHelpers;

  function ChoiceCard({ label, value, onPick }) {
    return (
      <button
        type="button"
        className="box"
        style={{
          textAlign: "left",
          padding: 12,
          borderWidth: 1.5,
          cursor: "pointer",
          background: "var(--paper-2, #f7f5ee)",
        }}
        onClick={onPick}
      >
        <div
          className="eyebrow"
          style={{ fontSize: 11, marginBottom: 4 }}
        >
          {label}
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "pre-wrap" }}>
          {value || "—"}
        </div>
      </button>
    );
  }

  function ConflictModal({ project, onClose }) {
    const pending = useMemo(
      () => H.selectPending(project),
      [project && project.conflicts],
    );
    const [idx, setIdx] = useState(0);
    useEffect(() => { setIdx(0); }, [pending.length]);

    if (!pending.length) return null;
    const c = pending[Math.min(idx, pending.length - 1)];

    const resolve = (choice) => {
      const payload = H.buildResolvePayload(c.id, choice);
      sync.mutate("RESOLVE_CONFLICT", { projectId: project.id, ...payload });
    };

    return (
      <div
        className="modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="Konflikt lösen"
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 50,
        }}
      >
        <div
          className="box"
          style={{ width: 480, maxWidth: "92vw", padding: 16, background: "var(--paper, #fbf9f1)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="eyebrow">
            // konflikt lösen · {pending.length} pending
            {pending.length > 1 ? ` · ${idx + 1}/${pending.length}` : ""}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, margin: "6px 0 12px" }}>
            {H.formatConflictLabel(c)}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <ChoiceCard
              label={`lokal · ${c.localDevice || "—"}`}
              value={H.previewFor(c, "local")}
              onPick={() => resolve("local")}
            />
            <ChoiceCard
              label={`remote · ${c.remoteDevice || "—"}`}
              value={H.previewFor(c, "remote")}
              onPick={() => resolve("remote")}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            {pending.length > 1 ? (
              <button
                className="btn tiny"
                onClick={() => setIdx((i) => (i + 1) % pending.length)}
              >
                nächster
              </button>
            ) : <span />}
            <button className="btn tiny" onClick={onClose}>später</button>
          </div>
        </div>
      </div>
    );
  }

  window.ConflictModal = ConflictModal;
})();
