// ProjectSettingsModal · alles seltener-gebrauchte zum projekt selbst.
// Beschreibung · projektziele · dateistruktur · tech · pfad.
// Trigger via MoreMenu → "✎ projekt-details".

(function () {
  const { useState } = React;
  if (!React) return;

  const TECH_OPTIONS = [
    "flutter", "react", "next.js", "node", "python", "rust", "go", "swift", "android", "ios", "anderes",
  ];

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function ProjectSettingsModal({ project, onClose }) {
    if (!project) return null;
    const client = window.useSync ? window.useSync() : null;
    const goals = project.goals || [];
    const files = project.files || [];

    const [newGoal, setNewGoal] = useState("");
    const [newFile, setNewFile] = useState({ name: "", depth: 0 });

    const patch = (p) => client?.mutate("PATCH_PROJECT", { projectId: project.id, patch: p });
    const setGoals = (g) => client?.mutate("SET_GOALS", { projectId: project.id, goals: g });
    const setFiles = (f) => client?.mutate("SET_FILES", { projectId: project.id, files: f });

    const addGoal = () => {
      const v = newGoal.trim();
      if (!v) return;
      setGoals([...goals, v]);
      setNewGoal("");
    };
    const editGoal = (i, v) => {
      const next = [...goals];
      next[i] = v;
      setGoals(next);
    };
    const removeGoal = (i) => setGoals(goals.filter((_, idx) => idx !== i));

    const addFile = () => {
      const v = newFile.name.trim();
      if (!v) return;
      setFiles([...files, { id: uid(), name: v, depth: Number(newFile.depth) || 0 }]);
      setNewFile({ name: "", depth: 0 });
    };
    const removeFile = (id) => setFiles(files.filter(f => f.id !== id));
    const renameFile = (id, name) => setFiles(files.map(f => f.id === id ? { ...f, name } : f));
    const indentFile = (id, delta) => setFiles(files.map(f =>
      f.id === id ? { ...f, depth: Math.max(0, Math.min(5, (f.depth || 0) + delta)) } : f
    ));

    return (
      <div className="modal-bg" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()}
             style={{ width: "min(720px, 96vw)", maxHeight: "92vh", padding: 0, gap: 0 }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "14px 18px", borderBottom: "1.5px solid var(--line)" }}>
            <div>
              <div className="eyebrow">// projekt-details</div>
              <h2 className="h2" style={{ margin: "2px 0 0 0" }}>{project.name}</h2>
            </div>
            <button className="btn tiny" onClick={onClose} title="schließen">×</button>
          </div>

          {/* Body — scrollbar */}
          <div style={{ padding: 18, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18, flex: 1, minHeight: 0 }}>

            {/* Beschreibung */}
            <SectionDescription project={project} client={client} patch={patch} />

            {/* Tech + Pfad — zwei spalten */}
            <section style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
              <div>
                <div className="eyebrow">// tech-stack</div>
                <select className="input" style={{ width: "100%", marginTop: 6 }}
                        value={project.tech || "anderes"}
                        onChange={e => patch({ tech: e.target.value })}>
                  {TECH_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <div className="eyebrow">// lokaler pfad <span style={{ opacity: 0.5 }}>· für IDE-launch + cc-spawn</span></div>
                <input className="input" style={{ width: "100%", marginTop: 6, fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}
                       placeholder="/home/dev/projects/wave-fx"
                       defaultValue={project.path || ""}
                       onBlur={e => {
                         const v = e.target.value.trim();
                         if (v !== (project.path || "")) patch({ path: v });
                       }} />
                {project.path && project.pathValid === false && (
                  <div style={{ marginTop: 4, fontSize: 11, color: "var(--danger, #c33)" }}>
                    ⚠ pfad existiert nicht auf diesem rechner — cloud-code kann hier nicht arbeiten.
                    {" "}bei team-collab: pfad pro rechner anpassen.
                  </div>
                )}
                {project.path && project.pathValid === true && (
                  <div style={{ marginTop: 4, fontSize: 11, color: "var(--ok, #2a8)" }}>
                    ✓ pfad gefunden
                  </div>
                )}
              </div>
            </section>

            {/* Projektziele */}
            <section>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="eyebrow">// projektziele <span style={{ opacity: 0.5 }}>· cc nutzt sie als kontext</span></span>
                <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{goals.length} stk</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input className="input" style={{ flex: 1 }}
                       placeholder="was soll erreicht werden?"
                       value={newGoal}
                       onChange={e => setNewGoal(e.target.value)}
                       onKeyDown={e => { if (e.key === "Enter") addGoal(); }} />
                <button className="btn primary tiny" onClick={addGoal} disabled={!newGoal.trim()}>+ ziel</button>
              </div>
              {goals.length === 0 ? (
                <div className="empty" style={{ marginTop: 8 }}><div>noch keine ziele formuliert.</div></div>
              ) : (
                <ul className="goals" style={{ marginTop: 8 }}>
                  {goals.map((g, i) => (
                    // key bewusst stabil pro position+text — sonst übernimmt das input bei
                    // remove den state der nachrückenden zeile.
                    <li key={`${i}:${g}`}>
                      <input className="input" style={{ flex: 1, border: "none", padding: 0, background: "transparent" }}
                             defaultValue={g}
                             onBlur={e => {
                               const v = e.target.value.trim();
                               if (v === g) return;
                               // Leer geräumt → als löschen behandeln statt silent drop
                               // (sonst denkt der user die löschung wurde gespeichert).
                               if (!v) { removeGoal(i); return; }
                               editGoal(i, v);
                             }} />
                      <button className="x-btn" onClick={() => removeGoal(i)} title="ziel entfernen">×</button>
                    </li>
                  ))}
                </ul>
              )}
              {goals.length > 0 && (
                <button className="btn tiny"
                  style={{ marginTop: 8 }}
                  title="cc generiert milestones + tasks aus den zielen"
                  onClick={async () => {
                    if (!confirm("aus den " + goals.length + " zielen einen task-plan generieren? (1× claude-call, ~$0.20)")) return;
                    try {
                      const t = window.sync?.token || "";
                      const r = await fetch(window.sync.serverUrl + "/api/projects/" + encodeURIComponent(project.id) + "/plan-from-goals", {
                        method: "POST",
                        headers: { "content-type": "application/json", authorization: "Bearer " + t },
                      });
                      const data = await r.json().catch(() => ({}));
                      if (r.ok) {
                        alert("✓ auto-plan gestartet. tasks erscheinen gleich im aufgaben-tab.");
                      } else {
                        alert("⚠ " + (data.error || ("fehler " + r.status)));
                      }
                    } catch (e) {
                      alert("⚠ " + (e.message || "fehler"));
                    }
                  }}>
                  ✨ aus zielen tasks generieren (auto-plan)
                </button>
              )}
            </section>

            {/* Dateistruktur */}
            <section>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="eyebrow">// dateistruktur <span style={{ opacity: 0.5 }}>· hint für cc · ordner mit "/" am ende</span></span>
                <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{files.length} stk</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                <input className="input" style={{ flex: 1 }}
                       placeholder="z.B. lib/services/ oder pubspec.yaml"
                       value={newFile.name}
                       onChange={e => setNewFile(s => ({ ...s, name: e.target.value }))}
                       onKeyDown={e => { if (e.key === "Enter") addFile(); }} />
                <select className="input" style={{ width: 70 }}
                        value={newFile.depth}
                        onChange={e => setNewFile(s => ({ ...s, depth: Number(e.target.value) }))}>
                  {[0,1,2,3,4,5].map(d => <option key={d} value={d}>↘ {d}</option>)}
                </select>
                <button className="btn primary tiny" onClick={addFile} disabled={!newFile.name.trim()}>+</button>
              </div>
              {files.length === 0 ? (
                <div className="empty" style={{ marginTop: 8 }}><div>noch keine struktur erfasst.</div></div>
              ) : (
                <div className="tree" style={{ marginTop: 8 }}>
                  {files.map(f => {
                    const isDir = /\/$/.test(f.name);
                    return (
                      <div key={f.id} className="tree-row" style={{ "--depth": f.depth || 0 }}>
                        <span className="tree-glyph">{isDir ? "📁" : "📄"}</span>
                        <input className="tree-name" style={{ border: "none", background: "transparent", padding: 0, flex: 1, fontFamily: "inherit", fontSize: 12 }}
                               defaultValue={f.name}
                               onBlur={e => {
                                 const v = e.target.value.trim();
                                 if (v === f.name) return;
                                 // Leer geräumt → als löschen behandeln (sonst silent drop)
                                 if (!v) { removeFile(f.id); return; }
                                 renameFile(f.id, v);
                               }} />
                        <div className="tree-actions">
                          <button className="x-btn" title="einrücken" onClick={() => indentFile(f.id, +1)}>→</button>
                          <button className="x-btn" title="ausrücken" onClick={() => indentFile(f.id, -1)}>←</button>
                          <button className="x-btn" title="entfernen" onClick={() => removeFile(f.id)}>×</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Footer */}
          <div style={{ padding: "10px 18px", borderTop: "1.5px solid var(--line)",
                        display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>änderungen werden live gespeichert</span>
            <button className="btn primary tiny" onClick={onClose}>fertig</button>
          </div>
        </div>
      </div>
    );
  }

  // Description-section mit AI-summarize-button. Kurze description landet
  // im Header (clamp), lange version wird in `descriptionLong` gehalten.
  function SectionDescription({ project, client, patch }) {
    const serverValue = project.description || project.descriptionLong || "";
    const [text, setText] = useState(serverValue);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const [preview, setPreview] = useState(null); // { summary, originalLength }
    const [focused, setFocused] = useState(false);
    const dirty = text !== serverValue;
    // Live-update sync: wenn der server-wert sich ändert (zB ein team-mate hat
    // parallel editiert), zieh den neuen wert ins textarea — aber NUR wenn der
    // user gerade nicht tippt und nichts ungespeichertes vorliegt.
    React.useEffect(() => {
      if (focused || dirty) return;
      if (text !== serverValue) setText(serverValue);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serverValue]);

    const commit = () => {
      if (text === (project.description || project.descriptionLong || "")) return;
      // Wenn user manuell editiert: descriptionLong nicht überschreiben falls schon gesetzt
      patch({ description: text });
    };
    const summarize = async () => {
      setErr(null); setPreview(null); setBusy(true);
      try {
        const r = await fetch(client.serverUrl + "/api/cc/summarize", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer " + client.token },
          body: JSON.stringify({ projectId: project.id, text }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `fehler (${r.status})`);
        setPreview(data);
      } catch (e) { setErr(e.message); }
      finally { setBusy(false); }
    };
    const applyPreview = () => {
      if (!preview) return;
      // Speichere die volle version als `descriptionLong`, summary als `description`.
      patch({ description: preview.summary, descriptionLong: text });
      setText(preview.summary);
      setPreview(null);
    };
    const restoreLong = () => {
      if (!project.descriptionLong) return;
      patch({ description: project.descriptionLong, descriptionLong: null });
      setText(project.descriptionLong);
    };

    return (
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="eyebrow">// beschreibung</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {project.descriptionLong && (
              <button className="btn tiny" onClick={restoreLong} title="lange version wiederherstellen">
                ↺ lange version
              </button>
            )}
            <button className="btn tiny" onClick={summarize}
                    disabled={busy || !text.trim() || text.length < 80}
                    title={text.length < 80 ? "ai-kürzen erst ab ~80 zeichen sinnvoll" : "claude kürzt auf 1 zeile (max ~120 chars)"}>
              {busy ? "kürze…" : "✨ ai-kürzen"}
            </button>
          </div>
        </div>
        <textarea className="input"
                  style={{ width: "100%", marginTop: 6, minHeight: 70, fontFamily: "inherit", resize: "vertical" }}
                  placeholder="kurzbeschreibung des projekts — was, für wen, warum"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => { setFocused(false); commit(); }} />
        {err && <div style={{ color: "#c33", fontSize: 12, marginTop: 4 }}>⚠ {err}</div>}
        {preview && (
          <div style={{ marginTop: 8, padding: 10, border: "1.5px dashed var(--ink)", borderRadius: 6, background: "rgba(0,150,80,0.05)" }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>// ai-kürzung · vorschau</div>
            <div style={{ fontSize: 13, color: "var(--ink)", marginBottom: 6 }}>{preview.summary}</div>
            <div style={{ fontSize: 11, color: "var(--ink-faint)", marginBottom: 8 }}>
              {preview.originalLength} → {preview.summary.length} chars · lange version wird unter „↺ lange version" wiederherstellbar
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn primary tiny" onClick={applyPreview}>✓ übernehmen</button>
              <button className="btn tiny" onClick={() => setPreview(null)}>✕ verwerfen</button>
            </div>
          </div>
        )}
      </section>
    );
  }

  window.ProjectSettingsModal = ProjectSettingsModal;
})();
