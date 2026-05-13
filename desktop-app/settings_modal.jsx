// SettingsModal · API-keys + setup-status (claude-cli installed?).
// Endpoints:
//   GET  /api/setup/status         → { claude, settings, knownKeys }
//   POST /api/setup/settings       { key, value }
//   POST /api/setup/install-claude
//
// Feature-first window-global. Wird via app.jsx topbar geöffnet.

(function () {
  const { useState, useEffect, useCallback } = React;
  if (!React) return;

  function SettingsModal({ onClose }) {
    const client = window.useSync ? window.useSync() : null;
    const [status, setStatus] = useState(null);
    const [deps, setDeps] = useState(null);
    const [editing, setEditing] = useState({}); // key -> raw value being typed
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const [installing, setInstalling] = useState(false);
    const [installLog, setInstallLog] = useState(null);
    const [autoFixing, setAutoFixing] = useState(false);
    const [autoFixLog, setAutoFixLog] = useState(null);

    const auth = useCallback(() => ({ authorization: "Bearer " + client.token }), [client]);

    const load = useCallback(async () => {
      if (!client) return;
      try {
        const [s, d] = await Promise.all([
          fetch(client.serverUrl + "/api/setup/status", { headers: auth() }).then(r => r.json()),
          fetch(client.serverUrl + "/api/setup/deps", { headers: auth() }).then(r => r.json()),
        ]);
        setStatus(s); setDeps(d);
      } catch (e) {
        setErr(e.message);
      }
    }, [client, auth]);

    useEffect(() => { load(); }, [load]);

    const autoFix = async () => {
      setAutoFixing(true); setAutoFixLog("läuft… kann ~30s dauern");
      try {
        const r = await fetch(client.serverUrl + "/api/setup/auto-fix", { method: "POST", headers: auth() });
        const data = await r.json().catch(() => ({}));
        if (r.ok) {
          const inst = data.installed && data.installed.length
            ? "✓ installiert: " + data.installed.join(", ") : "keine npm-installs nötig";
          const man = data.manualSteps && data.manualSteps.length
            ? "\nmanuelle downloads: " + data.manualSteps.map(m => m.name + " → " + (m.install?.url || "?")).join(" · ")
            : "";
          setAutoFixLog(inst + man);
          await load();
        } else {
          setAutoFixLog("✗ " + (data.error || "fehler"));
        }
      } catch (e) { setAutoFixLog("✗ " + e.message); }
      finally { setAutoFixing(false); }
    };

    const save = async (key) => {
      const value = editing[key] || "";
      setBusy(true); setErr(null);
      try {
        const r = await fetch(client.serverUrl + "/api/setup/settings", {
          method: "POST",
          headers: { ...auth(), "content-type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "fehler");
        setStatus(s => ({ ...s, settings: data.settings }));
        setEditing(e => { const c = { ...e }; delete c[key]; return c; });
      } catch (e) { setErr(e.message); }
      finally { setBusy(false); }
    };

    const clear = async (key) => {
      setBusy(true); setErr(null);
      try {
        const r = await fetch(client.serverUrl + "/api/setup/settings", {
          method: "POST",
          headers: { ...auth(), "content-type": "application/json" },
          body: JSON.stringify({ key, value: "" }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "fehler");
        setStatus(s => ({ ...s, settings: data.settings }));
      } catch (e) { setErr(e.message); }
      finally { setBusy(false); }
    };

    const installClaude = async () => {
      setInstalling(true); setInstallLog("läuft… kann ~30s dauern");
      try {
        const r = await fetch(client.serverUrl + "/api/setup/install-claude", {
          method: "POST", headers: auth(),
        });
        const data = await r.json();
        if (r.ok) {
          setInstallLog("✓ installiert: " + (data.version || "version unbekannt"));
          await load();
        } else {
          setInstallLog("✗ fehler: " + (data.error || data.err || "code " + data.code));
        }
      } catch (e) { setInstallLog("✗ " + e.message); }
      finally { setInstalling(false); }
    };

    if (!status) {
      return (
        <div className="modal-bg" onClick={onClose}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <h2 className="h2">einstellungen</h2>
              <button className="btn tiny" onClick={onClose}>×</button>
            </div>
            <div className="empty" style={{ padding: 16 }}>lade…</div>
            {err && <div style={{ color: "#c33", padding: 8, border: "1.5px solid #c33", borderRadius: 6 }}>{err}</div>}
          </div>
        </div>
      );
    }

    const keyMeta = {
      ANTHROPIC_API_KEY: { label: "Anthropic API-key", hint: "alternative zu `claude login`. Format: sk-ant-…" },
      REF_API_KEY: { label: "ref-tools-mcp", hint: "aktiviert ref-tools-mcp (ref.tools). ohne key wird der server zur laufzeit gefiltert." },
      CONTEXT7_API_KEY: { label: "context7-mcp", hint: "höhere quota für context7. ohne key läuft er auf basic-tier." },
      OPENAI_API_KEY: { label: "OpenAI API-key", hint: "für eigene agents/tools, von ProjectGamma nicht direkt verwendet." },
      GITHUB_PERSONAL_ACCESS_TOKEN: { label: "GitHub PAT", hint: "github-mcp: repo-zugriff, PRs, issues. token in https://github.com/settings/tokens" },
    };

    return (
      <div className="modal-bg" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
          <div className="modal-head">
            <div>
              <div className="eyebrow">// settings</div>
              <h2 className="h2">einstellungen</h2>
            </div>
            <button className="btn tiny" onClick={onClose}>×</button>
          </div>

          {/* Deps overview — alle abhängigkeiten auf einen blick */}
          {deps && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <div className="eyebrow" style={{ flex: 1 }}>// abhängigkeiten</div>
                {deps.missingRequired && deps.missingRequired.length > 0 && (
                  <button className="btn primary tiny"
                    onClick={autoFix} disabled={autoFixing}>
                    {autoFixing ? "läuft…" : "auto-fix fehlende"}
                  </button>
                )}
              </div>
              <div style={{
                padding: 8, border: "1.5px solid var(--line)", borderRadius: 6,
                display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6,
              }}>
                {Object.entries(deps.deps).map(([name, info]) => (
                  <div key={name} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "4px 8px",
                    fontSize: 11.5, fontFamily: "monospace",
                  }}>
                    <span style={{ fontSize: 13 }}>{info.ok ? "✓" : (info.required ? "✗" : "·")}</span>
                    <strong style={{ flex: 1, color: info.ok ? "var(--ink)" : (info.required ? "#c33" : "var(--ink-faint)") }}>
                      {name}
                    </strong>
                    <span style={{ color: "var(--ink-soft)", fontSize: 10 }}>
                      {info.ok ? (info.version || "ok").slice(0, 14) : (info.required ? "fehlt" : "optional")}
                    </span>
                  </div>
                ))}
              </div>
              {autoFixLog && (
                <div style={{ marginTop: 8, padding: 8, border: "1.5px dashed var(--line)",
                  borderRadius: 6, fontSize: 11, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
                  {autoFixLog}
                </div>
              )}
            </div>
          )}

          {/* Claude-CLI section */}
          <div style={{ marginBottom: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>// claude-cli status</div>
            <div style={{
              padding: 10, border: "2px solid var(--ink)", borderRadius: 6,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ fontSize: 20 }}>{status.claude.installed ? "✓" : "✗"}</span>
              <div style={{ flex: 1, fontSize: 13 }}>
                {status.claude.installed ? (
                  <>
                    <div><strong>installiert</strong> · {status.claude.version}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-soft)", fontFamily: "monospace", marginTop: 2 }}>
                      {status.claude.path}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ color: "#c33" }}><strong>nicht gefunden</strong></div>
                    <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>
                      {status.claude.error}
                    </div>
                  </>
                )}
              </div>
              {!status.claude.installed && (
                <button className="btn primary tiny"
                        onClick={installClaude}
                        disabled={installing}>
                  {installing ? "läuft…" : "auto-install"}
                </button>
              )}
            </div>
            {installLog && (
              <div style={{ marginTop: 8, padding: 8, border: "1.5px dashed var(--line)", borderRadius: 6, fontSize: 11.5, fontFamily: "monospace" }}>
                {installLog}
              </div>
            )}
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.5 }}>
              tipp: erstmal `claude login` im terminal ausführen — verwendet deinen Anthropic-account. Alternativ unten den API-key eintragen.
            </div>
          </div>

          {/* API-keys section */}
          <div className="eyebrow" style={{ marginBottom: 8 }}>// API-keys</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {status.knownKeys.map(key => {
              const meta = keyMeta[key] || { label: key, hint: "" };
              const value = status.settings[key]; // 'unset' or 'set (…XXXX)'
              const isSet = value !== "unset";
              const editingValue = editing[key];
              const isEditing = editingValue !== undefined;
              return (
                <div key={key} style={{
                  padding: 10, border: "1.5px solid var(--line)", borderRadius: 6,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <strong style={{ fontSize: 13 }}>{meta.label}</strong>
                    <span style={{ flex: 1, fontSize: 11, color: "var(--ink-faint)", fontFamily: "monospace" }}>{key}</span>
                    <span className={"chip" + (isSet ? " solid" : "")} style={{ fontSize: 10 }}>{value}</span>
                  </div>
                  {meta.hint && (
                    <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 6, lineHeight: 1.5 }}>
                      {meta.hint}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6 }}>
                    <input className="input"
                           type="password"
                           placeholder={isSet ? "neuen wert eingeben um zu ändern" : "key eingeben…"}
                           style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
                           value={editingValue || ""}
                           onChange={(e) => setEditing(s => ({ ...s, [key]: e.target.value }))}
                           onKeyDown={(e) => { if (e.key === "Enter" && editingValue) save(key); }} />
                    <button className="btn tiny primary"
                            disabled={busy || !isEditing || !editingValue}
                            onClick={() => save(key)}>speichern</button>
                    {isSet && (
                      <button className="btn tiny danger"
                              disabled={busy}
                              onClick={() => clear(key)}>×</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {err && (
            <div style={{ marginTop: 12, padding: 8, border: "1.5px solid #c33", borderRadius: 6, color: "#c33", fontSize: 12 }}>
              {err}
            </div>
          )}

          <div style={{ marginTop: 14, fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.5 }}>
            keys werden in <code>sync-server/user_settings.json</code> gespeichert (klartext, lokal). beim spawn von claude+MCPs werden sie als env-vars injiziert. keys werden in api-antworten maskiert.
          </div>
        </div>
      </div>
    );
  }

  window.SettingsModal = SettingsModal;
})();
