// TeamPanel · chat + notes + appointments für gemeinsame projekt-arbeit.
// Liest project.messages / .notes / .appointments aus dem live-state und
// schreibt mutations via sync.mutate(). Server hängt author/authorEmail
// automatisch aus session-ctx an — kein spoofing möglich.
//
// Stil: passt sich an die bestehenden box/chip/btn-styles an.

(function () {
  const { useState, useRef, useEffect, useMemo } = React;
  if (!React) return;

  function relTime(ts) {
    const s = Math.floor((Date.now() - (ts || 0)) / 1000);
    if (s < 5) return "jetzt";
    if (s < 60) return s + "s";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
    } catch (_) { return iso; }
  }

  function authorLabel(m) {
    return m.authorEmail || (m.author && m.author.startsWith("device:") ? m.author.slice(7) : (m.author || "?"));
  }

  function ChatSection({ project, sync, myEmail }) {
    const [draft, setDraft] = useState("");
    const [uploading, setUploading] = useState(false);
    const [pendingAttachment, setPendingAttachment] = useState(null); // { fileId, name, kind, url }
    const [error, setError] = useState(null);
    const messages = project.messages || [];
    const listRef = useRef(null);
    const fileInputRef = useRef(null);
    useEffect(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }, [messages.length]);

    const send = () => {
      const t = draft.trim();
      // Nachricht braucht text ODER attachment
      if (!t && !pendingAttachment) return;
      const message = { text: t };
      if (pendingAttachment) message.attachment = pendingAttachment;
      sync.mutate("ADD_MESSAGE", { projectId: project.id, message });
      setDraft("");
      setPendingAttachment(null);
      setError(null);
    };

    const onPickFile = () => {
      if (fileInputRef.current) fileInputRef.current.click();
    };
    const onFileSelected = async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = ""; // reset für re-pick selber datei
      if (!file) return;
      // 8 MB cap (gleicher cap wie server)
      if (file.size > 8 * 1024 * 1024) {
        setError("datei zu groß (max 8 MB)");
        return;
      }
      setUploading(true); setError(null);
      try {
        const buf = await file.arrayBuffer();
        // base64 encode — chunkweise um stack-overflow bei großen files zu vermeiden
        const bytes = new Uint8Array(buf);
        let bin = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        const base64 = btoa(bin);
        const r = await fetch(sync.serverUrl + "/api/projects/" + encodeURIComponent(project.id) + "/attachments", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": "Bearer " + sync.token,
          },
          body: JSON.stringify({
            name: file.name,
            contentType: file.type || "application/octet-stream",
            base64,
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || ("upload fehler " + r.status));
        setPendingAttachment({
          fileId: data.fileId, name: data.name, kind: data.kind, url: data.url,
        });
      } catch (e) {
        setError(e.message || "upload fehlgeschlagen");
      } finally {
        setUploading(false);
      }
    };

    return (
      <div className="box" style={{ marginBottom: 18 }}>
        <div className="eyebrow">// projekt-chat <span style={{ opacity: 0.5 }}>· {messages.length}</span></div>
        <div ref={listRef} style={{
          maxHeight: 320, minHeight: 80, overflowY: "auto",
          background: "rgba(0,0,0,0.02)",
          border: "1.5px dashed var(--line)", borderRadius: 6,
          padding: 8, marginTop: 8, marginBottom: 8,
        }}>
          {messages.length === 0 ? (
            <div style={{ color: "var(--ink-faint)", fontSize: 12, padding: 8, fontStyle: "italic" }}>
              noch keine nachrichten. schreib was, deine team-mitglieder sehen es live.
            </div>
          ) : messages.map(m => {
            const isOwn = myEmail && authorLabel(m) === myEmail;
            return (
              <div key={m.id} style={{
                marginBottom: 8,
                display: "flex",
                justifyContent: isOwn ? "flex-end" : "flex-start",
              }}>
                <div style={{
                  maxWidth: "75%",
                  padding: "6px 10px",
                  background: isOwn ? "var(--ink)" : "var(--paper)",
                  color: isOwn ? "var(--paper)" : "var(--ink)",
                  border: "1.5px solid var(--ink)",
                  borderRadius: 10,
                  borderBottomRightRadius: isOwn ? 2 : 10,
                  borderBottomLeftRadius: isOwn ? 10 : 2,
                }}>
                  <div style={{
                    fontSize: 10.5,
                    opacity: 0.65,
                    fontFamily: "monospace",
                    marginBottom: 2,
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    <span style={{ flex: 1 }}>{authorLabel(m)} · {relTime(m.ts)}</span>
                    <button onClick={() => { if (confirm("nachricht löschen?")) sync.mutate("REMOVE_MESSAGE", { projectId: project.id, messageId: m.id }); }}
                      style={{
                        background: "transparent", border: "none",
                        color: "inherit", opacity: 0.7, cursor: "pointer",
                        fontSize: 13, padding: 0,
                      }}>×</button>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {m.text}
                  </div>
                  {m.attachment && m.attachment.url && (
                    <div style={{ marginTop: 6 }}>
                      {m.attachment.kind === "image" ? (
                        <img src={(sync.serverUrl || "") + m.attachment.url}
                          alt={m.attachment.name}
                          style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid rgba(0,0,0,0.15)" }} />
                      ) : (
                        <div style={{ fontSize: 11, opacity: 0.8, fontFamily: "monospace" }}>
                          📎 {m.attachment.name}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {pendingAttachment && (
          <div style={{
            marginBottom: 6, padding: 8,
            border: "1.5px dashed var(--ink)", borderRadius: 6,
            display: "flex", alignItems: "center", gap: 8,
            fontSize: 12, background: "rgba(0,0,0,0.03)",
          }}>
            <span>{pendingAttachment.kind === "image" ? "🖼" : "📎"}</span>
            <span style={{ flex: 1, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {pendingAttachment.name}
            </span>
            <button className="btn tiny" onClick={() => setPendingAttachment(null)}>entfernen</button>
          </div>
        )}
        {error && (
          <div style={{
            marginBottom: 6, padding: 6, fontSize: 11.5,
            color: "var(--danger, #c33)",
            border: "1.5px solid var(--danger, #c33)", borderRadius: 6,
          }}>⚠ {error}</div>
        )}
        <input ref={fileInputRef} type="file" style={{ display: "none" }}
          onChange={onFileSelected}
          accept="image/*,application/pdf,application/zip,text/*,audio/*,video/*" />
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn" onClick={onPickFile} disabled={uploading} title="anhang">
            {uploading ? "…" : "📎"}
          </button>
          <textarea className="input" placeholder="nachricht an team…"
            value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }}
            rows={2} style={{ flex: 1 }} />
          <button className="btn primary"
            disabled={(!draft.trim() && !pendingAttachment) || uploading}
            onClick={send}>senden</button>
        </div>
        <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 4 }}>
          ⌘/Strg+Enter = senden · 📎 anhang (max 8 MB)
        </div>
      </div>
    );
  }

  function NotesSection({ project, sync }) {
    const notes = project.notes || [];
    const [editing, setEditing] = useState(null); // noteId | "new" | null
    const [draft, setDraft] = useState({ title: "", body: "" });

    const openNew = () => { setEditing("new"); setDraft({ title: "", body: "" }); };
    const openEdit = (n) => { setEditing(n.id); setDraft({ title: n.title, body: n.body }); };
    const cancel = () => { setEditing(null); setDraft({ title: "", body: "" }); };
    const save = () => {
      if (!draft.title.trim() && !draft.body.trim()) return;
      if (editing === "new") {
        sync.mutate("ADD_NOTE", { projectId: project.id, note: draft });
      } else {
        sync.mutate("EDIT_NOTE", { projectId: project.id, noteId: editing, patch: draft });
      }
      cancel();
    };

    return (
      <div className="box" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div className="eyebrow" style={{ flex: 1 }}>// notizen <span style={{ opacity: 0.5 }}>· {notes.length}</span></div>
          {editing == null && (
            <button className="btn tiny primary" onClick={openNew}>+ neue notiz</button>
          )}
        </div>
        {editing != null && (
          <div style={{ marginTop: 8, padding: 10, border: "2px dashed var(--ink)", borderRadius: 6 }}>
            <input className="input big" placeholder="titel" autoFocus
              value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
            <textarea className="input" placeholder="text (markdown ok)" rows={5}
              style={{ marginTop: 6 }}
              value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} />
            <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
              <button className="btn" onClick={cancel}>abbrechen</button>
              <button className="btn primary"
                disabled={!draft.title.trim() && !draft.body.trim()}
                onClick={save}>{editing === "new" ? "anlegen" : "speichern"}</button>
            </div>
          </div>
        )}
        {notes.length === 0 && editing == null && (
          <div className="empty" style={{ padding: 14, marginTop: 8 }}>noch keine notizen.</div>
        )}
        {notes.map(n => (
          <div key={n.id} style={{
            marginTop: 8, padding: 10, border: "1.5px solid var(--line)", borderRadius: 6,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong style={{ flex: 1, fontSize: 13.5 }}>{n.title || "(ohne titel)"}</strong>
              <span style={{ fontSize: 10.5, color: "var(--ink-faint)", fontFamily: "monospace" }}>
                {authorLabel(n)} · {relTime(n.updatedAt || n.ts)}
              </span>
              <button className="btn tiny" onClick={() => openEdit(n)}>✎</button>
              <button className="btn tiny danger" onClick={() => {
                if (confirm("notiz löschen?")) sync.mutate("REMOVE_NOTE", { projectId: project.id, noteId: n.id });
              }}>×</button>
            </div>
            {n.body && (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 6, whiteSpace: "pre-wrap" }}>
                {n.body}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  function AppointmentsSection({ project, sync, myEmail }) {
    const appts = (project.appointments || []).slice().sort(
      (a, b) => new Date(a.when || 0) - new Date(b.when || 0));
    const [editing, setEditing] = useState(null); // id | "new" | null
    const [draft, setDraft] = useState({ title: "", when: "", durationMin: 30, notes: "" });

    const openNew = () => {
      const t = new Date(Date.now() + 60 * 60 * 1000); // +1h default
      const local = new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      setEditing("new"); setDraft({ title: "", when: local, durationMin: 30, notes: "" });
    };
    const openEdit = (a) => {
      const d = new Date(a.when);
      const local = isNaN(d.getTime()) ? "" : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      setEditing(a.id); setDraft({ title: a.title, when: local, durationMin: a.durationMin || 30, notes: a.notes || "" });
    };
    const cancel = () => setEditing(null);
    const save = () => {
      if (!draft.title.trim() || !draft.when) return;
      const iso = new Date(draft.when).toISOString();
      if (editing === "new") {
        sync.mutate("ADD_APPOINTMENT", {
          projectId: project.id,
          appointment: { title: draft.title, when: iso, durationMin: Number(draft.durationMin) || 30, notes: draft.notes },
        });
      } else {
        sync.mutate("EDIT_APPOINTMENT", {
          projectId: project.id, appointmentId: editing,
          patch: { title: draft.title, when: iso, durationMin: Number(draft.durationMin) || 30, notes: draft.notes },
        });
      }
      cancel();
    };

    return (
      <div className="box">
        <div style={{ display: "flex", alignItems: "center" }}>
          <div className="eyebrow" style={{ flex: 1 }}>// termine <span style={{ opacity: 0.5 }}>· {appts.length}</span></div>
          {editing == null && (
            <button className="btn tiny primary" onClick={openNew}>+ neuer termin</button>
          )}
        </div>
        {editing != null && (
          <div style={{ marginTop: 8, padding: 10, border: "2px dashed var(--ink)", borderRadius: 6 }}>
            <input className="input" placeholder="titel" autoFocus
              value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input className="input" type="datetime-local"
                value={draft.when} onChange={e => setDraft(d => ({ ...d, when: e.target.value }))}
                style={{ flex: 1 }} />
              <input className="input" type="number" min="5" max="480" placeholder="min"
                value={draft.durationMin} onChange={e => setDraft(d => ({ ...d, durationMin: e.target.value }))}
                style={{ width: 90 }} />
            </div>
            <textarea className="input" placeholder="notizen (optional)" rows={2}
              style={{ marginTop: 6 }}
              value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} />
            <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
              <button className="btn" onClick={cancel}>abbrechen</button>
              <button className="btn primary"
                disabled={!draft.title.trim() || !draft.when}
                onClick={save}>{editing === "new" ? "anlegen" : "speichern"}</button>
            </div>
          </div>
        )}
        {appts.length === 0 && editing == null && (
          <div className="empty" style={{ padding: 14, marginTop: 8 }}>keine termine.</div>
        )}
        {appts.map(a => {
          const goes = myEmail && (a.attendees || []).includes(myEmail);
          return (
            <div key={a.id} style={{
              marginTop: 8, padding: 10,
              border: "1.5px solid var(--line)", borderRadius: 6,
              display: "flex", alignItems: "flex-start", gap: 10,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <strong style={{ fontSize: 13.5 }}>{a.title}</strong>
                  <span className="chip">{a.durationMin || 30} min</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontFamily: "monospace" }}>
                  📅 {fmtDate(a.when)}
                </div>
                {a.notes && (
                  <div style={{ fontSize: 12, marginTop: 4, color: "var(--ink-soft)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {a.notes}
                  </div>
                )}
                <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 4 }}>
                  von {authorLabel(a)} · {(a.attendees || []).length} zusagen
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {myEmail && (
                  <button className={"btn tiny" + (goes ? " primary" : "")}
                    onClick={() => sync.mutate("TOGGLE_APPOINTMENT_RSVP", {
                      projectId: project.id, appointmentId: a.id, attendee: myEmail,
                    })}>{goes ? "✓ zusage" : "zusagen"}</button>
                )}
                <button className="btn tiny" onClick={() => openEdit(a)}>✎</button>
                <button className="btn tiny danger" onClick={() => {
                  if (confirm("termin löschen?")) sync.mutate("REMOVE_APPOINTMENT", { projectId: project.id, appointmentId: a.id });
                }}>×</button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function TeamPanel({ project, sync, myEmail }) {
    if (!project) return null;
    return (
      <div>
        <ChatSection project={project} sync={sync} myEmail={myEmail} />
        <NotesSection project={project} sync={sync} />
        <AppointmentsSection project={project} sync={sync} myEmail={myEmail} />
      </div>
    );
  }

  window.TeamPanel = TeamPanel;
  // Einzelne sektionen exportieren, damit die übersicht sie kompakt einbetten kann.
  window.TeamChatSection = ChatSection;
  window.TeamNotesSection = NotesSection;
  window.TeamAppointmentsSection = AppointmentsSection;
})();
