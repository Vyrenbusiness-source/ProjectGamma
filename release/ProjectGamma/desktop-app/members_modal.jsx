// MembersModal · multi-user schicht 2 UI.
// Listet mitglieder, owner darf einladen/entfernen. Endpoints:
//   GET    /api/projects/:id/members
//   POST   /api/projects/:id/members        { email, role }
//   DELETE /api/projects/:id/members/:userId
//
// Isoliertes modul (window.MembersModal), feature-first.

(function () {
  const { useState, useEffect, useCallback } = React;
  if (!React) return;

  function MembersModal({ projectId, onClose }) {
    const client = window.useSync ? window.useSync() : null;
    const [members, setMembers] = useState(null);
    const [pending, setPending] = useState([]);
    const [myUserId, setMyUserId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [inviteOpen, setInviteOpen] = useState(false);
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState("member");
    const [inviteBusy, setInviteBusy] = useState(false);

    const headers = useCallback(() => ({
      authorization: "Bearer " + client.token,
      "content-type": "application/json",
    }), [client]);

    const refresh = useCallback(async () => {
      if (!client) return;
      setLoading(true); setError(null);
      try {
        // Wer bin ich? — bei pair-token kommt 401 → myUserId bleibt null
        try {
          const meRes = await fetch(client.serverUrl + "/api/auth/me", {
            headers: { authorization: "Bearer " + client.token },
          });
          if (meRes.ok) {
            const j = await meRes.json();
            setMyUserId(j.user?.id || null);
          } else { setMyUserId(null); }
        } catch (_) { setMyUserId(null); }

        const r = await fetch(
          client.serverUrl + "/api/projects/" + encodeURIComponent(projectId) + "/members",
          { headers: { authorization: "Bearer " + client.token } },
        );
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || ("fehler " + r.status));
        setMembers(data.members || []);
        setPending(data.pending || []);
      } catch (e) {
        setError((e && e.message) || "fehler");
        setMembers(null);
        setPending([]);
      } finally {
        setLoading(false);
      }
    }, [client, projectId]);

    useEffect(() => { refresh(); }, [refresh]);

    const amOwner = (() => {
      if (!myUserId || !members) return false;
      const me = members.find((m) => m.userId === myUserId);
      return me && me.role === "owner";
    })();

    const isPairToken = !myUserId; // pair-tokens haben keinen user → legacy vollzugriff
    const canInvite = amOwner || isPairToken;

    const submitInvite = async () => {
      const email = inviteEmail.trim();
      if (!email) return;
      setInviteBusy(true);
      try {
        const r = await fetch(
          client.serverUrl + "/api/projects/" + encodeURIComponent(projectId) + "/members",
          { method: "POST", headers: headers(),
            body: JSON.stringify({ email, role: inviteRole }) },
        );
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || ("fehler " + r.status));
        setInviteEmail(""); setInviteOpen(false);
        // Status 202 = pending invite (user noch nicht registriert).
        // 201 = direkt als member zugewiesen.
        if (data.pending) {
          alert("✓ einladung für " + email + " gespeichert.\n\nsobald sich der user mit dieser email registriert, bekommt er automatisch zugriff.");
        }
        refresh();
      } catch (e) {
        alert(e.message);
      } finally {
        setInviteBusy(false);
      }
    };

    const remove = async (m) => {
      if (!confirm("„" + (m.email || m.userId) + "“ aus dem projekt entfernen?")) return;
      try {
        const r = await fetch(
          client.serverUrl + "/api/projects/" + encodeURIComponent(projectId) + "/members/" +
            encodeURIComponent(m.userId),
          { method: "DELETE", headers: { authorization: "Bearer " + client.token } },
        );
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || ("fehler " + r.status));
        refresh();
      } catch (e) {
        alert(e.message);
      }
    };

    const downloadArchive = async () => {
      try {
        const r = await fetch(client.serverUrl + "/api/projects/" + encodeURIComponent(projectId) + "/archive",
          { method: "POST", headers: { authorization: "Bearer " + client.token } });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || ("fehler " + r.status));
        // Browser-download via temporary anchor
        const a = document.createElement("a");
        a.href = client.serverUrl + data.url;
        a.download = "";
        document.body.appendChild(a); a.click();
        setTimeout(() => document.body.removeChild(a), 1000);
      } catch (e) { alert("archiv-fehler: " + e.message); }
    };

    return (
      <div className="modal-bg" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
          <div className="modal-head">
            <div>
              <div className="eyebrow">// projekt-mitglieder</div>
              <h2 className="h2">mitglieder &amp; rollen</h2>
            </div>
            <button className="btn tiny" onClick={onClose}>×</button>
          </div>
          {/* TEAM-URL teilen — wichtig für cross-network collab. Damit andere
              kollegen sich auf DIESEN server registrieren können.
              FIX: client komplett übergeben (nicht nur serverUrl) — onClick-handler
              brauchen .token für authorization-header, useSync() funktioniert NICHT
              im onClick (hook-rule-violation, fetch lief unauth → 401 silent). */}
          <TeamUrlPanel client={client} />

          <div style={{
            display: "flex", gap: 8, alignItems: "center",
            padding: 10, marginBottom: 12,
            border: "1.5px dashed var(--line)", borderRadius: 6,
          }}>
            <span style={{ fontSize: 18 }}>📦</span>
            <div style={{ flex: 1, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.4 }}>
              <strong>projekt-archiv</strong> · server zipt den projektordner für team-download
            </div>
            <button className="btn tiny primary" onClick={downloadArchive}>archiv erstellen + download</button>
          </div>

          {isPairToken && (
            <div style={{
              padding: 8, marginBottom: 12,
              border: "1.5px dashed var(--line)", borderRadius: 6,
              fontSize: 11.5, color: "var(--ink-soft)", fontFamily: "monospace", lineHeight: 1.5,
            }}>
              du bist mit einem <strong>pair-token</strong> verbunden (legacy
              vollzugriff). für rollen-checks logge dich mit einem account ein
              („🔐 account").
            </div>
          )}

          {loading ? (
            <div className="empty" style={{ padding: 20 }}>lade…</div>
          ) : error ? (
            <div style={{ color: "#c33", padding: 8, border: "1.5px solid #c33", borderRadius: 6 }}>
              {error}
            </div>
          ) : !members || members.length === 0 ? (
            <div className="empty" style={{ padding: 14 }}>
              keine mitglieder. lege einen account-user an („🔐 account") oder lade einen ein.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {members.map((m) => {
                const me = myUserId && m.userId === myUserId;
                const canRemove = canInvite && !me;
                return (
                  <div key={m.userId} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 10px",
                    border: "2px solid var(--ink)", borderRadius: 6, background: "var(--paper)",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {m.email || m.userId}
                        {me && <span className="chip" style={{ marginLeft: 6 }}>du</span>}
                      </div>
                      <div style={{ marginTop: 3 }}>
                        <span className={"chip" + (m.role === "owner" ? " solid" : "")}>
                          {m.role}
                        </span>
                      </div>
                    </div>
                    {canRemove && (
                      <button className="btn tiny danger" onClick={() => remove(m)} title="entfernen">×</button>
                    )}
                  </div>
                );
              })}
              {pending.length > 0 && pending.map((p) => (
                <div key={"pending-" + p.email} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px",
                  border: "2px dashed var(--ink-faint, #aaa)", borderRadius: 6,
                  background: "var(--paper-soft, #fafaf7)", opacity: 0.85,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.email}
                      <span className="chip" style={{ marginLeft: 6 }}>einladung gesendet</span>
                    </div>
                    <div style={{ marginTop: 3, fontSize: 11, color: "var(--ink-soft)" }}>
                      rolle: <strong>{p.role}</strong> · wartet auf registrierung mit dieser email
                    </div>
                  </div>
                  {canInvite && (
                    <button className="btn tiny danger"
                            onClick={async () => {
                              try {
                                await fetch(client.serverUrl + "/api/projects/" + encodeURIComponent(projectId) + "/pending/" + encodeURIComponent(p.email), {
                                  method: "DELETE",
                                  headers: { authorization: "Bearer " + client.token },
                                });
                                setPending(pending.filter(x => x.email !== p.email));
                              } catch (_) {}
                            }}
                            title="einladung zurückziehen">×</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canInvite && !inviteOpen && (
            <div style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={() => setInviteOpen(true)}>
                + mitglied einladen
              </button>
            </div>
          )}

          {canInvite && inviteOpen && (
            <div style={{ marginTop: 14, padding: 10, border: "2px dashed var(--ink)", borderRadius: 6 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>// neuer member</div>
              <label className="field">
                <span className="eyebrow">email</span>
                <input className="input" type="email" autoFocus
                       value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                       placeholder="user@example.com" />
              </label>
              <div className="field">
                <span className="eyebrow">rolle</span>
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  {["owner", "member", "viewer"].map((r) => (
                    <button key={r}
                      className={"btn tiny" + (inviteRole === r ? " primary" : "")}
                      onClick={() => setInviteRole(r)}>{r}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                <button className="btn" onClick={() => { setInviteOpen(false); setInviteEmail(""); }} disabled={inviteBusy}>abbrechen</button>
                <button className="btn primary" onClick={submitInvite}
                        disabled={inviteBusy || !inviteEmail.trim()}>
                  {inviteBusy ? "…" : "einladen →"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // TeamUrlPanel · zeigt die URLs unter denen DIESER server für team-mitglieder
  // erreichbar ist. Lädt /api/network-info (öffentlich) → routes[]: lan + public-ip + tunnel.
  // Copy-button für jede route. Auto-start cloudflared tunnel auf knopfdruck.
  function TeamUrlPanel({ client }) {
    const serverUrl = client?.serverUrl || "";
    const [info, setInfo] = useState(null);
    const [tunnelBusy, setTunnelBusy] = useState(false);
    const [tunnelError, setTunnelError] = useState(null);
    const [copied, setCopied] = useState(null);

    useEffect(() => {
      let stop = false;
      async function tick() {
        if (document.hidden) return;
        try {
          const r = await fetch(serverUrl + "/api/network-info");
          if (!stop && r.ok) setInfo(await r.json());
        } catch (_) {}
      }
      tick();
      const t = setInterval(tick, 10000);
      return () => { stop = true; clearInterval(t); };
    }, [serverUrl]);

    if (!info) return null;
    const routes = info.routes || [];
    const tunnel = info.tunnel || {};
    const hasPublicTunnel = tunnel.status === "active" && tunnel.url;

    // FIX: token via client-prop. useSync() im onClick wäre invalid hook call —
    // fetch lief vorher ohne auth-header → 401 silent geschluckt im catch(_).
    const authHdr = () => client?.token
      ? { authorization: "Bearer " + client.token }
      : {};

    const startTunnel = async () => {
      setTunnelBusy(true);
      setTunnelError(null);
      try {
        const r = await fetch(serverUrl + "/api/tunnel/start", {
          method: "POST",
          headers: authHdr(),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setTunnelError(data.error || ("HTTP " + r.status));
        }
        // Info aktualisiert sich beim nächsten 5s-tick — oder direkt fetchen
        const ni = await fetch(serverUrl + "/api/network-info");
        if (ni.ok) setInfo(await ni.json());
      } catch (e) {
        setTunnelError(String(e && e.message || e));
      }
      setTunnelBusy(false);
    };
    const stopTunnel = async () => {
      setTunnelBusy(true);
      setTunnelError(null);
      try {
        const r = await fetch(serverUrl + "/api/tunnel/stop", {
          method: "POST",
          headers: authHdr(),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) setTunnelError(data.error || ("HTTP " + r.status));
        const ni = await fetch(serverUrl + "/api/network-info");
        if (ni.ok) setInfo(await ni.json());
      } catch (e) {
        setTunnelError(String(e && e.message || e));
      }
      setTunnelBusy(false);
    };
    const copy = async (url) => {
      try { await navigator.clipboard.writeText(url); setCopied(url); setTimeout(() => setCopied(null), 1500); }
      catch (_) {}
    };

    return (
      <div style={{
        padding: 10, marginBottom: 12,
        border: "2px solid var(--ink)", borderRadius: 6,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }}>🔗</span>
          <strong style={{ fontSize: 13 }}>team-URLs · für kollegen die sich hier registrieren wollen</strong>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {routes.map((r, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "5px 8px", background: "rgba(0,0,0,0.04)", borderRadius: 4,
              fontFamily: "JetBrains Mono, monospace", fontSize: 11.5,
            }}>
              <span style={{ minWidth: 100, color: "var(--ink-faint)" }}>
                {r.kind === "public-ip" ? "🌐 internet" :
                 r.kind === "lan" ? "🏠 LAN" :
                 r.kind === "tunnel" ? "🚀 tunnel" : r.kind}
              </span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{r.url}</span>
              {r.needsPortForward && <span style={{ fontSize: 10, color: "#CC8800" }}>port-forward nötig</span>}
              <button className="btn tiny" onClick={() => copy(r.url)}
                      style={{ fontSize: 10 }}>
                {copied === r.url ? "✓" : "kopieren"}
              </button>
            </div>
          ))}
          {hasPublicTunnel && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "5px 8px", background: "rgba(0,200,0,0.08)",
              border: "1.5px solid #2a8a3a", borderRadius: 4,
              fontFamily: "JetBrains Mono, monospace", fontSize: 11.5,
            }}>
              <span style={{ minWidth: 100, color: "#2a8a3a" }}>🚀 tunnel aktiv</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{tunnel.url}</span>
              <button className="btn tiny" onClick={() => copy(tunnel.url)}
                      style={{ fontSize: 10 }}>{copied === tunnel.url ? "✓" : "kopieren"}</button>
              <button className="btn tiny" onClick={stopTunnel} disabled={tunnelBusy}>stop</button>
            </div>
          )}
          {!hasPublicTunnel && (
            <button className="btn tiny"
                    onClick={startTunnel} disabled={tunnelBusy}
                    style={{ marginTop: 4, alignSelf: "flex-start" }}>
              {tunnelBusy ? "starte tunnel… (kann 10-30s dauern)" : "🚀 cloudflared-tunnel starten (öffentliche URL)"}
            </button>
          )}
          {tunnelError && (
            <div style={{
              marginTop: 6, padding: "6px 8px",
              background: "rgba(204,51,51,0.08)",
              border: "1.5px solid #c33", borderRadius: 4,
              fontSize: 11.5, color: "#c33", fontFamily: "JetBrains Mono, monospace",
            }}>
              tunnel-fehler: {tunnelError}
            </div>
          )}
        </div>
        <div style={{
          marginTop: 8, fontSize: 10.5, color: "var(--ink-faint)",
          fontFamily: "JetBrains Mono, monospace", lineHeight: 1.5,
        }}>
          {hasPublicTunnel
            ? "schick deinem kollegen die tunnel-URL. er wählt im welcome-screen \"team beitreten\", trägt die URL ein, registriert sich. dann kannst du ihn unten einladen."
            : "kollege im selben WLAN → LAN-URL reicht. von außen → tunnel starten."}
        </div>
      </div>
    );
  }

  window.MembersModal = MembersModal;
})();
