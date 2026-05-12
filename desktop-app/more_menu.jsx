// MoreMenu · sekundäre topbar-actions in einem dropdown.
// Reduziert die topbar-density von 8 buttons auf 4 + ein "⋯".
// Aktionen: openIDE, share, syncNow, openSettings, löschen.

(function () {
  const { useState, useEffect, useRef } = React;
  if (!React) return;

  function MoreMenu({ onAction, onDelete, hasPath }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
      function onDoc(e) {
        if (!open) return;
        if (ref.current && !ref.current.contains(e.target)) setOpen(false);
      }
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);

    const choose = (a) => () => { setOpen(false); a && a(); };

    return (
      <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
        <button className="btn tiny" onClick={() => setOpen((o) => !o)}
                title="weitere actions">⋯</button>
        {open && (
          <div style={{
            position: "absolute", top: "100%", right: 0, marginTop: 4,
            background: "var(--paper)", border: "2px solid var(--ink)",
            borderRadius: 8, padding: 4, minWidth: 180, zIndex: 100,
            boxShadow: "3px 3px 0 rgba(0,0,0,0.08)",
          }}>
            <Item label="✎ projekt-details" hint="beschreibung · ziele · dateien"
              onClick={choose(() => onAction("openProjectSettings"))} />
            <Item label="↻ sync jetzt" onClick={choose(() => onAction("syncNow"))} />
            <Item label="📤 export (json)" onClick={choose(() => onAction("share"))} />
            <Item label="📂 öffnen in IDE" disabled={!hasPath}
              hint={hasPath ? "" : "pfad fehlt"}
              onClick={choose(() => onAction("openIDE"))} />
            <div style={{ height: 1, background: "var(--ink-faint)", margin: "4px 6px" }} />
            <Item label="⚙ globale settings" hint="API-keys · cli-status"
              onClick={choose(() => onAction("openSettings"))} />
            <div style={{ height: 1, background: "var(--ink-faint)", margin: "4px 6px" }} />
            <Item label="× projekt löschen" danger onClick={choose(onDelete)} />
          </div>
        )}
      </div>
    );
  }

  function Item({ label, onClick, disabled, danger, hint }) {
    return (
      <button onClick={disabled ? null : onClick}
        disabled={disabled}
        style={{
          display: "block", width: "100%", textAlign: "left",
          padding: "6px 10px", background: "transparent",
          border: "none", borderRadius: 4,
          fontFamily: "inherit", fontSize: 12.5,
          color: disabled ? "var(--ink-faint)" : (danger ? "#c33" : "var(--ink)"),
          cursor: disabled ? "default" : "pointer",
        }}
        onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "rgba(0,0,0,0.05)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
        {label}
        {hint && <span style={{ color: "var(--ink-faint)", marginLeft: 6, fontSize: 10 }}>· {hint}</span>}
      </button>
    );
  }

  window.MoreMenu = MoreMenu;
})();
