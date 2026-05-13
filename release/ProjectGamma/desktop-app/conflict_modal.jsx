// ConflictModal — pending konflikt-resolution für desktop.
// Zeigt einen pending-konflikt (project.conflicts) als overlay-modal mit
// side-by-side-diff (lokal | remote) und löst RESOLVE_CONFLICT via
// sync.mutate aus (gerätesynchron). Diff-rows kommen von ConflictDiff,
// pure helpers aus ConflictViewHelpers.
//
// Erwartet globals: ConflictDiff, ConflictViewHelpers, sync, React.
(function () {
  const { useMemo, useState, useEffect } = React;
  const H = window.ConflictViewHelpers;
  const D = window.ConflictDiff;

  // Farb-tokens — passen zur sketchy B&W palette + minimale semantik.
  const TONE = {
    equal:  { bg: "transparent",       ink: "var(--ink, #1a1a1a)" },
    remove: { bg: "rgba(180,40,40,.10)", ink: "var(--ink, #1a1a1a)" },
    add:    { bg: "rgba(40,140,60,.10)", ink: "var(--ink, #1a1a1a)" },
    change: { bg: "rgba(180,140,40,.10)", ink: "var(--ink, #1a1a1a)" },
  };

  function DiffCell({ kind, side, text }) {
    const tone = TONE[kind] || TONE.equal;
    const showEmpty = text == null;
    return (
      <div
        style={{
          padding: "4px 8px",
          background: tone.bg,
          color: tone.ink,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          minHeight: 20,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          opacity: showEmpty ? 0.4 : 1,
        }}
        aria-label={`${side} ${kind}`}
      >
        {showEmpty ? "·" : text}
      </div>
    );
  }

  function DiffColumn({ title, rows, side, onPick }) {
    return (
      <button
        type="button"
        className="box"
        onClick={onPick}
        style={{
          textAlign: "left",
          padding: 0,
          borderWidth: 1.5,
          cursor: "pointer",
          background: "var(--paper-2, #f7f5ee)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        aria-label={`auswählen: ${title}`}
      >
        <div
          className="eyebrow"
          style={{
            fontSize: 11, padding: "6px 8px",
            borderBottom: "1px dashed var(--ink-faint, #c8c2b0)",
          }}
        >
          {title}
        </div>
        <div style={{ display: "grid", gridAutoRows: "min-content" }}>
          {rows.length === 0 ? (
            <DiffCell kind="equal" side={side} text="" />
          ) : rows.map((r, i) => (
            <DiffCell
              key={i}
              kind={r.kind}
              side={side}
              text={side === "left" ? r.left : r.right}
            />
          ))}
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

    // alle hooks vor early-return (rules-of-hooks): c/rows defensiv für
    // den fall, dass pending leer ist — render-bedingung kommt danach.
    const c = pending.length
      ? pending[Math.min(idx, pending.length - 1)]
      : null;
    const rows = useMemo(
      () => c ? D.computeSideBySide(c.localValue || "", c.remoteValue || "") : [],
      [c && c.id, c && c.localValue, c && c.remoteValue],
    );

    if (!pending.length) return null;

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
          style={{
            width: 720, maxWidth: "94vw", padding: 16,
            background: "var(--paper, #fbf9f1)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="eyebrow">
            // konflikt lösen · {pending.length} pending
            {pending.length > 1 ? ` · ${idx + 1}/${pending.length}` : ""}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, margin: "6px 0 12px" }}>
            {H.formatConflictLabel(c)}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
            }}
          >
            <DiffColumn
              title={`lokal · ${c.localDevice || "—"}`}
              rows={rows}
              side="left"
              onPick={() => resolve("local")}
            />
            <DiffColumn
              title={`remote · ${c.remoteDevice || "—"}`}
              rows={rows}
              side="right"
              onPick={() => resolve("remote")}
            />
          </div>
          <div
            style={{
              display: "flex", justifyContent: "space-between",
              marginTop: 12, alignItems: "center", fontSize: 12,
              color: "var(--ink-soft, #555)",
            }}
          >
            <span>klick auf seite → diese version übernehmen</span>
            <span style={{ display: "flex", gap: 8 }}>
              {pending.length > 1 ? (
                <button
                  className="btn tiny"
                  onClick={() => setIdx((i) => (i + 1) % pending.length)}
                >
                  nächster
                </button>
              ) : null}
              <button className="btn tiny" onClick={onClose}>später</button>
            </span>
          </div>
        </div>
      </div>
    );
  }

  window.ConflictModal = ConflictModal;
})();
