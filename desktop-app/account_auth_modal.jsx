// AccountAuthModal · multi-user schicht 1+2 UI.
// Toggle „einloggen / registrieren" → ruft sync-client.loginWithAccount /
// registerAccount auf. Spiegelt mobile-app/account_login_screen.dart.
//
// Isoliertes modul (window-global), damit app.jsx nicht weiter wächst
// (architektur-regel feature-first).

(function () {
  const { useState, useEffect } = React;
  if (!React) return;

  function AccountAuthModal({ onClose, initialMode, contextHint }) {
    const client = window.useSync ? window.useSync() : null;
    const [mode, setMode] = useState(initialMode === "register" ? "register" : "login"); // 'login' | 'register'
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [me, setMe] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
      let cancelled = false;
      if (client && client.getMe) {
        client.getMe().then((m) => {
          if (!cancelled) setMe(m && m.user ? m.user : null);
        }).catch(() => {});
      }
      return () => { cancelled = true; };
    }, [client]);

    const submit = async () => {
      if (!client) return;
      setBusy(true); setError(null);
      try {
        if (mode === "register") {
          await client.registerAccount({ email: email.trim(), password });
        } else {
          await client.loginWithAccount({ email: email.trim(), password });
        }
        await client.connect();
        onClose();
      } catch (e) {
        setError((e && e.message) || "fehler");
      } finally {
        setBusy(false);
      }
    };

    const logout = async () => {
      if (!client) return;
      // Server-seitig user-session revoken (best-effort)
      try {
        await fetch(client.serverUrl + "/api/auth/logout", {
          method: "POST",
          headers: { authorization: "Bearer " + client.token },
        });
      } catch (_) {}
      client.token = null;
      localStorage.removeItem("projectgamma.sync.token");
      window.location.reload();
    };

    return (
      <div className="modal-bg" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
          <div className="modal-head">
            <div>
              <div className="eyebrow">// account</div>
              <h2 className="h2">{me ? "eingeloggt" : "anmelden"}</h2>
            </div>
            <button className="btn tiny" onClick={onClose}>×</button>
          </div>

          {me ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                eingeloggt als <strong style={{ color: "var(--ink)" }}>{me.email}</strong>
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-faint)", fontFamily: "monospace" }}>
                userId: {me.id}
              </div>
              <button className="btn danger" onClick={logout}>ausloggen</button>
              <div style={{ fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.5 }}>
                ausloggen lädt die seite neu und zeigt wieder den pair-flow.
              </div>
            </div>
          ) : (
            <>
              {contextHint && (
                <div style={{
                  marginBottom: 12, padding: 10,
                  background: "var(--paper-soft, #f5f1e8)",
                  border: "1.5px solid var(--ink-faint, #ccc)",
                  borderRadius: 6, fontSize: 12, color: "var(--ink-soft)",
                }}>{contextHint}</div>
              )}
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <button
                  className={"btn tiny" + (mode === "login" ? " primary" : "")}
                  onClick={() => setMode("login")}>einloggen</button>
                <button
                  className={"btn tiny" + (mode === "register" ? " primary" : "")}
                  onClick={() => setMode("register")}>registrieren</button>
              </div>
              <label className="field">
                <span className="eyebrow">email</span>
                <input className="input" type="email" autoFocus
                       value={email} onChange={(e) => setEmail(e.target.value)}
                       placeholder="du@example.com" />
              </label>
              <label className="field">
                <span className="eyebrow">passwort {mode === "register" && <span style={{ opacity: 0.5 }}>(min 8 zeichen)</span>}</span>
                <input className="input" type="password"
                       value={password} onChange={(e) => setPassword(e.target.value)}
                       onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                       placeholder="••••••••" />
              </label>
              {error && (
                <div style={{
                  marginTop: 4, padding: 8,
                  border: "1.5px solid #c33", borderRadius: 6,
                  color: "#c33", fontSize: 12,
                }}>{error}</div>
              )}
              <div style={{ marginTop: 14, fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.5 }}>
                hinweis: der allererste registrierte user wird automatisch owner
                aller bestehenden projekte. weitere user müssen vom owner
                eingeladen werden („👥 mitglieder").
              </div>
              <div className="footer">
                <button className="btn" onClick={onClose} disabled={busy}>abbrechen</button>
                <button className="btn primary" onClick={submit}
                        disabled={busy || !email.trim() || !password}>
                  {busy ? "…" : (mode === "register" ? "account anlegen →" : "einloggen →")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  window.AccountAuthModal = AccountAuthModal;
})();
