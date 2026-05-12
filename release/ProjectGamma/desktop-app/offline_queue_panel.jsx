// Offline-Queue-Panel — badge mit pending-count + dropdown mit retry/drop.
// Reagiert auf sync.subscribe. Animationen respektieren
// prefers-reduced-motion (CSS).
// Isoliertes feature-modul (regel: app.jsx nicht weiter aufblähen).
(function () {
  const { useEffect, useState, useRef } = React;

  function OfflineQueuePanel({ client }) {
    const [tick, setTick] = useState(0);
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => client.subscribe(() => setTick(t => t + 1)), [client]);
    useEffect(() => {
      if (!open) return;
      const onDoc = (e) => {
        if (ref.current && !ref.current.contains(e.target)) setOpen(false);
      };
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);

    const q = client.offlineQueue;
    if (!q) return null;
    const items = q.list().filter(i => i.status !== "sent");
    const pending = items.filter(i => i.status === "pending").length;
    const failed = items.filter(i => i.status === "failed").length;
    const total = pending + failed;
    if (total === 0) return null;

    return (
      <div className="oq-panel" ref={ref} style={{ position: "relative" }}>
        <button
          className={"oq-badge" + (failed ? " has-failed" : "")}
          title={`offline-warteschlange · ${pending} pending` + (failed ? ` · ${failed} fehlgeschlagen` : "")}
          onClick={() => setOpen(o => !o)}
          style={{
            background: "transparent",
            border: "1px dashed var(--ink-faint, #888)",
            borderRadius: 12,
            padding: "2px 8px",
            cursor: "pointer",
            fontSize: 11,
            color: failed ? "#b00020" : "var(--ink)",
          }}
        >
          ⊘ offline · {total}
        </button>
        {open && (
          <div
            className="oq-dropdown"
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 4px)",
              minWidth: 280,
              maxWidth: 380,
              maxHeight: 360,
              overflowY: "auto",
              background: "var(--paper, #fff)",
              border: "1px solid var(--ink-faint, #ccc)",
              borderRadius: 6,
              boxShadow: "0 4px 14px rgba(0,0,0,.12)",
              zIndex: 50,
              padding: 8,
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              offline-warteschlange · {pending} pending · {failed} fehlgeschlagen
            </div>
            {items.length === 0 ? (
              <div style={{ color: "var(--ink-faint)" }}>keine pending aktionen</div>
            ) : items.map(item => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 0",
                  borderBottom: "1px dashed rgba(0,0,0,.1)",
                }}
              >
                <span style={{ flex: 1 }}>
                  <span style={{ fontFamily: "var(--mono)" }}>{item.type}</span>
                  <div style={{ color: item.status === "failed" ? "#b00020" : "var(--ink-faint)", fontSize: 10 }}>
                    {item.status === "failed" && item.error ? item.error : item.createdAt}
                  </div>
                </span>
                <button
                  title="erneut versuchen"
                  onClick={() => client.retryQueueItem(item.id)}
                  style={{ border: "none", background: "transparent", cursor: "pointer" }}
                >↻</button>
                <button
                  title="verwerfen"
                  onClick={() => client.dropQueueItem(item.id)}
                  style={{ border: "none", background: "transparent", cursor: "pointer" }}
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  window.OfflineQueuePanel = OfflineQueuePanel;
})();
