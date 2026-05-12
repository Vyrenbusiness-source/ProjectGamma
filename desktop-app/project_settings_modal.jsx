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
            <section>
              <div className="eyebrow">// beschreibung</div>
              <textarea className="input"
                        style={{ width: "100%", marginTop: 6, minHeight: 70, fontFamily: "inherit", resize: "vertical" }}
                        placeholder="kurzbeschreibung des projekts — was, für wen, warum"
                        defaultValue={project.description || ""}
                        onBlur={e => {
                          const v = e.target.value;
                          if (v !== (project.description || "")) patch({ description: v });
                        }} />
            </section>

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
                    <li key={i}>
                      <input className="input" style={{ flex: 1, border: "none", padding: 0, background: "transparent" }}
                             defaultValue={g}
                             onBlur={e => {
                               const v = e.target.value.trim();
                               if (v && v !== g) editGoal(i, v);
                             }} />
                      <button className="x-btn" onClick={() => removeGoal(i)} title="ziel entfernen">×</button>
                    </li>
                  ))}
                </ul>
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
                                 if (v && v !== f.name) renameFile(f.id, v);
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

  window.ProjectSettingsModal = ProjectSettingsModal;
})();
