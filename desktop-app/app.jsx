/* ProjectGamma · Desktop · Server-Client (Variant A · Ambient)
   - Verbindet sich beim Boot via /api/pair/desktop-init mit lokalem Sync-Server
   - Alle Mutations gehen über WebSocket an Server → Broadcast an alle Clients
   - Pairing-Code-Generator für Mobile-Verbindung
   - Echte Cloud-Code-Integration (claude CLI subprocess)                     */

const { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } = React;

const RULE_CATS    = ["code-stil", "architektur", "workflow"];

// Theme-toggle: light (default) ↔ "dim" (soft-dark). Persistiert in
// localStorage und wird sofort beim mount auf <html data-theme> appliziert.
// Spec aus user: ähnlich wie dark-mode aber besser aussehend — daher
// warm-gray statt knall-schwarz (siehe styles.css [data-theme="dim"]).
function applyTheme(theme) {
  try {
    document.documentElement.setAttribute("data-theme", theme === "dim" ? "dim" : "");
    localStorage.setItem("pg-theme", theme);
  } catch (_) {}
}
// Initial apply NOCH BEVOR React mountet, damit kein flash.
// Default: "dim" (soft-dark) — user-request: dark als standard.
(function() {
  try {
    const t = localStorage.getItem("pg-theme") || "dim";
    if (t === "dim") document.documentElement.setAttribute("data-theme", "dim");
  } catch (_) {
    // localStorage nicht verfügbar → trotzdem dim als default
    document.documentElement.setAttribute("data-theme", "dim");
  }
})();
// Server-restart-banner: server.publicState liefert serverBootTs. Wenn
// der wert sich seit erstem connect ändert → server wurde neu gestartet
// (vermutlich nach owner-update via update.bat). Wir zeigen einen banner
// mit reload-button. KEIN auto-reload — würde user-drafts vernichten.
function UpdateAvailableBanner({ state }) {
  const [firstBoot, setFirstBoot] = useState(null);
  const currentBoot = state && state.serverBootTs;
  useEffect(() => {
    if (currentBoot && firstBoot == null) setFirstBoot(currentBoot);
  }, [currentBoot]);
  if (!currentBoot || firstBoot == null) return null;
  if (currentBoot === firstBoot) return null;
  return (
    <button
      onClick={() => window.location.reload()}
      title="server wurde neu gestartet — wahrscheinlich nach update.bat. neu laden um die aktuelle UI zu sehen."
      style={{
        background: "var(--accent, #2a8a3a)", color: "var(--paper)",
        border: "none", borderRadius: 4, padding: "3px 10px",
        fontFamily: "inherit", fontSize: 12, cursor: "pointer",
        animation: "pulse 1.8s ease-in-out infinite",
      }}>
      🔄 update verfügbar · neu laden
    </button>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("pg-theme") || "dim"; }
    catch (_) { return "dim"; }
  });
  const toggle = () => {
    const next = theme === "dim" ? "light" : "dim";
    setTheme(next);
    applyTheme(next);
  };
  return (
    <button className="theme-toggle" onClick={toggle}
            title={theme === "dim" ? "auf hell wechseln" : "auf dim (soft-dark) wechseln"}>
      {theme === "dim" ? "☀ hell" : "🌙 dim"}
    </button>
  );
}

// Empfohlene Best-Practice-Regeln, die der User per Klick aktivieren kann.
// Werden nicht doppelt angelegt (nach lowercase-trim Vergleich).
const SUGGESTED_RULES = [
  // code-stil
  { category: "code-stil",  text: "tdd: tests vor implementation" },
  { category: "code-stil",  text: "kein toten code (unused imports/vars)" },
  { category: "code-stil",  text: "magic numbers durch konstanten ersetzen" },
  { category: "code-stil",  text: "frühe returns statt verschachtelte if's" },
  { category: "code-stil",  text: "max. 200 zeilen pro file" },
  // architektur
  { category: "architektur", text: "ein modul = eine verantwortlichkeit" },
  { category: "architektur", text: "abhängigkeitsrichtung: domain ← infrastructure" },
  { category: "architektur", text: "keine zyklen zwischen modulen" },
  { category: "architektur", text: "tests in separater struktur (test/, __tests__/)" },
  // workflow
  { category: "workflow",    text: "kein commit ohne grünes lint + test" },
  { category: "workflow",    text: "secrets nie in source-tree (env/secret-manager)" },
  { category: "workflow",    text: "semver einhalten: feat → minor, fix → patch" },
  { category: "workflow",    text: "PR-titel folgen conventional commits" },
  { category: "workflow",    text: "kein force-push auf main/master" },
];
const TECH_OPTIONS = ["flutter", "dart", "react", "typescript", "python", "rust", "go", "andere"];
const TABS = [
  { id: "overview", label: "übersicht" },
  { id: "tasks",    label: "aufgaben"  },
  { id: "rules",    label: "regeln"    },
  { id: "ideas",    label: "ideen"     },
  { id: "team",     label: "team"      },
  { id: "cloud",    label: "cloud-code" },
  { id: "preview",  label: "preview"   },
  { id: "sync",     label: "sync"      },
];

const NOW = () => Date.now();
const uid = () => Math.random().toString(36).slice(2, 9);

function relTime(ts) {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor((NOW() - ts) / 1000));
  if (s < 5) return "jetzt";
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  const d = Math.floor(h / 24);
  if (d < 7) return d + "d";
  return new Date(ts).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function timeOfDay(ts) {
  const d = new Date(ts);
  return d.getHours().toString().padStart(2, "0") + ":" +
         d.getMinutes().toString().padStart(2, "0");
}

// Singleton-Client
const sync = new SyncClient();
window.__sync = sync;
if (typeof window.swipeUndoMount === "function") window.swipeUndoMount(sync);

// React-Hook der re-rendert wenn der Client neue Events emittet
function useSync() {
  const [, setT] = useState(0);
  useEffect(() => sync.subscribe(() => setT(x => x + 1)), []);
  return sync;
}
// Expose für isolated jsx-module (account_auth_modal, members_modal)
window.useSync = useSync;

// ─── Editable: Inline-Bearbeitung ────────────────────────────
function Editable({ value, onChange, multiline = false, placeholder, className = "", style }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select?.(); }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft);
  };
  const cancel = () => { setDraft(value); setEditing(false); };

  if (editing) {
    const Tag = multiline ? "textarea" : "input";
    return (
      <Tag ref={ref} className={"editable-input " + className} style={style}
           value={draft} placeholder={placeholder}
           onChange={e => setDraft(e.target.value)}
           onBlur={commit}
           onKeyDown={e => {
             if (e.key === "Enter" && !multiline) { e.preventDefault(); commit(); }
             if (e.key === "Escape") { e.preventDefault(); cancel(); }
           }} />
    );
  }
  return (
    <span className={"editable " + className} style={style} onClick={() => setEditing(true)} title="klicken zum bearbeiten">
      {value || <span className="placeholder">{placeholder || "—"}</span>}
    </span>
  );
}

// ─── Pairing-Screen ──────────────────────────────────────────
// Wird gezeigt wenn keine Desktop-Session existiert (also beim allerersten Start
// oder wenn Server unerreichbar). Versucht zuerst self-init mit Default-URL.
function BootPairing({ onReady }) {
  // ZWEI MODI:
  // (a) "self" — default. Lokaler server, selfInit() = pair-token via /api/pair/desktop-init
  //     (localhost-only-gated server-seitig). Klappt nur wenn du dein eigenes
  //     start.bat gestartet hast.
  // (b) "team" — wenn du auf einem TEAM-server eines anderen kollegen mitarbeitest.
  //     Kein selfInit (würde 403 geben), sondern direkt zum AccountAuthModal
  //     mit der team-URL. Du registrierst/loginst dich auf dem fremden server.
  const [mode, setMode] = useState("self");
  const [serverUrl, setServerUrl] = useState(sync.serverUrl);
  const [teamUrl, setTeamUrl] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState(null);
  const [showAccountForTeam, setShowAccountForTeam] = useState(false);

  const trySelfInit = useCallback(async () => {
    setStatus("connecting"); setError(null);
    try {
      const r = await fetch(serverUrl + "/health").then(r => r.json()).catch(() => null);
      if (!r || !r.ok) throw new Error("server nicht erreichbar unter " + serverUrl);
      // Wenn server meldet isLocal=false (wir kommen über tunnel/FQDN rein),
      // KEIN selfInit versuchen — der gibt 403 und ein fremder pair-token
      // wäre eh ein security-leak. Stattdessen: AUTO direkt account-register
      // öffnen mit der server-URL vorbefüllt. So muss der team-kollege nur
      // die geteilte tunnel-URL öffnen und sich registrieren — keine
      // zwischenklicks nötig.
      if (r.isLocal === false) {
        setMode("team");
        setTeamUrl(serverUrl);
        sync.serverUrl = serverUrl;
        localStorage.setItem("projectgamma.sync.url", serverUrl);
        setStatus("idle");
        setShowAccountForTeam(true);
        return;
      }
      sync.serverUrl = serverUrl;
      await sync.selfInit();
      sync.connect();
      setStatus("ready");
      setTimeout(() => onReady(), 250);
    } catch (e) {
      setStatus("error");
      setError(e.message || String(e));
    }
  }, [serverUrl, onReady]);

  const tryJoinTeam = useCallback(async () => {
    setStatus("connecting"); setError(null);
    try {
      const url = teamUrl.trim().replace(/\/+$/, "");
      if (!url.startsWith("http")) throw new Error("URL muss mit http(s):// beginnen");
      const r = await fetch(url + "/health").then(r => r.json()).catch(() => null);
      if (!r || !r.ok) throw new Error("server nicht erreichbar unter " + url);
      // serverUrl IM CLIENT setzen, aber KEIN selfInit (würde 403 geben).
      // Stattdessen account-modal aufrufen mit dieser url als kontext.
      sync.serverUrl = url;
      localStorage.setItem("projectgamma.sync.url", url);
      setStatus("idle");
      setShowAccountForTeam(true);
    } catch (e) {
      setStatus("error");
      setError(e.message || String(e));
    }
  }, [teamUrl]);

  // Simpler invite-claim-flow: nur email, kein passwort.
  // Server prüft pending_invites — wenn email eingeladen, wird user
  // automatisch erstellt + session zurückgegeben.
  const tryClaimInvite = useCallback(async () => {
    setStatus("connecting"); setError(null);
    try {
      const url = teamUrl.trim().replace(/\/+$/, "");
      const email = inviteEmail.trim();
      if (!url.startsWith("http")) throw new Error("URL muss mit http(s):// beginnen");
      if (!email || !/@/.test(email)) throw new Error("gültige email eingeben");
      // 1) /health check
      const h = await fetch(url + "/health").then(r => r.json()).catch(() => null);
      if (!h || !h.ok) throw new Error("server nicht erreichbar unter " + url);
      // 2) claim-invite
      const r = await fetch(url + "/api/auth/claim-invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ("fehler " + r.status));
      // 3) token adoptieren wie bei register
      sync.serverUrl = url;
      sync.token = data.token;
      sync.deviceName = data.user?.email || email;
      localStorage.setItem("projectgamma.sync.url", url);
      localStorage.setItem("projectgamma.sync.token", data.token);
      localStorage.setItem("projectgamma.sync.deviceName", sync.deviceName);
      setStatus("ready");
      sync.connect();
      setTimeout(() => onReady(), 400);
    } catch (e) {
      setStatus("error");
      setError(e.message || String(e));
    }
  }, [teamUrl, inviteEmail, onReady]);

  // Auto-Versuch beim Mount NUR in mode=self. Bei team braucht der user erst die URL.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === "self") trySelfInit(); }, []);

  // Wenn account-modal nach team-join geschlossen wird → onReady aufrufen wenn token jetzt da
  const checkSessionReady = useCallback(() => {
    setShowAccountForTeam(false);
    if (sync.token) {
      sync.connect();
      setTimeout(() => onReady(), 250);
    }
  }, [onReady]);

  return (
    <div className="boot">
      <div className="boot-card">
        <div className="eyebrow">// projectgamma · desktop</div>
        <h1 className="h1" style={{ marginTop: 6 }}>willkommen</h1>

        {/* Mode-toggle: eigener server vs team beitreten */}
        <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
          <button className={"btn tiny" + (mode === "self" ? " primary" : "")}
                  onClick={() => { setMode("self"); setError(null); setStatus("idle"); }}>
            🏠 eigener server (lokal)
          </button>
          <button className={"btn tiny" + (mode === "team" ? " primary" : "")}
                  onClick={() => { setMode("team"); setError(null); setStatus("idle"); }}>
            👥 team beitreten (anderer server)
          </button>
        </div>

        <hr className="div" style={{ margin: "18px 0" }} />

        {mode === "self" && (
          <>
            <div style={{ color: "var(--ink-soft)", fontSize: 13, marginBottom: 12 }}>
              desktop authentifiziert sich automatisch beim lokalen server. nur lokal
              erreichbar — für team-collab oben „team beitreten" wählen.
            </div>
            <label className="field">
              <span className="eyebrow">server-url</span>
              <input className="input big" value={serverUrl} onChange={e => setServerUrl(e.target.value)} />
            </label>
            <div className="boot-status">
              {status === "connecting" && <span className="cc-dot live">verbinde…</span>}
              {status === "ready"      && <span className="cc-dot live">erfolgreich verbunden</span>}
              {status === "error"      && <span style={{ color: "#c33" }}>⚠ {error}</span>}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn" onClick={trySelfInit} disabled={status === "connecting"}>
                {status === "error" ? "erneut versuchen" : "verbinden"}
              </button>
            </div>
          </>
        )}

        {mode === "team" && (
          <>
            <div style={{ color: "var(--ink-soft)", fontSize: 13, marginBottom: 12 }}>
              du tritt einem team bei, das auf einem ANDEREN server läuft.<br />
              dein kollege hat dir die team-url geschickt — gib deine email ein,
              dann bist du drin (vorausgesetzt der owner hat dich eingeladen).
            </div>
            <label className="field">
              <span className="eyebrow">team-server-url</span>
              <input className="input big" value={teamUrl}
                     placeholder="https://abc.trycloudflare.com  oder  http://192.168.1.42:7892"
                     onChange={e => setTeamUrl(e.target.value)}
                     onKeyDown={e => { if (e.key === "Enter") tryClaimInvite(); }} />
            </label>
            <label className="field" style={{ marginTop: 10 }}>
              <span className="eyebrow">deine email (die du eingeladen wurdest)</span>
              <input className="input big" type="email" value={inviteEmail}
                     placeholder="du@example.com"
                     onChange={e => setInviteEmail(e.target.value)}
                     onKeyDown={e => { if (e.key === "Enter") tryClaimInvite(); }} />
            </label>
            <div className="boot-status">
              {status === "connecting" && <span className="cc-dot live">prüfe einladung…</span>}
              {status === "error"      && <span style={{ color: "#c33" }}>⚠ {error}</span>}
              {status === "ready"      && <span className="cc-dot live">✓ einladung gefunden, du bist drin</span>}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
              <button className="btn tiny" onClick={() => { setShowAccountForTeam(true); }}
                      disabled={!teamUrl.trim()} title="account + passwort statt nur email">
                stattdessen mit passwort einloggen
              </button>
              <button className="btn primary" onClick={tryClaimInvite}
                      disabled={status === "connecting" || !teamUrl.trim() || !inviteEmail.trim()}>
                ✓ einloggen →
              </button>
            </div>
          </>
        )}
      </div>

      {/* AccountAuthModal nach erfolgreichem team-server-check */}
      {showAccountForTeam && window.AccountAuthModal && (
        <window.AccountAuthModal
          onClose={checkSessionReady}
          initialMode="register"
          contextHint={`du verbindest dich mit einem team-server (${sync.serverUrl}). registriere einen account, danach kann dich der team-owner zu projekten einladen.`}
        />
      )}
    </div>
  );
}

// ─── Pairing-Code-Modal ──────────────────────────────────────
// Generiert via /api/pair/init einen Code, zeigt ihn groß an, mit Countdown.
// Beobachtet sync-log um zu erkennen, wenn ein gerät verbunden wurde.
//
// QR-Block: rendert pgamma://pair?host=…&port=…&code=… mit qrcode-generator.
// host wird aus lanInfo (erste LAN-IP) abgeleitet; ohne lanInfo verstecken
// wir den QR sichtbar mit hinweis (kein silent skip).
function PairQr({ pairing, lanInfo, tunnel, expired }) {
  const pq = (typeof window !== "undefined") ? window.pair_qr : null;
  if (!pq || !pairing || expired) return null;
  // Tunnel aktiv → host = cloudflare-domain, port=443, scheme=wss. Mobile löst
  // das selbst via TLS auf.
  const useTunnel = tunnel && tunnel.status === "active" && tunnel.url;
  const tunnelHost = useTunnel ? (tunnel.url.match(/^https:\/\/([^/]+)/i) || [])[1] : null;
  const host = tunnelHost || lanInfo?.ips?.[0];
  const port = useTunnel ? 443 : lanInfo?.port;
  if (!host || !port) {
    return <div className="pair-meta" style={{ opacity: 0.7 }}>QR nicht verfügbar (keine LAN-IP + kein tunnel)</div>;
  }
  let svg = null;
  try {
    const payload = pq.buildPairQrPayload({
      host, port, code: pairing.code,
      publicIp: pairing.publicIp || null,
      // Audit-fix: alle LAN-IPs einbetten — mobile probiert sie alle
      hosts: Array.isArray(lanInfo?.ips) ? lanInfo.ips : [],
      scheme: useTunnel ? "wss" : undefined,
    });
    svg = pq.toQrSvg(payload, { cellSize: 4, margin: 2 });
  } catch (e) {
    return <div className="pair-meta" style={{ color: "#c33" }}>QR-fehler: {String(e.message)}</div>;
  }
  if (!svg) return <div className="pair-meta" style={{ opacity: 0.7 }}>QR-lib lädt…</div>;
  return (
    <div className="pair-qr" style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}
         aria-label={`QR-Code für pairing-code ${pairing.code}`}
         dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

function PairCodeModal({ onClose }) {
  const client = useSync();
  const [pairing, setPairing] = useState(client._pairing || null);
  const [generating, setGenerating] = useState(!pairing);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const [lanInfo, setLanInfo] = useState(null);
  const [tunnel, setTunnel] = useState({ status: "idle", url: null, error: null });
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const sessionsBefore = useRef(null);

  useEffect(() => { fetchLanInfo(client.serverUrl).then(setLanInfo); }, [client.serverUrl]);
  // Tunnel-status laden + nur pollen während starting/active.
  // Fix: vorher pollte er auch im idle-status alle 3s → unnötige requests.
  // Jetzt: initial-fetch + interval nur wenn status transitioning, und
  // pause wenn tab nicht sichtbar (saves CPU im hintergrund).
  useEffect(() => {
    let alive = true;
    async function poll() {
      if (document.hidden) return;
      try {
        const r = await fetch(client.serverUrl + "/api/tunnel/status").then(r => r.json());
        if (alive) setTunnel(r);
      } catch (_) {}
    }
    poll();
    const shouldPoll = tunnel.status === "starting" || tunnel.status === "active";
    const iv = shouldPoll ? setInterval(poll, 3000) : null;
    return () => { alive = false; if (iv) clearInterval(iv); };
  }, [client.serverUrl, tunnel.status]);

  const toggleTunnel = async () => {
    setTunnelBusy(true);
    try {
      const endpoint = tunnel.status === "active" || tunnel.status === "starting" ? "/api/tunnel/stop" : "/api/tunnel/start";
      const r = await fetch(client.serverUrl + endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + client.token },
      }).then(r => r.json());
      setTunnel(r);
      // Nach tunnel-start/stop einen neuen pairing-code generieren — qrPayload
      // codiert nur den aktuellen route-status.
      if (pairing) await regenerate();
    } catch (e) {
      setTunnel(t => ({ ...t, error: e.message }));
    } finally {
      setTunnelBusy(false);
    }
  };

  // Bei Mount: falls noch kein Code → generieren
  useEffect(() => {
    let cancelled = false;
    async function go() {
      if (!client._pairing) {
        try {
          const p = await client.genPairingCode();
          if (!cancelled) { setPairing(p); setGenerating(false); }
        } catch (e) {
          if (!cancelled) { setError(e.message); setGenerating(false); }
        }
      } else {
        setPairing(client._pairing);
        setGenerating(false);
      }
    }
    go();
    return () => { cancelled = true; };
  }, [client]);

  // Tick für Countdown
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Erkennen wann ein gerät sich verbunden hat → vergleich gegen baseline-count beim mount
  useEffect(() => {
    if (!pairing) return;
    if (sessionsBefore.current == null) {
      sessionsBefore.current = client.syncLog.filter(e => e.text?.includes("gerät verbunden")).length;
      return;
    }
    const after = client.syncLog.filter(e => e.text?.includes("gerät verbunden")).length;
    if (after > sessionsBefore.current) {
      setTimeout(onClose, 1200);
    }
  }, [client.syncLog, pairing, onClose]);

  const regenerate = async () => {
    setGenerating(true); setError(null);
    try {
      const p = await client.genPairingCode();
      setPairing(p);
      sessionsBefore.current = client.syncLog.filter(e => e.text?.includes("gerät verbunden")).length;
    } catch (e) { setError(e.message); }
    setGenerating(false);
  };

  const remaining = pairing ? Math.max(0, pairing.expiresAt - NOW()) : 0;
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  const expired = remaining === 0;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal pair-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">// pairing</div>
            <h2 className="h2">mobile gerät verbinden</h2>
          </div>
          <button className="btn tiny" onClick={onClose}>×</button>
        </div>

        <div style={{ color: "var(--ink-soft)", fontSize: 13, lineHeight: 1.5 }}>
          öffne die <strong>ProjectGamma</strong> app auf deinem handy und gib unten stehenden code ein.
          die verbindung läuft über deinen lokalen sync-server.
        </div>

        {generating && <div className="empty" style={{ padding: 30 }}><div>generiere code…</div></div>}

        {error && <div style={{ color: "#c33", fontSize: 13 }}>⚠ {error}</div>}

        {pairing && !generating && (
          <>
            <div className={"pair-code" + (expired ? " expired" : "")}>
              {pairing.code.split("").map((c, i) => <span key={i}>{c}</span>)}
            </div>
            <PairQr pairing={pairing} lanInfo={lanInfo} tunnel={tunnel} expired={expired} />
            <div className="pair-meta">
              {expired
                ? <span style={{ color: "#c33" }}>code abgelaufen</span>
                : <>gültig noch <strong>{mm}:{ss.toString().padStart(2, "0")}</strong></>}
              {" · server: "}<code>{client.serverUrl}</code>
            </div>
          </>
        )}

        {/* Cloudflare-tunnel-toggle: macht den server übers internet erreichbar,
            ohne port-forward oder gleiche WLAN. */}
        <div className="box" style={{ marginTop: 4, padding: 12, background: tunnel.status === "active" ? "rgba(0,150,80,0.06)" : "transparent" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div className="eyebrow">// 🌐 internet-tunnel (cloudflare)</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4, lineHeight: 1.45 }}>
                {tunnel.status === "active"
                  ? <>aktiv — handy kann sich überall verbinden (kein gleiches WLAN nötig)</>
                  : tunnel.status === "starting"
                    ? <>tunnel wird gestartet… (binary wird ggf. heruntergeladen, ~30s beim ersten mal)</>
                    : tunnel.status === "error"
                      ? <span style={{ color: "#c33" }}>fehler: {tunnel.error}</span>
                      : <>aus — pairing geht nur über LAN/WLAN. einschalten = handy kann übers internet rein.</>
                }
              </div>
              {tunnel.url && (
                <code style={{ display: "inline-block", marginTop: 6, fontSize: 11, color: "var(--ink-faint)", wordBreak: "break-all" }}>
                  {tunnel.url}
                </code>
              )}
            </div>
            <button className="btn tiny"
                    onClick={toggleTunnel}
                    disabled={tunnelBusy || tunnel.status === "starting"}>
              {tunnelBusy ? "…" :
                tunnel.status === "active" || tunnel.status === "starting" ? "× stop" : "▶ start"}
            </button>
          </div>
        </div>

        <div className="pair-instructions">
          <div className="eyebrow">// schritte</div>
          <ol>
            <li>app auf handy öffnen</li>
            <li>
              {tunnel.status === "active" && tunnel.url ? (
                <>
                  server-url ist im QR — oder manuell:
                  <div className="ip-list">
                    <button className="ip-copy"
                            onClick={() => { navigator.clipboard?.writeText(tunnel.url); }}
                            title="in zwischenablage kopieren">
                      <code>{tunnel.url}</code>
                      <span className="ip-copy-icon">⧉</span>
                    </button>
                    <div className="ip-tip">
                      tunnel-URL funktioniert <strong>überall</strong> (4G/anderes WLAN/draußen) — kein port-forward nötig.
                    </div>
                  </div>
                </>
              ) : (
                <>
                  server-url eingeben — gleiche WLAN voraussetzung:
                  {lanInfo?.ips?.length ? (
                    <div className="ip-list">
                      {lanInfo.ips.map(ip => {
                        const url = `http://${ip}:${lanInfo.port}`;
                        return (
                          <button key={ip} className="ip-copy"
                                  onClick={() => { navigator.clipboard?.writeText(url); }}
                                  title="in zwischenablage kopieren">
                            <code>{url}</code>
                            <span className="ip-copy-icon">⧉</span>
                          </button>
                        );
                      })}
                      <div className="ip-tip">
                        oder „server suchen" tippen in der mobile-app · per USB mit
                        <code>adb reverse tcp:{lanInfo.port} tcp:{lanInfo.port}</code> auch
                        <code>http://localhost:{lanInfo.port}</code>
                        <br/>
                        <em>tipp:</em> für verbindung außerhalb des WLANs einfach oben „🌐 internet-tunnel start" klicken.
                      </div>
                    </div>
                  ) : (
                    <code> {client.serverUrl}</code>
                  )}
                </>
              )}
            </li>
            <li>diesen code eingeben: <strong>{pairing?.code || "—"}</strong></li>
            <li>fertig — sync läuft live über websocket</li>
          </ol>
        </div>

        <div className="footer">
          <button className="btn" onClick={regenerate} disabled={generating}>↻ neuer code</button>
          <button className="btn primary" onClick={onClose}>schließen</button>
        </div>
      </div>
    </div>
  );
}

// LAN-IPs vom Server abfragen (cached)
let _lanInfoCache = null;
async function fetchLanInfo(serverUrl) {
  if (_lanInfoCache) return _lanInfoCache;
  try {
    const r = await fetch(serverUrl + "/api/network-info").then(r => r.json());
    _lanInfoCache = r;
    return r;
  } catch (e) { return null; }
}

// ─── Confirm-Dialog ──────────────────────────────────────────
function Confirm({ title, message, confirmLabel = "ok", cancelLabel = "abbrechen", danger = false, onConfirm, onCancel }) {
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 420 }}>
        <div className="modal-head"><h2 className="h2">{title}</h2></div>
        <div style={{ color: "var(--ink-soft)", fontSize: 13, lineHeight: 1.5 }}>{message}</div>
        <div className="footer">
          <button className="btn" onClick={onCancel}>{cancelLabel}</button>
          <button className={"btn primary" + (danger ? " danger" : "")} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────
function Sidebar({ projects, activeId, onSelect, onNew, ccRunning }) {
  // Clean sidebar: pro projekt nur stern + name. zahlen liegen jetzt in den
  // stat-chips der übersicht — hier würden sie nur ablenken.
  // Sortierung: favoriten zuerst, sonst alphabetisch.
  const sorted = [...projects].sort((a, b) => {
    if (!!b.starred - !!a.starred) return !!b.starred - !!a.starred;
    return (a.name || "").localeCompare(b.name || "");
  });
  // Aktueller user für die user-card unten in sidebar (mockup-style).
  // Bevorzugt account-email (deviceName=email nach login), fallback pair-deviceName.
  const myEmail = (sync.deviceName && /@/.test(sync.deviceName))
    ? sync.deviceName
    : (sync.deviceName || "desktop");
  const initial = (myEmail.match(/^./) || ["?"])[0].toUpperCase();
  const displayName = /@/.test(myEmail)
    ? myEmail.split("@")[0]
    : myEmail;
  return (
    <div className="side">
      <div className="eyebrow">Projekte</div>
      {sorted.map(p => {
        // D4 · Live-counts pro projekt — auf den ersten blick sichtbar
        const openTasks = (p.tasks || []).filter(t => !t.done).length;
        const unprocIdeas = (p.ideas || []).filter(i => i.status === "unprocessed").length;
        const openBugs = (p.bugs || []).filter(b => b.status === "pending").length;
        const pendingDiffs = (p.ruleDiffs || []).filter(d => d.status === "pending").length;
        const hasAttention = openBugs > 0 || pendingDiffs > 0;
        return (
        <div key={p.id}
             className={"proj-item" + (p.id === activeId ? " active" : "")}
             onClick={() => onSelect(p.id)}
             title={`${openTasks} offene aufgaben · ${unprocIdeas} ideen${openBugs ? ` · ${openBugs} bugs` : ""}${pendingDiffs ? ` · ${pendingDiffs} regel-diffs` : ""}`}>
          <span className="star"
                title={p.starred ? "stern entfernen" : "favorit setzen"}
                onClick={e => { e.stopPropagation(); sync.mutate("TOGGLE_STAR", { projectId: p.id }); }}>
            {p.starred ? "★" : "☆"}
          </span>
          <div className="proj-info">
            <span className="name">{p.name}</span>
            <span className="proj-counts">
              {openTasks > 0 && <span className="proj-count">✓{openTasks}</span>}
              {unprocIdeas > 0 && <span className="proj-count">💡{unprocIdeas}</span>}
              {hasAttention && <span className="proj-count attention" title="braucht aufmerksamkeit">!{openBugs + pendingDiffs}</span>}
            </span>
          </div>
        </div>
        );
      })}
      <button className="new-btn" onClick={onNew}>+ Neues Projekt</button>

      <div className="cc-ambient">
        <span className={"cc-dot" + (ccRunning ? " live" : "")}>
          cloud-code · {ccRunning ? "arbeitet" : "pause"}
        </span>
      </div>

      {/* User-card unten (mockup-style: avatar + name + email) */}
      <div className="side-user-card">
        <div className="avatar">{initial}</div>
        <div className="user-info">
          <div className="user-name">{displayName}</div>
          <div className="user-email">{myEmail}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Head ────────────────────────────────────────────────
function MainHead({ project, activeTab, onTab, onAction, onDelete }) {
  const counts = {
    tasks: (project.tasks || []).filter(t => !t.done).length,
    rules: (project.rules || []).filter(r => r.active).length,
    ideas: (project.ideas || []).filter(i => i.status === "unprocessed").length,
  };
  // Cloud-code hat eine offene Frage → tab visuell hervorheben (atmender ❓-dot)
  // damit user sie nicht übersieht. pendingQuestion ist ein string (siehe
  // SET_PENDING_QUESTION mutation). Frühere version checkte .text/.question →
  // war immer false. Jetzt: string-check.
  const pqRaw = project.pendingQuestion;
  const ccPending = typeof pqRaw === "string"
    ? pqRaw.trim().length > 0
    : !!(pqRaw && (pqRaw.text || pqRaw.question));
  // Einklapp-toggle: header schrumpft auf 1 zeile (titel + tabs + buttons).
  // Persistent in localStorage damit es nicht bei jedem reload zurückspringt.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("projectgamma.header.collapsed") === "1"; } catch (_) { return false; }
  });
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("projectgamma.header.collapsed", next ? "1" : "0"); } catch (_) {}
  };
  const patch = (p) => sync.mutate("PATCH_PROJECT", { projectId: project.id, patch: p });
  return (
    <div className={"main-head" + (collapsed ? " collapsed" : "")}>
      <div className="head-top">
        <div className="title-block">
          <div className="eyebrow">// projekt</div>
          <h1 className="h1">
            <span style={{ marginRight: 6, cursor: "pointer" }}
                  title={project.starred ? "stern entfernen" : "favorit setzen"}
                  onClick={() => sync.mutate("TOGGLE_STAR", { projectId: project.id })}>
              {project.starred ? "★" : "☆"}
            </span>
            <Editable value={project.name}
                      onChange={v => patch({ name: v.trim() || project.name })}
                      placeholder="projektname" />
          </h1>
          {!collapsed && (
            <>
              <div className="sub" style={{ display: "flex", gap: 8, alignItems: "center", maxWidth: "100%", overflow: "hidden" }}>
                <select className="tech-select" value={project.tech || "andere"}
                        onChange={e => patch({ tech: e.target.value })}>
                  {TECH_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <span style={{ color: "var(--ink-faint)" }}>·</span>
                <span style={{ color: "var(--ink-soft)", whiteSpace: "nowrap" }}>cloud-code aktiv</span>
                <span style={{ color: "var(--ink-faint)" }}>·</span>
                {/* Description: clamp auf 1 zeile + ellipsis. klick öffnet projekt-details modal
                    (dort vollständig editierbar). Verhindert dass lange texte die buttons
                    rechts aus dem header drücken. */}
                <span onClick={() => onAction("openProjectSettings")}
                      title={(project.description || "").length > 0
                              ? "voll lesen + bearbeiten (projekt-details)"
                              : "beschreibung hinzufügen (projekt-details)"}
                      style={{
                        flex: 1, minWidth: 0,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        cursor: "pointer", color: project.description ? "var(--ink-soft)" : "var(--ink-faint)",
                        fontStyle: project.description ? "normal" : "italic",
                      }}>
                  {project.description || "+ kurzbeschreibung hinzufügen…"}
                </span>
              </div>
              {/* Ziele-preview · dezent unter beschreibung. klick öffnet projekt-details. */}
              {(() => {
                const goals = project.goals || [];
                if (goals.length === 0) return null;
                const preview = goals.slice(0, 3).join("  ·  ");
                const more = goals.length > 3 ? `  +${goals.length - 3}` : "";
                return (
                  <div className="sub goals-preview"
                       style={{ marginTop: 4, fontSize: 11.5, color: "var(--ink-soft)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                       onClick={() => onAction("openProjectSettings")}
                       title="projekt-details bearbeiten">
                    <span style={{ color: "var(--ink-faint)" }}>ziele:</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview}{more}</span>
                    <span style={{ color: "var(--ink-faint)" }}>✎</span>
                  </div>
                );
              })()}
              <div className="sub" style={{ marginTop: 4, fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--ink-faint)" }}>
                <Editable value={project.path || ""}
                          onChange={v => patch({ path: v.trim() })}
                          placeholder="+ lokalen pfad hinzufügen (für IDE-launch)" />
              </div>
            </>
          )}
        </div>
        <div className="actions actions-bar" style={{ flexShrink: 0 }}>
          {/* D2 · Klare hierarchie:
              1× PRIMARY (handy verbinden — täglich, auffälligste action)
              2× SECONDARY-ICON (mitglieder, account — situativ)
              Rest in OVERFLOW-MENU (⋯) — settings, openIDE, export, sync, löschen, etc. */}
          <button className="btn tiny primary" onClick={() => onAction("pairMobile")} title="QR + 6-stelliger code für mobile-gerät">+ handy verbinden</button>
          <button className="btn tiny icon-only" onClick={() => onAction("openMembers")} title="mitglieder einladen / verwalten">👥</button>
          <button className="btn tiny icon-only" onClick={() => onAction("openAuth")} title="account · login / registrieren">🔐</button>
          {/* Overflow-Menu — inkl. settings (war primary, ist eigentlich rare) */}
          {window.MoreMenu
            ? <window.MoreMenu onAction={onAction} onDelete={onDelete} hasPath={!!project.path} />
            : (
              <button className="btn tiny" onClick={() => onAction("openSettings")} title="weitere actions">⋯</button>
            )}
          {/* Header-collapse-toggle bleibt sichtbar */}
          <button className="btn tiny icon-only" onClick={toggleCollapsed}
                  title={collapsed ? "header ausklappen" : "header einklappen (beschreibung+pfad verstecken)"}>
            {collapsed ? "⌄" : "⌃"}
          </button>
        </div>
      </div>
      <div className="tabs">
        {TABS.map(t => {
          const isCcPending = t.id === "cloud" && ccPending && activeTab !== "cloud";
          return (
            <button key={t.id}
                    className={"tab" + (activeTab === t.id ? " active" : "") + (isCcPending ? " cc-pending" : "")}
                    onClick={() => onTab(t.id)}
                    title={isCcPending ? "cloud-code hat eine frage — bitte beantworten" : undefined}
                    style={isCcPending ? {
                      // Sanftes "atmen" + ❓-prefix damit der user es nicht übersieht.
                      animation: "pg-cc-pulse 1.6s ease-in-out infinite",
                      borderColor: "#cc8800",
                      color: "#cc8800",
                      fontWeight: 600,
                    } : undefined}>
              {isCcPending && <span style={{ marginRight: 4 }}>❓</span>}
              {t.label}
              {t.id === "tasks" && counts.tasks > 0 && <span className="count">{counts.tasks}</span>}
              {t.id === "rules" && counts.rules > 0 && <span className="count">{counts.rules}</span>}
              {t.id === "ideas" && counts.ideas > 0 && <span className="count">{counts.ideas}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Suggestions + Bugs Inline-Block (in Übersicht) ───────
function SuggestionsAndBugs({ project }) {
  const suggestions = project.suggestions || [];
  const bugs = project.bugs || [];
  const [busy, setBusy] = useState({ suggest: false, bughunt: false });

  const triggerSuggest = async () => {
    setBusy(b => ({ ...b, suggest: true }));
    try { await sync.ccSuggest(project.id); } catch (e) {}
    setTimeout(() => setBusy(b => ({ ...b, suggest: false })), 60000);
  };
  const triggerBughunt = async () => {
    setBusy(b => ({ ...b, bughunt: true }));
    try { await sync.ccBughunt(project.id); } catch (e) {}
    setTimeout(() => setBusy(b => ({ ...b, bughunt: false })), 60000);
  };

  const acceptSuggestion = (s) => {
    sync.mutate("ADD_TASK", { projectId: project.id, task: {
      title: s.title, done: false, group: "next",
      meta: "vorschlag · " + s.category + " · " + s.effort,
      priority: s.effort === "low" ? 4 : s.effort === "high" ? 2 : 3,
      subtasks: [],
    }});
    sync.mutate("SET_SUGGESTION_STATUS", { projectId: project.id, suggestionId: s.id, status: "accepted" });
  };
  const rejectSuggestion = (id) => sync.mutate("SET_SUGGESTION_STATUS", { projectId: project.id, suggestionId: id, status: "rejected" });
  const removeSuggestion = (id) => sync.mutate("REMOVE_SUGGESTION", { projectId: project.id, suggestionId: id });

  const acceptBug = (b) => {
    sync.mutate("ADD_TASK", { projectId: project.id, task: {
      title: `[bug] ${b.description}` + (b.location ? ` (${b.location})` : ""),
      done: false, group: "next",
      meta: "bug · " + b.severity,
      priority: b.severity === "high" ? 5 : b.severity === "medium" ? 4 : 3,
      subtasks: b.fix ? [{ title: "fix-hint: " + b.fix.slice(0, 100), done: false }] : [],
    }});
    sync.mutate("SET_BUG_STATUS", { projectId: project.id, bugId: b.id, status: "fixing" });
  };
  const dismissBug = (id) => sync.mutate("SET_BUG_STATUS", { projectId: project.id, bugId: id, status: "dismissed" });
  const removeBug = (id) => sync.mutate("REMOVE_BUG", { projectId: project.id, bugId: id });
  const toggleAutoFix = () => sync.mutate("TOGGLE_BUG_AUTO_FIX", { projectId: project.id, on: !project.bugAutoFix });

  const pendingSuggestions = suggestions.filter(s => s.status === "pending");
  const pendingBugs = bugs.filter(b => b.status === "pending");

  return (
    <div className="suggest-bug-wrap">
      <div className="two-col">
        {/* SUGGESTIONS */}
        <div className="box">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span className="eyebrow">// vorschläge {pendingSuggestions.length > 0 && <span className="chip" style={{ marginLeft: 6 }}>{pendingSuggestions.length}</span>}</span>
            <button className="btn tiny primary" onClick={triggerSuggest} disabled={busy.suggest}>
              {busy.suggest ? "läuft…" : "💡 generieren"}
            </button>
          </div>
          {suggestions.length === 0
            ? <div className="empty"><div>noch keine vorschläge.</div><div style={{ fontSize: 11, marginTop: 4 }}>klick auf „generieren" — claude analysiert die app + schlägt verbesserungen vor</div></div>
            : (
              <div className="suggest-list">
                {suggestions.slice(0, 12).map(s => (
                  <div key={s.id} className={"suggest-item status-" + s.status}>
                    <div className="suggest-head">
                      <span className={"chip cat-" + s.category}>{s.category}</span>
                      <span className="chip">aufwand: {s.effort}</span>
                      <span className="grow" />
                      <span className="status-tag">{s.status}</span>
                    </div>
                    <div className="suggest-title">{s.title}</div>
                    {s.reason && <div className="suggest-reason">{s.reason}</div>}
                    {s.status === "pending" && (
                      <div className="suggest-actions">
                        <button className="btn tiny primary" onClick={() => acceptSuggestion(s)}>✓ als aufgabe</button>
                        <button className="btn tiny" onClick={() => rejectSuggestion(s.id)}>✕ ablehnen</button>
                      </div>
                    )}
                    {s.status !== "pending" && (
                      <div className="suggest-actions">
                        <button className="btn tiny danger" onClick={() => removeSuggestion(s.id)}>× entfernen</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          }
        </div>

        {/* BUGS */}
        <div className="box">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span className="eyebrow">// bugs {pendingBugs.length > 0 && <span className="chip" style={{ marginLeft: 6, color: "#c33", borderColor: "#c33" }}>{pendingBugs.length}</span>}</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--ink-soft)", cursor: "pointer" }}
                     title="alle 30min auto-scan + neue bugs werden automatisch zu cc-tasks">
                <input type="checkbox" checked={!!project.bugAutoFix} onChange={toggleAutoFix} />
                auto-fix
              </label>
              <button className="btn tiny primary" onClick={triggerBughunt} disabled={busy.bughunt}>
                {busy.bughunt ? "läuft…" : "🐞 hunt"}
              </button>
            </div>
          </div>
          {bugs.length === 0
            ? <div className="empty"><div>keine bugs gefunden.</div><div style={{ fontSize: 11, marginTop: 4 }}>klick „🐞 hunt" — claude scannt die source nach bugs</div></div>
            : (
              <div className="suggest-list">
                {bugs.slice(0, 12).map(b => (
                  <div key={b.id} className={"bug-item severity-" + b.severity + " status-" + b.status}>
                    <div className="suggest-head">
                      <span className={"chip sev-" + b.severity}>{b.severity}</span>
                      {b.location && <span className="chip mono">{b.location}</span>}
                      <span className="grow" />
                      <span className="status-tag">{b.status}</span>
                    </div>
                    <div className="suggest-title">{b.description}</div>
                    {b.fix && <div className="suggest-reason">→ {b.fix}</div>}
                    {b.status === "pending" && (
                      <div className="suggest-actions">
                        <button className="btn tiny primary" onClick={() => acceptBug(b)}>⚡ fixen lassen</button>
                        <button className="btn tiny" onClick={() => dismissBug(b.id)}>✕ verwerfen</button>
                      </div>
                    )}
                    {b.status !== "pending" && (
                      <div className="suggest-actions">
                        <button className="btn tiny danger" onClick={() => removeBug(b.id)}>× entfernen</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
}

// ─── Screen: Übersicht ────────────────────────────────────────
// D5 · OnboardingBlock: zeigt 3-schritte-card prominent solange noch nicht
// alle erledigt sind. Sobald alle 3 mindestens 1× erledigt sind → auto-collapse
// auf eine kompakte "✓ onboarding fertig"-zeile. User kann manuell ausklappen.
function OnboardingBlock({ project, myEmail, onSetTab, onOpenMembers }) {
  const dismissKey = "pg-onboarding-dismissed-" + project.id;
  const [manualDismissed, setManualDismissed] = useState(() => {
    try { return localStorage.getItem(dismissKey) === "1"; }
    catch (_) { return false; }
  });

  // Echte completion-detection aus state
  const hasIdeas = (project.ideas || []).length > 0;
  const memberCount = (project.members || []).length;
  const hasTeam = memberCount > 1; // owner zählt mit, > 1 = mindestens 1 eingeladen
  const hasMessages = (project.activity || []).some(a => a.type === "chat" || a.type === "msg");

  const allDone = hasIdeas && hasTeam && hasMessages;
  const progress = [hasIdeas, hasTeam, hasMessages].filter(Boolean).length;
  const collapsed = allDone || manualDismissed;

  // Bug-fix: vorher verschwand MiniChat wenn onboarding collapsed → user
  // dachte chat sei weg. jetzt: kollabierte version zeigt nur kompakte
  // bar + MiniChat darunter (full width).
  if (collapsed) {
    return (
      <>
        <div className="box" style={{
          marginBottom: 14, padding: "8px 14px",
          display: "flex", alignItems: "center", gap: 10,
          fontSize: 12, color: "var(--ink-soft)",
        }}>
          <span style={{ fontSize: 14 }}>{allDone ? "✓" : "·"}</span>
          <span style={{ flex: 1 }}>
            {allDone ? "onboarding abgeschlossen · alle 3 schritte fertig" : "onboarding minimiert"}
          </span>
          <button className="btn tiny" onClick={() => {
            try { localStorage.removeItem(dismissKey); } catch (_) {}
            setManualDismissed(false);
          }}>einblenden</button>
        </div>
        <MiniChat project={project} myEmail={myEmail} onSetTab={onSetTab} />
      </>
    );
  }

  return (
    <div className="two-col">
      <div className="box">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
          <div className="eyebrow" style={{ flex: 1 }}>// los geht's · {progress}/3 schritte</div>
          <button className="btn tiny" title="onboarding ausblenden" onClick={() => {
            try { localStorage.setItem(dismissKey, "1"); } catch (_) {}
            setManualDismissed(true);
          }}>×</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginTop: 4 }}>
          <OnboardStep n="1" title="idee erfassen"
            body="im ideen-tab tippst du was dir gerade einfällt. später machst du daraus aufgaben."
            cta="→ ideen-tab" onClick={() => onSetTab && onSetTab("ideas")}
            done={hasIdeas} />
          <OnboardStep n="2" title="team einladen"
            body={"oben „mitglieder verwalten“ → email eintippen. ihr seht dann beide dieselben aufgaben + chat."}
            cta="👥 mitglieder" onClick={onOpenMembers}
            done={hasTeam} />
          <OnboardStep n="3" title="mit team chatten"
            body="rechts im chat oder im team-tab: nachrichten, notizen + termine teilen — live synchronisiert."
            cta="→ team-tab" onClick={() => onSetTab && onSetTab("team")}
            done={hasMessages} />
        </div>
      </div>
      <MiniChat project={project} myEmail={myEmail} onSetTab={onSetTab} />
    </div>
  );
}

function OnboardStep({ n, title, body, cta, onClick, done }) {
  return (
    <div style={{
      padding: 10, border: "1.5px solid " + (done ? "#2a8a3a" : "var(--line)"),
      borderRadius: 6,
      background: done ? "rgba(42,138,58,0.06)" : "var(--paper)",
      opacity: done ? 0.85 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
        <span style={{
          display: "inline-block", width: 22, height: 22, lineHeight: "22px", textAlign: "center",
          background: done ? "#2a8a3a" : "var(--ink)", color: "var(--paper)", borderRadius: 11,
          fontFamily: "monospace", fontSize: 12, fontWeight: 700,
        }}>{done ? "✓" : n}</span>
        <strong style={{ fontSize: 13.5, textDecoration: done ? "line-through" : "none" }}>{title}</strong>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.5, marginBottom: 8 }}>
        {body}
      </div>
      {cta && !done && (
        <button className="btn tiny" onClick={onClick}
          style={{ fontWeight: 600 }}>{cta}</button>
      )}
      {done && (
        <span style={{ fontSize: 11, color: "#2a8a3a", fontWeight: 600 }}>✓ erledigt</span>
      )}
    </div>
  );
}

// Stat-Chip: icon-left layout (redesign nach mockup) + klick wechselt tab.
function StatChip({ label, value, icon, accent, onClick }) {
  return (
    <button onClick={onClick}
            className={"statcard-row" + (accent ? " accent" : "")}
            style={{
              cursor: onClick ? "pointer" : "default",
              fontFamily: "inherit",
              textAlign: "left",
            }}>
      <div className="ico">{icon || "·"}</div>
      <div className="body">
        <div className="label-block">
          <div className="label">{label}</div>
        </div>
        <div className="value">{value}</div>
      </div>
    </button>
  );
}

// Mini-Chat: scrollbare preview der letzten 50 nachrichten + input + upload.
// Draft wird beim projekt-wechsel zurückgesetzt — sonst landet text im falschen projekt.
function MiniChat({ project, myEmail, onSetTab }) {
  const [draft, setDraft] = useState("");
  const [authedEmail, setAuthedEmail] = useState(null); // aus /api/auth/me
  const [uploading, setUploading] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const listRef = useRef(null);
  const fileInputRef = useRef(null);
  useEffect(() => { setDraft(""); setPendingAttachment(null); }, [project.id]);
  const messages = project.messages || [];
  const last = messages.slice(-50);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  // Bug-fix: sync.deviceName kann "desktop" sein (pair-token) während
  // posts via account-login mit email gemacht wurden → mismatch, alle
  // nachrichten landen links. Fix: /api/auth/me bei mount fetchen, dann
  // gegen die TATSÄCHLICHE user-email matchen (preferred über deviceName).
  useEffect(() => {
    let cancelled = false;
    sync.getMe?.().then(m => {
      if (!cancelled && m && m.user && m.user.email) setAuthedEmail(m.user.email);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // Effektiver vergleichs-wert für isOwn: was IMMER der currently-authed
  // user ist, dann fallback auf deviceName (für pair-token-session).
  const effectiveMyEmail = authedEmail || myEmail;

  const send = () => {
    const t = draft.trim();
    if (!t && !pendingAttachment) return;
    const message = { text: t };
    if (pendingAttachment) message.attachment = pendingAttachment;
    sync.mutate("ADD_MESSAGE", { projectId: project.id, message });
    setDraft("");
    setPendingAttachment(null);
    setUploadError(null);
  };

  const onPickFile = () => { if (fileInputRef.current) fileInputRef.current.click(); };
  const onFileSelected = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setUploadError("datei zu groß (max 8 MB)"); return; }
    setUploading(true); setUploadError(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      const base64 = btoa(bin);
      const r = await fetch(sync.serverUrl + "/api/projects/" + encodeURIComponent(project.id) + "/attachments", {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": "Bearer " + sync.token },
        body: JSON.stringify({ name: file.name, contentType: file.type || "application/octet-stream", base64 }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ("upload " + r.status));
      setPendingAttachment({ fileId: data.fileId, name: data.name, kind: data.kind, url: data.url });
    } catch (e) {
      setUploadError(e.message || "upload fehlgeschlagen");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="box" style={{ display: "flex", flexDirection: "column", minHeight: 240 }}>
      <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1 }}>// projekt-chat <span style={{ opacity: 0.5 }}>· {messages.length}</span></span>
        {onSetTab && messages.length > 0 && (
          <button className="btn tiny" onClick={() => onSetTab("team")}
                  title="alle nachrichten · notizen · termine">
            → team-tab
          </button>
        )}
      </div>
      <div ref={listRef} style={{
        flex: 1, marginTop: 8, marginBottom: 8,
        minHeight: 80, maxHeight: 280, overflowY: "auto",
        background: "rgba(0,0,0,0.02)",
        border: "1.5px dashed var(--line)", borderRadius: 6,
        padding: 8, display: "flex", flexDirection: "column", gap: 6,
        justifyContent: last.length === 0 ? "center" : "flex-start",
      }}>
        {last.length === 0 ? (
          <div style={{ color: "var(--ink-faint)", fontSize: 12, fontStyle: "italic", textAlign: "center" }}>
            noch keine nachrichten. schreib was, deine team-mitglieder sehen es live.
          </div>
        ) : last.map(m => {
          const author = m.authorEmail || (m.author && m.author.startsWith("device:") ? m.author.slice(7) : (m.author || "?"));
          // Match gegen effectiveMyEmail (priorität: /api/auth/me email)
          // ODER pair-token-deviceName. So funktioniert auch der hybrid-fall
          // (logged-in user-account aber sync.deviceName noch alt).
          const isOwn = !!((effectiveMyEmail && author === effectiveMyEmail) ||
                          (myEmail && author === myEmail));
          return (
            <div key={m.id} style={{
              display: "flex", justifyContent: isOwn ? "flex-end" : "flex-start",
            }}>
              <div style={{
                maxWidth: "82%", padding: "4px 9px",
                background: isOwn ? "var(--ink)" : "var(--paper)",
                color: isOwn ? "var(--paper)" : "var(--ink)",
                border: "1.5px solid var(--ink)", borderRadius: 8,
                borderBottomRightRadius: isOwn ? 2 : 8,
                borderBottomLeftRadius: isOwn ? 8 : 2,
                fontSize: 12.5, lineHeight: 1.35,
              }}>
                {!isOwn && <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 1 }}>{author}</div>}
                {m.text}
                {m.attachment && m.attachment.url && (
                  <div style={{ marginTop: 4 }}>
                    {m.attachment.kind === "image" ? (
                      <img src={(sync.serverUrl || "") + m.attachment.url}
                           alt={m.attachment.name}
                           style={{ maxWidth: "100%", borderRadius: 4, display: "block" }} />
                    ) : (
                      <div style={{ fontSize: 10.5, opacity: 0.85, fontFamily: "monospace" }}>
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
          marginBottom: 4, padding: "4px 8px",
          border: "1.5px dashed var(--ink)", borderRadius: 4,
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 11, background: "rgba(0,0,0,0.03)",
        }}>
          <span>{pendingAttachment.kind === "image" ? "🖼" : "📎"}</span>
          <span style={{ flex: 1, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pendingAttachment.name}</span>
          <button className="btn tiny" onClick={() => setPendingAttachment(null)}>×</button>
        </div>
      )}
      {uploadError && (
        <div style={{ marginBottom: 4, fontSize: 10.5, color: "var(--danger, #c33)" }}>⚠ {uploadError}</div>
      )}
      <input ref={fileInputRef} type="file" style={{ display: "none" }}
        onChange={onFileSelected}
        accept="image/*,application/pdf,application/zip,text/*,audio/*,video/*" />
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn tiny" onClick={onPickFile} disabled={uploading} title="anhang (max 8 MB)">
          {uploading ? "…" : "📎"}
        </button>
        <input className="input" style={{ flex: 1 }}
               placeholder="nachricht an team…"
               value={draft}
               onChange={e => setDraft(e.target.value)}
               onKeyDown={e => {
                 if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
                 else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
               }} />
        <button className="btn primary tiny" onClick={send}
                disabled={(!draft.trim() && !pendingAttachment) || uploading}>senden</button>
      </div>
      <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 4, textAlign: "right" }}>
        Enter · senden · 📎 anhang
      </div>
    </div>
  );
}

// Slim suggestions-list (ohne bugs, ohne ablenkung). Bugs liegen unten als secondary block.
function SuggestionsSlim({ project }) {
  const suggestions = project.suggestions || [];
  const [busy, setBusy] = useState(false);
  const timerRef = useRef(null);
  // Cleanup beim unmount + projekt-wechsel verhindert react-warning auf entladener component.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const trigger = async () => {
    setBusy(true);
    try { await sync.ccSuggest(project.id); } catch (e) {}
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setBusy(false), 60000);
  };
  const accept = (s) => {
    sync.mutate("ADD_TASK", { projectId: project.id, task: {
      title: s.title, done: false, group: "next",
      meta: "vorschlag · " + s.category + " · " + s.effort,
      priority: s.effort === "low" ? 4 : s.effort === "high" ? 2 : 3,
      subtasks: [],
    }});
    sync.mutate("SET_SUGGESTION_STATUS", { projectId: project.id, suggestionId: s.id, status: "accepted" });
  };
  const reject = (id) => sync.mutate("SET_SUGGESTION_STATUS", { projectId: project.id, suggestionId: id, status: "rejected" });
  const remove = (id) => sync.mutate("REMOVE_SUGGESTION", { projectId: project.id, suggestionId: id });
  const pending = suggestions.filter(s => s.status === "pending");

  return (
    <div className="box">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="eyebrow">
          // vorschläge {pending.length > 0 && <span className="chip" style={{ marginLeft: 6 }}>{pending.length}</span>}
        </span>
        <button className="btn tiny primary" onClick={trigger} disabled={busy}>
          {busy ? "läuft…" : "💡 generieren"}
        </button>
      </div>
      {suggestions.length === 0
        ? <div className="empty"><div>noch keine vorschläge.</div><div style={{ fontSize: 11, marginTop: 4 }}>klick auf „generieren" — claude analysiert die app + schlägt verbesserungen vor</div></div>
        : (
          <div className="suggest-list">
            {suggestions.slice(0, 12).map(s => (
              <div key={s.id} className={"suggest-item status-" + s.status}>
                <div className="suggest-head">
                  <span className={"chip cat-" + s.category}>{s.category}</span>
                  <span className="chip">aufwand: {s.effort}</span>
                  <span className="grow" />
                  <span className="status-tag">{s.status}</span>
                </div>
                <div className="suggest-title">{s.title}</div>
                {s.reason && <div className="suggest-reason">{s.reason}</div>}
                {s.status === "pending"
                  ? (
                    <div className="suggest-actions">
                      <button className="btn tiny primary" onClick={() => accept(s)}>✓ als aufgabe</button>
                      <button className="btn tiny" onClick={() => reject(s.id)}>✕ ablehnen</button>
                    </div>
                  ) : (
                    <div className="suggest-actions">
                      <button className="btn tiny danger" onClick={() => remove(s.id)}>× entfernen</button>
                    </div>
                  )
                }
              </div>
            ))}
          </div>
        )
      }
    </div>
  );
}

// Bugs-block: nur sichtbar wenn es welche gibt — sonst clutter weg.
function BugsBlock({ project }) {
  const bugs = project.bugs || [];
  const [busy, setBusy] = useState(false);
  const timerRef = useRef(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const trigger = async () => {
    setBusy(true);
    try { await sync.ccBughunt(project.id); } catch (e) {}
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setBusy(false), 60000);
  };
  const accept = (b) => {
    sync.mutate("ADD_TASK", { projectId: project.id, task: {
      title: `[bug] ${b.description}` + (b.location ? ` (${b.location})` : ""),
      done: false, group: "next",
      meta: "bug · " + b.severity,
      priority: b.severity === "high" ? 5 : b.severity === "medium" ? 4 : 3,
      subtasks: b.fix ? [{ title: "fix-hint: " + b.fix.slice(0, 100), done: false }] : [],
    }});
    sync.mutate("SET_BUG_STATUS", { projectId: project.id, bugId: b.id, status: "fixing" });
  };
  const dismiss = (id) => sync.mutate("SET_BUG_STATUS", { projectId: project.id, bugId: id, status: "dismissed" });
  const remove = (id) => sync.mutate("REMOVE_BUG", { projectId: project.id, bugId: id });
  const toggleAuto = () => sync.mutate("TOGGLE_BUG_AUTO_FIX", { projectId: project.id, on: !project.bugAutoFix });
  const pending = bugs.filter(b => b.status === "pending");

  // Wenn keine bugs UND nicht gerade gesucht wird: kompakte action-row statt voller box.
  if (bugs.length === 0 && !busy) {
    return (
      <div className="box" style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 14px",
      }}>
        <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
          <span className="eyebrow" style={{ marginRight: 8 }}>// bugs</span>
          keine bugs gefunden.
        </span>
        <button className="btn tiny" onClick={trigger}>🐞 hunt starten</button>
      </div>
    );
  }
  return (
    <div className="box">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span className="eyebrow">// bugs {pending.length > 0 && <span className="chip" style={{ marginLeft: 6, color: "#c33", borderColor: "#c33" }}>{pending.length}</span>}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--ink-soft)", cursor: "pointer" }}
                 title="alle 30min auto-scan + neue bugs werden automatisch zu cc-tasks">
            <input type="checkbox" checked={!!project.bugAutoFix} onChange={toggleAuto} />
            auto-fix
          </label>
          <button className="btn tiny primary" onClick={trigger} disabled={busy}>
            {busy ? "läuft…" : "🐞 hunt"}
          </button>
        </div>
      </div>
      <div className="suggest-list">
        {bugs.slice(0, 10).map(b => (
          <div key={b.id} className={"bug-item severity-" + b.severity + " status-" + b.status}>
            <div className="suggest-head">
              <span className={"chip sev-" + b.severity}>{b.severity}</span>
              {b.location && <span className="chip mono">{b.location}</span>}
              <span className="grow" />
              <span className="status-tag">{b.status}</span>
            </div>
            <div className="suggest-title">{b.description}</div>
            {b.fix && <div className="suggest-reason">→ {b.fix}</div>}
            {b.status === "pending"
              ? (
                <div className="suggest-actions">
                  <button className="btn tiny primary" onClick={() => accept(b)}>⚡ fixen lassen</button>
                  <button className="btn tiny" onClick={() => dismiss(b.id)}>✕ verwerfen</button>
                </div>
              ) : (
                <div className="suggest-actions">
                  <button className="btn tiny danger" onClick={() => remove(b.id)}>× entfernen</button>
                </div>
              )
            }
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Übersicht · neue 4-block-anordnung ────────────────────────
// 1) Onboarding-3-schritte  |  Mini-Chat
// 2) Stat-chips (aufgaben · regeln · ideen · cc-status)
// 3) Vorschläge  |  Notizen + Termine (gestapelt)
// 4) Bugs (nur wenn welche da sind)
function ScreenOverview({ project, onOpenMembers, onOpenPair, onSetTab }) {
  const tasks = project.tasks || [], rules = project.rules || [], ideas = project.ideas || [];
  const stats = {
    open: tasks.filter(t => !t.done).length,
    rules: rules.filter(r => r.active).length,
    ideas: ideas.filter(i => i.status === "unprocessed").length,
  };
  const ccRunning = !!(sync.state?.ccRunning);
  // Multi-user: sync.user.email. Pair-token-only: sync.deviceName als label.
  const myEmail = (sync.user && sync.user.email) || sync.deviceName || null;
  const NotesSection = window.TeamNotesSection;
  const AppointmentsSection = window.TeamAppointmentsSection;

  return (
    <>
      {/* Device/Conflict-banners bleiben oben (selten sichtbar, aber kritisch wenn aktiv) */}
      {window.DevicePanel ? <window.DevicePanel project={project}
                                                 me={{ deviceType: "desktop" }}
                                                 apiBase={sync.serverUrl}
                                                 token={sync.token} /> : null}

      {/* Block 1 — Onboarding + Mini-Chat
          D5 · Auto-collapse wenn alle 3 schritte mind. einmal erledigt sind:
            (1) min. 1 idee erfasst, (2) team > 1 mitglied, (3) chat > 0 msgs
          User kann manuell wieder ausklappen via dismiss-state in localStorage. */}
      <OnboardingBlock project={project} myEmail={myEmail}
                       onSetTab={onSetTab} onOpenMembers={onOpenMembers} />

      {/* Block 2 — Stat-cards (icon-left, klick wechselt tab) */}
      <div className="statcard-grid cols-4" style={{ marginTop: 14 }}>
        <StatChip label="aufgaben" value={stats.open} icon="✓" accent={stats.open > 0}
                  onClick={() => onSetTab && onSetTab("tasks")} />
        <StatChip label="regeln" value={stats.rules} icon="§"
                  onClick={() => onSetTab && onSetTab("rules")} />
        <StatChip label="ideen" value={stats.ideas} icon="💡" accent={stats.ideas > 0}
                  onClick={() => onSetTab && onSetTab("ideas")} />
        <StatChip label={ccRunning ? "cloud-code aktiv" : "cloud-code pause"}
                  value={ccRunning ? "⚡" : "○"} icon="☁"
                  onClick={() => onSetTab && onSetTab("cloud")} />
      </div>

      {/* Block 3 — Vorschläge | Notizen + Termine */}
      <div className="two-col" style={{ marginTop: 14 }}>
        <SuggestionsSlim project={project} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {NotesSection ? <NotesSection project={project} sync={sync} /> :
            <div className="box"><div className="eyebrow">// notizen</div><div className="empty"><div>team-modul lädt…</div></div></div>}
          {AppointmentsSection ? <AppointmentsSection project={project} sync={sync} myEmail={myEmail} /> :
            <div className="box"><div className="eyebrow">// termine</div><div className="empty"><div>team-modul lädt…</div></div></div>}
        </div>
      </div>

      {/* Block 4 — Bugs (kompakt wenn leer, voll wenn welche da) */}
      <div style={{ marginTop: 14 }}>
        <BugsBlock project={project} />
      </div>
    </>
  );
}

function progressBar(p) {
  const total = (p.tasks || []).length;
  if (!total) return "—";
  const done = p.tasks.filter(t => t.done).length;
  const ratio = done / total;
  const filled = Math.round(ratio * 6);
  return "■".repeat(filled) + "□".repeat(6 - filled) + "  " + done + "/" + total;
}

// ─── Screen: Aufgaben ─────────────────────────────────────────
function ScreenTasks({ project, onCcRun }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", group: "next", meta: "" });
  const [subDraft, setSubDraft] = useState({ taskId: null, title: "" });
  const inputRef = useRef(null);

  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  const tasks = project.tasks || [];
  const groups = [
    { id: "in_progress", label: "in arbeit" },
    { id: "next",        label: "als nächstes" },
    { id: "done",        label: "erledigt" },
  ];

  // Task die gerade von cc bearbeitet wird → temporär in „in arbeit" gruppe
  // anzeigen, egal welche group das task-record hat. Server liefert dafür
  // project.currentCcTaskId aus dem in-memory ccJobs-state.
  const ccTaskId = project.currentCcTaskId || null;
  const filtered = (group) => {
    let ts = tasks.filter(t => {
      if (group === "in_progress") {
        // „in arbeit" zeigt: alle die explizit in dieser gruppe sind + die
        // aktuell von cc bearbeitete task (egal woher).
        return t.group === "in_progress" || t.id === ccTaskId;
      }
      // andere gruppen: zeige den eigenen group-eintrag, ABER nicht die task
      // die gerade cc-bearbeitet wird (die wandert hoch in „in arbeit").
      return t.group === group && t.id !== ccTaskId;
    });
    if (filter === "open") ts = ts.filter(t => !t.done);
    if (filter === "done") ts = ts.filter(t => t.done);
    // Search-filter (title + meta)
    const q = search.trim().toLowerCase();
    if (q) ts = ts.filter(t =>
      (t.title || "").toLowerCase().includes(q) ||
      (t.meta || "").toLowerCase().includes(q));
    // Nach Priorität absteigend (5 oben, 1 unten)
    ts = [...ts].sort((a, b) => (b.priority || 3) - (a.priority || 3));
    return ts;
  };

  const totalFiltered = groups.reduce((sum, g) => sum + filtered(g.id).length, 0);
  const isEmpty = totalFiltered === 0;

  const movePriority = (taskId, delta) =>
    sync.mutate("MOVE_TASK_PRIORITY", { projectId: project.id, taskId, delta });

  const toggle = (taskId) => sync.mutate("TOGGLE_TASK", { projectId: project.id, taskId });
  const toggleSub = (taskId, subtaskId) => sync.mutate("TOGGLE_SUBTASK", { projectId: project.id, taskId, subtaskId });

  const addTask = () => {
    if (!draft.title.trim()) return;
    sync.mutate("ADD_TASK", { projectId: project.id, task: {
      title: draft.title.trim(), done: false, group: draft.group, meta: draft.meta.trim(), subtasks: []
    }});
    sync.mutate("ADD_SYNC_LOG", { entry: { source: "desktop", projectId: project.id, text: `aufgabe erstellt: <i>${draft.title.trim()}</i>` }});
    setDraft({ title: "", group: "next", meta: "" });
    setAdding(false);
  };

  const removeTask = (taskId) => {
    // Defensive: titel zeigen + bestätigen. user-report 'klick auf x cancelt
    // alle' deutete auf accidental clicks oder unklare scope hin. mit
    // confirm bekommt der user sicherheit dass nur DIESE eine aufgabe weg ist.
    const t = (project.tasks || []).find(x => x.id === taskId);
    const title = t ? t.title : "diese aufgabe";
    if (!confirm("aufgabe wirklich löschen?\n\n„" + title.slice(0, 120) + "\"")) return;
    console.log("[remove-task] id=" + taskId + " title=" + title);
    sync.mutate("REMOVE_TASK", { projectId: project.id, taskId });
  };
  const editTask = (taskId, patch) => sync.mutate("EDIT_TASK", { projectId: project.id, taskId, patch });

  const addSub = (taskId) => {
    const v = subDraft.title.trim();
    if (!v) { setSubDraft({ taskId: null, title: "" }); return; }
    sync.mutate("ADD_SUBTASK", { projectId: project.id, taskId, subtask: { title: v, done: false }});
    setSubDraft({ taskId: null, title: "" });
  };
  const removeSub = (taskId, subtaskId) => sync.mutate("REMOVE_SUBTASK", { projectId: project.id, taskId, subtaskId });

  return (
    <>
      {/* D3 · Filter-chips zeigen DIREKT die zahlen (war doppelt: chips + counters rechts) */}
      <div className="filter-bar">
        <span className={"fb-chip" + (filter === "all" ? " active" : "")} onClick={() => setFilter("all")}>alle <strong style={{ marginLeft: 4, opacity: 0.7 }}>{tasks.length}</strong></span>
        <span className={"fb-chip" + (filter === "open" ? " active" : "")} onClick={() => setFilter("open")}>offen <strong style={{ marginLeft: 4, opacity: 0.7 }}>{tasks.filter(t => !t.done).length}</strong></span>
        <span className={"fb-chip" + (filter === "done" ? " active" : "")} onClick={() => setFilter("done")}>erledigt <strong style={{ marginLeft: 4, opacity: 0.7 }}>{tasks.filter(t => t.done).length}</strong></span>
        <span className="grow" />
        <input className="input" placeholder="suchen…" value={search}
               onChange={(e) => setSearch(e.target.value)}
               style={{ maxWidth: 200, fontSize: 12, padding: "4px 10px" }} />
        <button className="btn primary tiny" onClick={() => setAdding(s => !s)}>+ aufgabe</button>
      </div>
      {isEmpty && !adding && (
        <div className="box" style={{ textAlign: "center", padding: 32, color: "var(--ink-soft)" }}>
          {search.trim()
            ? <div>kein treffer für „<strong>{search}</strong>"</div>
            : tasks.length === 0
              ? <div>noch keine aufgaben — leg eine an um zu starten 🚀</div>
              : <div>alles erledigt 🎉</div>}
        </div>
      )}

      {adding && (
        <div className="box" style={{ marginBottom: 14 }}>
          <div className="eyebrow">// neue aufgabe</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input ref={inputRef} className="input big" placeholder="was ist zu tun?"
                   value={draft.title}
                   onChange={e => setDraft({ ...draft, title: e.target.value })}
                   onKeyDown={e => { if (e.key === "Enter") addTask(); if (e.key === "Escape") setAdding(false); }} />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select className="input" style={{ width: 160 }} value={draft.group} onChange={e => setDraft({ ...draft, group: e.target.value })}>
                <option value="in_progress">in arbeit</option>
                <option value="next">als nächstes</option>
                <option value="done">erledigt</option>
              </select>
              <input className="input" placeholder="meta (z.B. hoch, cc-vorschlag)"
                     value={draft.meta} onChange={e => setDraft({ ...draft, meta: e.target.value })} />
              <button className="btn primary" onClick={addTask}>speichern</button>
              <button className="btn" onClick={() => setAdding(false)}>abbrechen</button>
            </div>
          </div>
        </div>
      )}

      {groups.map(g => {
        const list = filtered(g.id);
        if (filter !== "all" && list.length === 0) return null;
        return (
          <div className="box" key={g.id} style={{ marginBottom: 12 }}>
            <div className="eyebrow">// {g.label} <span style={{ opacity: 0.5 }}>· {list.length}</span></div>
            {list.length === 0
              ? <div className="empty"><div>nichts hier.</div></div>
              : list.map(t => {
                const prio = typeof t.priority === "number" ? t.priority : 3;
                const isCcOnThis = t.id === ccTaskId;
                const ccElapsed = isCcOnThis && project.currentCcStartedAt
                  ? Math.max(0, Math.round((Date.now() - project.currentCcStartedAt) / 1000)) : 0;
                // Letzten cc-job für diese task aus budget.jobs finden (zeit + kosten)
                const ccJob = (sync.state?.ccBudget?.jobs || []).find(j => j.taskId === t.id);
                const ccDur = ccJob ? Math.round((ccJob.durationMs || 0) / 1000) : null;
                const ccCost = ccJob ? +(ccJob.costUsd || 0).toFixed(3) : null;
                return (
                  <div className={"task" + (isCcOnThis ? " cc-busy" : "")}
                       key={t.id} data-prio={prio}
                       style={isCcOnThis ? { borderLeft: "3px solid #6ab1ff" } : undefined}>
                    <div className="check-wrap">
                      <span className={"check" + (t.done ? " done" : "")} onClick={() => toggle(t.id)} />
                    </div>
                    <div>
                      <div className={"task-text" + (t.done ? " done" : "")}>
                        <span className={"prio-badge prio-" + prio} title={"priorität " + prio + "/5"}>
                          {"●".repeat(prio) + "○".repeat(5 - prio)}
                        </span>
                        {isCcOnThis && (
                          <span style={{
                            marginLeft: 6, padding: "1px 6px", borderRadius: 4,
                            background: "rgba(106,177,255,0.15)", color: "#6ab1ff",
                            fontSize: 10, fontWeight: 600, letterSpacing: 0.3,
                          }} title="claude-code bearbeitet diese aufgabe gerade">
                            🔄 cc · {ccElapsed}s
                          </span>
                        )}
                        {!isCcOnThis && t.done && ccDur !== null && (
                          <span style={{
                            marginLeft: 6, padding: "1px 5px", borderRadius: 4,
                            background: "rgba(120,120,130,0.12)", color: "var(--ink-faint)",
                            fontSize: 10, fontFamily: "monospace",
                          }} title={"cc dauer · kosten · model"}>
                            cc {ccDur}s · ${ccCost}
                          </span>
                        )}
                        <Editable value={t.title} onChange={v => editTask(t.id, { title: v.trim() || t.title })} />
                      </div>
                      {((t.subtasks || []).length > 0 || subDraft.taskId === t.id) && (
                        <div className="subtasks">
                          {(t.subtasks || []).map(s => (
                            <div className="sub-row" key={s.id}>
                              <span className={"check" + (s.done ? " done" : "")} onClick={() => toggleSub(t.id, s.id)} />
                              <span className={"sub-text" + (s.done ? " done" : "")} style={{ flex: 1 }}>{s.title}</span>
                              <button className="x-btn" onClick={() => removeSub(t.id, s.id)}>×</button>
                            </div>
                          ))}
                          {subDraft.taskId === t.id && (
                            <div className="sub-row">
                              <span className="check" />
                              <input className="input" autoFocus placeholder="sub-task…"
                                     value={subDraft.title}
                                     onChange={e => setSubDraft({ ...subDraft, title: e.target.value })}
                                     onKeyDown={e => {
                                       if (e.key === "Enter") addSub(t.id);
                                       if (e.key === "Escape") setSubDraft({ taskId: null, title: "" });
                                     }}
                                     onBlur={() => addSub(t.id)} />
                            </div>
                          )}
                        </div>
                      )}
                      {!t.done && subDraft.taskId !== t.id && (
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button className="btn tiny ghost" onClick={() => setSubDraft({ taskId: t.id, title: "" })}>+ sub-task</button>
                          {!t.done && <button className="btn tiny ghost" onClick={() => onCcRun(t.id)}>⚡ an cloud-code</button>}
                          {!t.done && (t.subtasks || []).length === 0 && (
                            <button className="btn tiny ghost" title="cc zerlegt task in 3-8 subtasks (1× claude-call, ~0.20$)"
                                    onClick={async () => {
                                      try {
                                        await sync._http("POST", "/api/cc/decompose", { projectId: project.id, taskId: t.id });
                                      } catch (e) { alert("decompose: " + (e.message || "fehler")); }
                                    }}>🪓 zerlegen</button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="prio-controls">
                      <button className="x-btn" title="priorität +1" onClick={() => movePriority(t.id, +1)} disabled={prio >= 5}>↑</button>
                      <button className="x-btn" title="priorität −1" onClick={() => movePriority(t.id, -1)} disabled={prio <= 1}>↓</button>
                    </div>
                    <div className="task-meta">
                      <Editable value={t.meta || ""} onChange={v => editTask(t.id, { meta: v })} placeholder="meta" />
                    </div>
                    <button className="x-btn" title="entfernen" onClick={() => removeTask(t.id)}>×</button>
                  </div>
                );
              })
            }
          </div>
        );
      })}
    </>
  );
}

// ─── Screen: Regeln ───────────────────────────────────────────
function ScreenRules({ project }) {
  const [adding, setAdding] = useState({ open: false, category: "code-stil", text: "" });
  const [showSuggested, setShowSuggested] = useState(false);
  const rules = project.rules || [];

  const toggle = (ruleId) => sync.mutate("TOGGLE_RULE", { projectId: project.id, ruleId });
  const remove = (ruleId) => sync.mutate("REMOVE_RULE", { projectId: project.id, ruleId });
  const editRule = (ruleId, text) => sync.mutate("EDIT_RULE", { projectId: project.id, ruleId, text });
  const add = () => {
    if (!adding.text.trim()) return;
    sync.mutate("ADD_RULE", { projectId: project.id, rule: { category: adding.category, text: adding.text.trim(), active: true }});
    sync.mutate("ADD_SYNC_LOG", { entry: { source: "desktop", projectId: project.id, text: `regel hinzugefügt: <i>${adding.text.trim()}</i>` }});
    setAdding({ open: false, category: adding.category, text: "" });
  };
  const addRecommended = (r) => {
    sync.mutate("ADD_RULE", { projectId: project.id, rule: { category: r.category, text: r.text, active: true }});
    sync.mutate("ADD_SYNC_LOG", { entry: { source: "desktop", projectId: project.id, text: `empfohlene regel aktiviert: <i>${r.text}</i>` }});
  };

  const grouped = RULE_CATS.map(c => ({ name: c, items: rules.filter(r => r.category === c) }));

  // Welche empfohlenen Regeln sind bereits drin?
  const norm = (s) => String(s).trim().toLowerCase();
  const existingTexts = new Set(rules.map(r => norm(r.text)));
  const suggestedAvailable = SUGGESTED_RULES.filter(s => !existingTexts.has(norm(s.text)));

  // CC-vorgeschlagene (inactive, suggestedBy === "cloud-code")
  const ccSuggestions = rules.filter(r => !r.active && r.suggestedBy === "cloud-code");

  const pendingDiffsCount = (window.RuleDiffsViewHelpers && window.RuleDiffsViewHelpers.countPending(project)) || 0;

  return (
    <>
      {window.RuleDiffsPanel ? <window.RuleDiffsPanel project={project} /> : null}
      <div className="filter-bar">
        <span className="chip solid">aktiv: {rules.filter(r => r.active).length}</span>
        <span className="chip">total: {rules.length}</span>
        {pendingDiffsCount > 0 && <span className="chip" style={{ borderColor: "#c80", color: "#c80" }}>regel-diffs: {pendingDiffsCount}</span>}
        {ccSuggestions.length > 0 && <span className="chip" style={{ borderColor: "#c80", color: "#c80" }}>cc-vorschläge: {ccSuggestions.length}</span>}
        <span className="grow" />
        <button className="btn tiny" onClick={() => setShowSuggested(s => !s)}>
          {showSuggested ? "↑ empfohlene aus" : `↓ empfohlene (${suggestedAvailable.length})`}
        </button>
        <button className="btn primary tiny" onClick={() => setAdding({ open: true, category: "code-stil", text: "" })}>+ regel</button>
      </div>

      {showSuggested && suggestedAvailable.length > 0 && (
        <div className="box recommended-box" style={{ marginBottom: 12 }}>
          <div className="eyebrow">// empfohlene regeln · klick zum aktivieren</div>
          <div className="recommended-grid">
            {suggestedAvailable.map((r, i) => (
              <button key={i} className="recommended-item" onClick={() => addRecommended(r)} title="aktivieren">
                <span className="rec-cat">{r.category}</span>
                <span className="rec-text">{r.text}</span>
                <span className="rec-add">+</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {ccSuggestions.length > 0 && (
        <div className="box cc-suggestions" style={{ marginBottom: 12 }}>
          <div className="eyebrow">// cloud-code regel-vorschläge · klick zum annehmen</div>
          {ccSuggestions.map(r => (
            <div className="rec-row" key={r.id}>
              <span className="chip">{r.category}</span>
              <span className="rec-text" style={{ flex: 1 }}>{r.text}</span>
              <button className="btn tiny primary" onClick={() => toggle(r.id)}>annehmen</button>
              <button className="btn tiny" onClick={() => remove(r.id)}>verwerfen</button>
            </div>
          ))}
        </div>
      )}

      {adding.open && (
        <div className="box" style={{ marginBottom: 12 }}>
          <div className="eyebrow">// neue regel</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select className="input" style={{ width: 160 }} value={adding.category}
                    onChange={e => setAdding({ ...adding, category: e.target.value })}>
              {RULE_CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="input" placeholder="z.B. öffentliche api dokumentiert" autoFocus
                   value={adding.text} onChange={e => setAdding({ ...adding, text: e.target.value })}
                   onKeyDown={e => { if (e.key === "Enter") add(); if (e.key === "Escape") setAdding({ ...adding, open: false }); }} />
            <button className="btn primary" onClick={add}>hinzufügen</button>
            <button className="btn" onClick={() => setAdding({ ...adding, open: false })}>abbrechen</button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 12, color: "var(--ink-soft)", fontSize: 12 }}>
        <span className="squig">cloud code</span> respektiert diese regeln bei jeder änderung.
      </div>

      {/* 2-col layout: rules-cols main + right-sidebar mit donut + top + activity */}
      <div className="pg-screen">
        <div className="pg-main">
          <div className="three-col">
            {grouped.map(g => (
              <div className="box" key={g.name}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <span className={"pg-cat pg-cat-" + g.name}>{g.name}</span>
                  <span className="chip">{g.items.filter(r => r.active).length}/{g.items.length}</span>
                </div>
                {g.items.length === 0
                  ? <div className="empty" style={{ padding: 14 }}><div>noch keine regel.</div></div>
                  : g.items.map(r => (
                      <div className="rule-row" key={r.id}>
                        <span className={"check" + (r.active ? " done" : "")} onClick={() => toggle(r.id)} />
                        <div className={"text" + (r.active ? "" : " inactive")}>
                          <Editable value={r.text} onChange={v => editRule(r.id, v.trim() || r.text)} />
                        </div>
                        <button className="x-btn" onClick={() => remove(r.id)}>×</button>
                      </div>
                    ))
                }
                <button className="btn tiny" style={{ marginTop: 10 }}
                        onClick={() => setAdding({ open: true, category: g.name, text: "" })}>
                  + hinzufügen
                </button>
              </div>
            ))}
          </div>
        </div>
        <aside className="pg-aside">
          <RulesByCategoryPanel rules={rules} />
          <RulesTopExecutedPanel rules={rules} activity={project.activity || []} />
          <RulesActivityPanel activity={project.activity || []} />
        </aside>
      </div>
    </>
  );
}

// Donut-chart + legend für regeln nach kategorie (SVG, kein chart-lib).
function RulesByCategoryPanel({ rules }) {
  const COLORS = {
    "code-stil":  "#5dd07a",
    "architektur": "#ff8c66",
    "workflow":    "#a78bfa",
    "ci-cd":       "#22d3ee",
    "sonstige":    "#6b7280",
  };
  const counts = {};
  for (const r of rules) {
    if (!r.active) continue;
    const c = r.category || "sonstige";
    counts[c] = (counts[c] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  // SVG-donut
  const cx = 50, cy = 50, r = 36, sw = 14;
  let offset = -Math.PI / 2;
  const segments = Object.entries(counts).map(([cat, count]) => {
    const frac = count / total;
    const angle = frac * 2 * Math.PI;
    const x1 = cx + Math.cos(offset) * r;
    const y1 = cy + Math.sin(offset) * r;
    offset += angle;
    const x2 = cx + Math.cos(offset) * r;
    const y2 = cy + Math.sin(offset) * r;
    const large = angle > Math.PI ? 1 : 0;
    return {
      cat, count,
      path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`,
      color: COLORS[cat] || COLORS.sonstige,
    };
  });
  return (
    <div className="pg-side-panel">
      <div className="panel-title">Regeln nach Kategorie</div>
      <div className="pg-donut-wrap">
        <svg width="100" height="100" viewBox="0 0 100 100" style={{ flexShrink: 0 }}>
          {segments.length === 0 ? (
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--line)" strokeWidth={sw} />
          ) : segments.map((s, i) => (
            <path key={i} d={s.path} fill={s.color} />
          ))}
          <circle cx={cx} cy={cy} r={r - sw} fill="var(--paper)" />
        </svg>
        <div className="pg-donut-legend">
          {Object.entries(counts).length === 0
            ? <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>keine aktiven regeln</div>
            : Object.entries(counts).map(([cat, count]) => (
              <div className="pg-donut-legend-row" key={cat}>
                <span className="dot" style={{ background: COLORS[cat] || COLORS.sonstige }} />
                <span className="lbl">{cat}</span>
                <span className="num">{count}</span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}

// Top-5 regeln nach aktivity-erwähnungen (proxy für "ausführungen").
function RulesTopExecutedPanel({ rules, activity }) {
  // count rule.text-mentions in activity-events
  const counts = new Map();
  for (const a of activity) {
    const txt = (a.text || "").toLowerCase();
    for (const r of rules) {
      if (!r.active) continue;
      const key = r.text.toLowerCase().slice(0, 30);
      if (key && txt.includes(key)) {
        counts.set(r.id, (counts.get(r.id) || 0) + 1);
      }
    }
  }
  const top = [...rules]
    .filter(r => r.active)
    .map(r => ({ r, n: counts.get(r.id) || 0 }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
  return (
    <div className="pg-side-panel">
      <div className="panel-title">Top Regeln nach Erwähnungen</div>
      {top.length === 0 || top.every(t => t.n === 0)
        ? <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>noch keine cc-runs mit regel-bezug</div>
        : top.map(({ r, n }) => (
          <div className="pg-metric-row" key={r.id}>
            <span className="ico">📈</span>
            <span className="label" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>{r.text}</span>
            <span className="value">{n}</span>
          </div>
        ))
      }
    </div>
  );
}

// Letzte regel-bezogene activity (rule-type events).
function RulesActivityPanel({ activity }) {
  const ruleActs = (activity || []).filter(a => a.type === "rule" || /regel/i.test(a.text || "")).slice(0, 5);
  return (
    <div className="pg-side-panel">
      <div className="panel-title">Letzte Aktivitäten</div>
      {ruleActs.length === 0
        ? <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>noch keine regel-änderungen</div>
        : ruleActs.map(a => (
          <div className="pg-metric-row" key={a.id} style={{ alignItems: "flex-start" }}>
            <span className="ico" style={{ color: "var(--ok)" }}>✓</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                   dangerouslySetInnerHTML={{ __html: a.text }} />
              <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 2 }}>{relTime(a.ts)}</div>
            </div>
          </div>
        ))
      }
    </div>
  );
}

// ─── Screen: Ideen ────────────────────────────────────────────
function ScreenIdeas({ project }) {
  const [draft, setDraft] = useState("");
  const ideas = project.ideas || [];

  const addIdea = () => {
    if (!draft.trim()) return;
    sync.mutate("ADD_IDEA", { projectId: project.id, idea: { text: draft.trim(), status: "unprocessed", source: "desktop", createdAt: NOW() }});
    sync.mutate("ADD_SYNC_LOG", { entry: { source: "desktop", projectId: project.id, text: `idee erfasst: „${draft.trim()}“` }});
    setDraft("");
  };
  const convertToTask = (id) => {
    // KI-Vorschlag inline akzeptieren: title/meta/priority mitsenden,
    // server faellt auf raw-text zurueck, falls Felder fehlen.
    const idea = ideas.find(i => i.id === id);
    const s = idea && window.aiSuggestTask ? window.aiSuggestTask(idea.text || "") : null;
    const payload = { projectId: project.id, ideaId: id };
    if (s) { payload.title = s.title; payload.meta = s.meta; payload.priority = s.priority; }
    sync.mutate("CONVERT_IDEA", payload);
    sync.mutate("ADD_SYNC_LOG", { entry: {
      source: "desktop", projectId: project.id,
      text: `idee „${idea ? idea.text : ""}“ → aufgabe${s ? ` (ki: ${s.priority})` : ""}`,
    }});
  };
  const dismiss = (id) => sync.mutate("DISMISS_IDEA", { projectId: project.id, ideaId: id });
  const reactivate = (id) => sync.mutate("REACTIVATE_IDEA", { projectId: project.id, ideaId: id });
  const remove = (id) => sync.mutate("REMOVE_IDEA", { projectId: project.id, ideaId: id });
  const editIdea = (id, text) => sync.mutate("EDIT_IDEA", { projectId: project.id, ideaId: id, text });

  const grp = (status) => ideas.filter(i => i.status === status);

  return (
    <>
      <div className="box" style={{ marginBottom: 12 }}>
        <div className="eyebrow">// schnelle idee erfassen</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input big" placeholder="was fällt dir gerade ein?"
                 value={draft} onChange={e => setDraft(e.target.value)}
                 onKeyDown={e => { if (e.key === "Enter") addIdea(); }} />
          <button className="btn primary" onClick={addIdea}>speichern</button>
        </div>
      </div>

      {[
        { status: "unprocessed", title: "unbearbeitet" },
        { status: "task_created", title: "→ in aufgaben" },
        { status: "processed", title: "verworfen / erledigt" },
      ].map(g => {
        const list = grp(g.status);
        return (
          <div className="box" key={g.status} style={{ marginBottom: 12 }}>
            <div className="eyebrow">// {g.title} <span style={{ opacity: 0.5 }}>· {list.length}</span></div>
            {list.length === 0
              ? <div className="empty" style={{ padding: 14 }}><div>—</div></div>
              : list.map(i => (
                  <div className="idea" key={i.id}>
                    <div className="text">
                      {i.source === "cloud-code" && (
                        <span className="chip cc-source-chip" style={{ marginRight: 8 }}>
                          🤖 cloud-code vorschlag
                        </span>
                      )}
                      <Editable value={i.text} onChange={v => editIdea(i.id, v.trim() || i.text)} />
                      <div className="meta">
                        {i.source === "mobile" ? "📱" : i.source === "cloud-code" ? "🤖" : "💻"} {relTime(i.createdAt)}
                        {i.status === "unprocessed" && " · noch nicht verarbeitet"}
                        {i.status === "task_created" && " · ✓ aufgabe erstellt"}
                        {i.status === "processed" && " · ✓ verworfen"}
                      </div>
                    </div>
                    <div className="actions">
                      {i.status === "unprocessed" && (
                        <>
                          {window.InlineSuggestRow && (
                            <window.InlineSuggestRow
                              projectId={project.id}
                              ideaId={i.id}
                              ideaText={i.text || ""}
                              sync={sync}
                            />
                          )}
                          <button className="btn tiny" onClick={() => convertToTask(i.id)}>→ aufgabe</button>
                          <button className="btn tiny" onClick={() => dismiss(i.id)}>verwerfen</button>
                        </>
                      )}
                      {i.status === "processed" && (
                        <button className="btn tiny" onClick={() => reactivate(i.id)}>↺ reaktivieren</button>
                      )}
                      <button className="btn tiny danger" onClick={() => remove(i.id)}>×</button>
                    </div>
                  </div>
                ))
            }
          </div>
        );
      })}
    </>
  );
}

// ─── Screen: Cloud-Code ───────────────────────────────────────
const ACT_GLYPHS = {
  write: "●", check: "✓", read: "►", warn: "!", edit: "✎", sync: "↻", rule: "⚖", info: "ⓘ",
};

// Cc-Rückfrage-Widget: claude hat eine frage zum projekt → user antwortet,
// skipped („mach autonom weiter") oder verwirft. Erscheint OBERHALB des
// freien prompts wenn project.pendingQuestion gesetzt ist.
// Wenn auto-answer aktiv: zeigt countdown bis zur auto-antwort.
function CcPendingQuestion({ question, onAnswer, autoAnswer, autoAnswerDelaySec, pendingAt, onToggleAutoAnswer, onChangeDelay }) {
  const [answer, setAnswer] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!autoAnswer) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [autoAnswer]);
  const remainingMs = autoAnswer
    ? Math.max(0, (pendingAt || now) + (autoAnswerDelaySec * 1000) - now)
    : null;
  const remainingSec = remainingMs == null ? null : Math.ceil(remainingMs / 1000);

  return (
    <div className="box" style={{
      marginBottom: 12,
      border: "2px solid var(--ink)",
      background: "rgba(255, 240, 200, 0.3)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="eyebrow">// claude hat eine rückfrage</div>
        {/* Auto-answer toggle inline. Pro projekt persistent (server-state). */}
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--ink-soft)", cursor: "pointer" }}>
          <input type="checkbox" checked={!!autoAnswer} onChange={(e) => onToggleAutoAnswer(e.target.checked)} />
          auto-answer
          {autoAnswer && (
            <>
              <span style={{ marginLeft: 4 }}>nach</span>
              <input type="number" min={5} max={600} step={5}
                     value={autoAnswerDelaySec || 30}
                     onChange={(e) => onChangeDelay(Number(e.target.value))}
                     style={{ width: 50, padding: "2px 4px", fontSize: 11, fontFamily: "JetBrains Mono, monospace", border: "1px solid var(--line)", borderRadius: 4 }} />
              <span>s</span>
            </>
          )}
        </label>
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.5, padding: "8px 0", fontWeight: 500 }}>
        ❓ {question}
      </div>
      {autoAnswer && remainingSec !== null && (
        <div style={{ fontSize: 12, color: remainingSec <= 5 ? "#c33" : "#cc8800", marginBottom: 6, fontWeight: 600 }}>
          ⏱ auto-antwort in {remainingSec}s — jetzt antworten zum stoppen
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
        <input className="input" placeholder="antwort eingeben (oder leer = autonom weiter)"
          value={answer} onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onAnswer(answer); }}
          style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => onAnswer(answer)}
          disabled={!answer.trim()}>antwort senden →</button>
        <button className="btn" onClick={() => onAnswer("")}
          title="ohne antwort weiterarbeiten">autonom weiter</button>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 4 }}>
        {autoAnswer
          ? "auto-answer aktiv: server beantwortet bei ablauf selber"
          : "wenn unbeantwortet bleibt: nichts passiert — auto-answer aktivieren für automatisches weiterarbeiten"}
      </div>
    </div>
  );
}

function ScreenCloud({ project, onCcRun, onCcStop, ccStatus, ccOutput, ccRunning, setCcRunning }) {
  const activity = project.activity || [];
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState([]); // {name, url, kind}
  const [uploadingAttach, setUploadingAttach] = useState(false);
  const fileInputRef = useRef(null);
  const client = useSync();

  // Bug-fix: vorher zählten alle metriken nur activity-events vom jeweiligen
  // type — d.h. 'rules' war NICHT die anzahl aktiver regeln, sondern die
  // anzahl der activity-events vom typ='rule' (wann eine regel hinzugefügt
  // wurde). user-erwartung: zähle ECHTE entities, nicht events.
  const metrics = useMemo(() => ({
    events:   activity.length,
    checks:   (project.tasks || []).filter(t => t.done).length,
    writes:   activity.filter(x => x.type === "write").length,
    reads:    activity.filter(x => x.type === "read").length,
    warnings: ((project.bugs || []).filter(b => b.status === "pending").length) +
              activity.filter(x => x.type === "warn").length,
    rules:    (project.rules || []).filter(r => r.active).length,
    ideas:    (project.ideas || []).filter(i => i.status === "unprocessed").length,
    bugs:     (project.bugs || []).filter(b => b.status === "pending").length,
    openTasks:(project.tasks || []).filter(t => !t.done).length,
  }), [activity, project.tasks, project.rules, project.ideas, project.bugs]);

  const inProgress = (project.tasks || []).filter(t => t.group === "in_progress" && !t.done);
  const status = ccStatus[project.id] || { state: "idle" };
  const isRunning = status.state === "running";
  const output = ccOutput[project.id] || "";
  const pendingQuestion = project.pendingQuestion;

  const clearLog = () => sync.mutate("CLEAR_ACTIVITY", { projectId: project.id });

  const attachFile = async (file) => {
    if (!file || uploadingAttach) return;
    setUploadingAttach(true);
    try {
      const buf = await file.arrayBuffer();
      // bytes → base64
      const bytes = new Uint8Array(buf);
      let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      const r = await fetch(client.serverUrl + "/api/projects/" + encodeURIComponent(project.id) + "/attachments", {
        method: "POST",
        headers: { authorization: "Bearer " + client.token, "content-type": "application/json" },
        body: JSON.stringify({ name: file.name, contentType: file.type || "application/octet-stream", base64: b64 }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "fehler " + r.status);
      setAttachments(a => [...a, { name: data.name, url: data.url, kind: data.kind, size: data.size }]);
    } catch (e) {
      alert("upload fehlgeschlagen: " + e.message);
    } finally {
      setUploadingAttach(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const runFreeform = () => {
    if (!prompt.trim() && inProgress.length === 0 && attachments.length === 0) return;
    // Anhänge in prompt einbetten: claude liest sie via filesystem-MCP
    let p = prompt.trim();
    if (attachments.length > 0) {
      const paths = attachments.map(a => {
        const fname = a.url.split("/").pop();
        return `.pg-uploads/${fname} (${a.name})`;
      }).join("\n  - ");
      p = `ANHÄNGE (im projekt-root lesen via Read-tool):\n  - ${paths}\n\n${p || "schau die anhänge an und antworte darauf."}`;
    }
    onCcRun({ taskId: null, prompt: p || "Was wäre als nächstes sinnvoll?" });
    setPrompt("");
    setAttachments([]);
  };

  const answerQuestion = (answer) => {
    // Antwort + projekt-frage als prompt zurück an claude
    const q = pendingQuestion || "";
    const p = answer
      ? `Frage von dir: ${q}\nMeine antwort: ${answer}\n\nMach weiter.`
      : `Frage von dir war: ${q}\nKeine antwort vom user. Mach autonom weiter mit deiner besten annahme.`;
    onCcRun({ taskId: null, prompt: p });
    sync.mutate("CLEAR_PENDING_QUESTION", { projectId: project.id });
  };

  // Token-/cost-stats: kommt aus state.ccBudget (server-tracked). Für UI:
  // letzte 20 jobs summieren statt all-time, damit zahlen aktuell wirken.
  const recentBudget = useMemo(() => {
    const jobs = ((client.state || {}).ccBudget || {}).jobs || [];
    const recent = jobs.slice(0, 20).filter(j => j.projectId === project.id);
    return recent.reduce((acc, j) => ({
      tokensIn: acc.tokensIn + (j.inputTokens || 0),
      tokensOut: acc.tokensOut + (j.outputTokens || 0),
      costUsd: acc.costUsd + (j.costUsd || 0),
      jobs: acc.jobs + 1,
    }), { tokensIn: 0, tokensOut: 0, costUsd: 0, jobs: 0 });
  }, [client.state, project.id]);

  return (
    <>
      {/* Cleaner header — klare hierarchie, controls rechts gebündelt */}
      <div className="cc-header">
        <div>
          <h2 className="cc-title">cloud-code</h2>
          <div className="cc-subtitle">
            <span className={"cc-dot" + (ccRunning ? " live" : "")}>
              {isRunning ? "läuft seit " + relTime(status.startedAt)
                : (ccRunning ? "verbunden · idle" : "pausiert")}
            </span>
            {" · "}{activity.length} events
            {!project.path && <span style={{ color: "var(--danger, #c33)", marginLeft: 10 }}>
              ⚠ kein projekt-pfad
            </span>}
            {project.path && project.pathValid === false && (
              <span style={{ color: "var(--danger, #c33)", marginLeft: 10 }}
                    title={"pfad nicht gefunden: " + project.path}>
                ⚠ pfad nicht auf diesem rechner: <code>{project.path}</code>
              </span>
            )}
          </div>
          {client.state?.ccApiLimitedUntil && client.state.ccApiLimitedUntil > Date.now() && (
            <div style={{
              marginTop: 8, padding: "8px 12px",
              border: "1.5px solid #c80", background: "#fff8e8",
              borderRadius: 6, fontSize: 12, color: "#8a5500",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <span>⏸ <strong>auto-pump pausiert</strong> bis {new Date(client.state.ccApiLimitedUntil).toLocaleTimeString()} (claude-api limit erreicht)</span>
              <button className="btn tiny" onClick={async () => {
                try {
                  await fetch(client.serverUrl + "/api/cc/resume-now", {
                    method: "POST",
                    headers: { authorization: "Bearer " + client.token },
                  });
                } catch (_) {}
              }}>fortsetzen jetzt</button>
            </div>
          )}
        </div>
        <div className="cc-controls">
          {isRunning
            ? <button className="btn tiny danger" onClick={() => onCcStop()}>■ stop</button>
            : <button className="btn tiny" onClick={() => setCcRunning(!ccRunning)}>{ccRunning ? "pause" : "▶ fortsetzen"}</button>}
          <button className="btn tiny" onClick={clearLog} disabled={!activity.length}>log leeren</button>
        </div>
      </div>

      {/* Stats-cards: 4 chips mit icon-left + label-block + value right */}
      <div className="statcard-grid cols-4">
        <div className={"statcard-row" + (metrics.checks > 0 ? " success" : "")}>
          <div className="ico">✓</div>
          <div className="body">
            <div className="label-block">
              <div className="label">Checks</div>
              <div className="sub">tasks abgehakt</div>
            </div>
            <div className="value">{metrics.checks}</div>
          </div>
        </div>
        <div className="statcard-row">
          <div className="ico">✎</div>
          <div className="body">
            <div className="label-block">
              <div className="label">Writes</div>
              <div className="sub">files berührt</div>
            </div>
            <div className="value">{metrics.writes}</div>
          </div>
        </div>
        <div className={"statcard-row" + (metrics.warnings > 0 ? " warning" : "")}>
          <div className="ico">⚠</div>
          <div className="body">
            <div className="label-block">
              <div className="label">Warnings</div>
              <div className="sub">{metrics.warnings > 0 ? "blocker offen" : "alles klar"}</div>
            </div>
            <div className="value">{metrics.warnings}</div>
          </div>
        </div>
        <div className="statcard-row">
          <div className="ico">$</div>
          <div className="body">
            <div className="label-block">
              <div className="label">Kosten · {recentBudget.jobs} Runs</div>
              <div className="sub">{(recentBudget.tokensIn/1000).toFixed(1)}k in · {(recentBudget.tokensOut/1000).toFixed(1)}k out</div>
            </div>
            <div className="value">${recentBudget.costUsd.toFixed(3)}</div>
          </div>
        </div>
      </div>

      {pendingQuestion && (
        <CcPendingQuestion
          question={pendingQuestion}
          onAnswer={answerQuestion}
          autoAnswer={!!project.ccAutoAnswer}
          autoAnswerDelaySec={project.ccAutoAnswerDelaySec || 30}
          pendingAt={project.pendingQuestionAt}
          onToggleAutoAnswer={(on) => sync.mutate("TOGGLE_CC_AUTO_ANSWER", { projectId: project.id, on })}
          onChangeDelay={(delaySec) => sync.mutate("TOGGLE_CC_AUTO_ANSWER", { projectId: project.id, on: true, delaySec })}
        />
      )}

      {/* 2-col layout: main content links + right-sidebar 320px (mockup) */}
      <div className="pg-screen">
      <div className="pg-main">
      {/* Aktuelle aufgabe sichtbar wenn run läuft oder in_progress-task vorhanden */}
      {(isRunning || inProgress.length > 0) && (
        <div className="cc-current-task">
          <div className="label">{isRunning ? "läuft gerade" : "nächste aufgabe"}</div>
          <div className="title">{isRunning && status.taskId
            ? ((project.tasks || []).find(t => t.id === status.taskId)?.title || "freier prompt")
            : (inProgress[0]?.title || "—")}</div>
        </div>
      )}

      <div className="box cc-section">
        <div className="cc-section-title">// freier prompt {attachments.length > 0 && <span style={{ opacity: 0.5 }}>· {attachments.length} anhänge</span>}</div>
        {attachments.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {attachments.map((a, i) => (
              <span key={i} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {a.kind === "image" ? "🖼" : "📎"} {a.name}
                <button onClick={() => setAttachments(arr => arr.filter((_, j) => j !== i))}
                  style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, marginLeft: 2 }}>×</button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.md,.json,.csv,.log"
            style={{ display: "none" }}
            onChange={(e) => e.target.files[0] && attachFile(e.target.files[0])} />
          <button className="btn" title="datei anhängen"
            onClick={() => fileInputRef.current?.click()}
            disabled={isRunning || uploadingAttach}
            style={{ alignSelf: "stretch", padding: "0 12px" }}>
            {uploadingAttach ? "…" : "📎"}
          </button>
          <textarea className="input" placeholder="was soll cloud-code tun? (oder leer lassen für nächste in-progress aufgabe)"
                    rows={2} value={prompt} onChange={e => setPrompt(e.target.value)}
                    style={{ flex: 1 }} />
          <button className="btn primary" onClick={runFreeform} disabled={isRunning}>
            {isRunning ? "läuft…" : "⚡ an claude"}
          </button>
        </div>
        {inProgress.length > 0 && !prompt && attachments.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 6, fontFamily: "JetBrains Mono, monospace" }}>
            ▸ leer = aufgabe „{inProgress[0].title}" · alle aktiven regeln werden beachtet
          </div>
        )}
      </div>

      {/* Task 3 · Live tool-events: was claude gerade liest/schreibt/spawnt */}
      {(client.ccToolEvents?.[project.id] || []).length > 0 && (
        <div className="box cc-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div className="cc-section-title">// tools · was claude tut</div>
            {client.ccThinkingText?.[project.id] && (
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--ink-faint)", fontStyle: "italic" }}>
                💭 {client.ccThinkingText[project.id].slice(0, 80)}
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 180, overflowY: "auto" }}>
            {(client.ccToolEvents[project.id] || []).slice(-10).map((te, i) => (
              <div key={te.id || i} style={{
                display: "flex", gap: 8, alignItems: "center",
                padding: "3px 8px", fontSize: 11.5, lineHeight: 1.5,
                fontFamily: "JetBrains Mono, monospace",
                borderRadius: 4,
                background: te.state === "error" ? "rgba(204,51,51,0.08)" : "transparent",
                color: te.state === "error" ? "#c33" : "var(--ink)",
                opacity: te.state === "running" ? 0.7 : 1,
              }}>
                <span style={{ width: 16, textAlign: "center" }}>{te.glyph}</span>
                <span style={{ fontWeight: 600, minWidth: 60 }}>{te.tool}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{te.summary}</span>
                <span style={{ fontSize: 10, color: "var(--ink-faint)" }}>
                  {te.state === "running" ? "…" : (te.state === "error" ? "✗" : "✓")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {output && (
        <div className="box cc-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div className="cc-section-title">// cloud-code antwort</div>
            {isRunning && <span className="cc-dot live">streamt…</span>}
          </div>
          <pre className="cc-output">{output.slice(-4000)}</pre>
        </div>
      )}

      <div className="box cc-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div className="cc-section-title">// live-feed</div>
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--ink-faint)" }}>
            {Math.min(activity.length, 60)} / {activity.length}
          </span>
        </div>
        {activity.length === 0
          ? <div className="empty"><div className="big">stille.</div><div>cloud code wartet auf input.</div></div>
          : <div className="cc-feed-wrap" style={{ padding: 0 }}>
              {activity.slice(0, 60).map(e => (
                <div className="pg-feed-row" key={e.id}>
                  <span className="ico">{ACT_GLYPHS[e.type] || "·"}</span>
                  <span className="text" dangerouslySetInnerHTML={{ __html: e.text }} />
                  <span className="ts">{relTime(e.ts)}</span>
                </div>
              ))}
            </div>
        }
      </div>
      </div>{/* /pg-main */}

      <aside className="pg-aside">
        <div className="pg-side-panel">
          <div className="panel-title">Metriken</div>
          <div className="pg-metric-row"><span className="ico">📈</span><span className="label">cc-events</span><span className="value">{metrics.events}</span></div>
          <div className="pg-metric-row"><span className="ico">✎</span><span className="label">writes</span><span className="value">{metrics.writes}</span></div>
          <div className="pg-metric-row"><span className="ico">👁</span><span className="label">reads</span><span className="value">{metrics.reads}</span></div>
          <div className="pg-metric-row"><span className="ico">✓</span><span className="label">tasks erledigt</span><span className="value">{metrics.checks}</span></div>
          <div className="pg-metric-row"><span className="ico">⊙</span><span className="label">tasks offen</span><span className="value">{metrics.openTasks}</span></div>
          <div className="pg-metric-row"><span className="ico">§</span><span className="label">regeln aktiv</span><span className="value">{metrics.rules}</span></div>
          <div className="pg-metric-row"><span className="ico">💡</span><span className="label">ideen offen</span><span className="value">{metrics.ideas}</span></div>
          <div className="pg-metric-row"><span className="ico">🐞</span><span className="label">bugs pending</span><span className="value">{metrics.bugs}</span></div>
          <div className="pg-metric-row"><span className="ico">⚠</span><span className="label">warnings</span><span className="value">{metrics.warnings}</span></div>
        </div>
        <div className="pg-side-panel">
          <div className="panel-title">Nächster Schritt</div>
          <div style={{ fontSize: 14, color: "var(--ink)", fontWeight: 600 }}>{inProgress[0]?.title || "Warten auf neuen Task"}</div>
          <div style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
            cloud-code arbeitet an <strong>{inProgress.length}</strong> offenen tasks · {(project.rules || []).filter(r => r.active).length} regeln aktiv
          </div>
        </div>
      </aside>
      </div>{/* /pg-screen */}
    </>
  );
}

// ─── Screen: Live-Preview ─────────────────────────────────────
function ScreenPreview({ project }) {
  const client = useSync();
  const preview = project.preview || { command: "", port: null, url: "" };
  const runtime = project.previewState || { state: "idle" };
  const isRunning = runtime.state === "running";

  const [editing, setEditing] = React.useState(false);
  const [cmd, setCmd] = React.useState(preview.command || "");
  const [port, setPort] = React.useState(preview.port || "");
  const [urlOverride, setUrlOverride] = React.useState(preview.url || "");
  const [suggestions, setSuggestions] = React.useState([]);
  const [detecting, setDetecting] = React.useState(false);
  const [detectFailed, setDetectFailed] = React.useState(false);
  const [logs, setLogs] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [iframeKey, setIframeKey] = React.useState(0);

  // Auto-detect + auto-apply: wenn kein command konfiguriert ist, holen wir
  // die suggestions und übernehmen die erste automatisch. user-input ist
  // optional, normaler weg ist: tab öffnen → start drücken.
  React.useEffect(() => {
    let cancelled = false;
    if (!preview.command && project.path) {
      setDetecting(true);
      fetch(client.serverUrl + "/api/preview/detect?projectId=" + encodeURIComponent(project.id), {
        headers: { authorization: "Bearer " + client.token },
      }).then(r => r.json()).then(d => {
        if (cancelled) return;
        const sugs = Array.isArray(d.suggestions) ? d.suggestions : [];
        setSuggestions(sugs);
        setDetecting(false);
        if (sugs.length > 0) {
          // Auto-apply: erste suggestion ohne user-klick speichern. Beim
          // nächsten render kommt preview.command aus dem state und der
          // start-button ist enabled.
          const first = sugs[0];
          client.mutate("SET_PREVIEW_CONFIG", {
            projectId: project.id,
            preview: {
              command: first.command || "",
              port: first.port || null,
              url: first.url || "",
              cwdRel: first.cwdRel || "",
              autoDetected: true,
            },
          });
          setCmd(first.command || "");
          setPort(first.port ? String(first.port) : "");
          setUrlOverride(first.url || "");
        } else {
          setDetectFailed(true);
          setEditing(true); // nur wenn auto-detect scheitert → manueller modus
        }
      }).catch(() => { if (!cancelled) { setDetecting(false); setDetectFailed(true); setEditing(true); } });
    }
    return () => { cancelled = true; };
  }, [project.id, project.path, preview.command, client.serverUrl, client.token]);

  // Subscribe to PREVIEW_OUTPUT for log-streaming (max ~200 lines)
  React.useEffect(() => {
    if (!client.ws) return;
    const onMsg = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.type === "PREVIEW_OUTPUT" && m.projectId === project.id) {
        setLogs(prev => {
          const next = [...prev, { stream: m.stream, text: m.chunk }];
          return next.length > 200 ? next.slice(-200) : next;
        });
      }
      if (m.type === "PREVIEW_STATUS" && m.projectId === project.id && m.status.state === "idle") {
        // server-seitig prozess weg → iframe refresh nicht mehr sinnvoll
      }
    };
    client.ws.addEventListener("message", onMsg);
    return () => client.ws.removeEventListener("message", onMsg);
  }, [client.ws, project.id]);

  const saveConfig = () => {
    const portNum = port === "" ? null : Number(port);
    client.mutate("SET_PREVIEW_CONFIG", {
      projectId: project.id,
      preview: {
        command: cmd.trim(),
        port: Number.isFinite(portNum) ? portNum : null,
        url: urlOverride.trim(),
        autoDetected: false,
      },
    });
    setEditing(false);
  };

  const applySuggestion = (sug) => {
    setCmd(sug.command);
    setPort(String(sug.port));
    setUrlOverride("");
  };

  const start = async () => {
    setBusy(true); setError(null); setLogs([]);
    try {
      const r = await fetch(client.serverUrl + "/api/preview/start", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + client.token },
        body: JSON.stringify({ projectId: project.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "start fehlgeschlagen");
      // dev-server braucht 2-4s bis er hört. iframe-key bumpen nach 2.5s
      setTimeout(() => setIframeKey(k => k + 1), 2500);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const stop = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(client.serverUrl + "/api/preview/stop", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + client.token },
        body: JSON.stringify({ projectId: project.id }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "stop fehlgeschlagen"); }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const iframeUrl = (runtime.url || preview.url || (preview.port ? "http://localhost:" + preview.port : "")) || "";

  return (
    <div className="pg-screen" style={{ gridTemplateColumns: "minmax(0, 1fr) 360px" }}>
      <div className="pg-main">
        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="eyebrow">// live-preview</div>
          {isRunning ? (
            <>
              <span className="chip solid" style={{ background: "#1b3a23", borderColor: "#2a8a3a", color: "#7fd494" }}>● läuft</span>
              <code style={{ fontSize: 11, color: "var(--ink-soft)" }}>{iframeUrl}</code>
              <button className="btn tiny" onClick={() => setIframeKey(k => k + 1)} disabled={busy}>↻ refresh</button>
              <button className="btn tiny danger" onClick={stop} disabled={busy}>stop</button>
            </>
          ) : detecting ? (
            <>
              <span className="chip" style={{ color: "var(--ink-faint)" }}>… erkenne projekt</span>
            </>
          ) : preview.command ? (
            <>
              <span className="chip" style={{ color: "var(--ink-faint)" }}>○ idle</span>
              <code style={{ fontSize: 11, color: "var(--ink-soft)" }}>{preview.command}</code>
              {preview.autoDetected && (
                <span style={{ fontSize: 10, color: "var(--ink-faint)" }}>· auto-erkannt</span>
              )}
              <button className="btn tiny primary" onClick={start} disabled={busy}>▶ start</button>
              <button className="btn tiny" onClick={() => setEditing(true)}>ändern</button>
            </>
          ) : (
            <>
              <span className="chip" style={{ color: "var(--ink-faint)" }}>○ kein dev-script gefunden</span>
              <button className="btn tiny" onClick={() => setEditing(true)}>manuell konfigurieren</button>
            </>
          )}
          {error && <span style={{ color: "#c33", fontSize: 12 }}>· {error}</span>}
        </div>

        {editing && (
          <div className="card" style={{ marginBottom: 12, padding: 12 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>preview-konfig</div>
            {suggestions.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "var(--ink-faint)", marginBottom: 4 }}>auto-erkannt:</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {suggestions.map((s, i) => (
                    <button key={i} className="btn tiny" onClick={() => applySuggestion(s)}>
                      {s.label} · :{s.port}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="field">
              <span className="eyebrow">command</span>
              <input className="input" value={cmd} onChange={e => setCmd(e.target.value)}
                     placeholder="npm run dev / flutter run -d chrome ..." />
            </label>
            <label className="field">
              <span className="eyebrow">port</span>
              <input className="input" type="number" value={port} onChange={e => setPort(e.target.value)}
                     placeholder="5173 / 3000 / 8090" style={{ maxWidth: 120 }} />
            </label>
            <label className="field">
              <span className="eyebrow">url override <span style={{ opacity: 0.5 }}>(optional)</span></span>
              <input className="input" value={urlOverride} onChange={e => setUrlOverride(e.target.value)}
                     placeholder="leer = http://localhost:<port>" />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button className="btn primary" onClick={saveConfig} disabled={!cmd.trim()}>speichern</button>
              <button className="btn" onClick={() => setEditing(false)}>abbrechen</button>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 10, lineHeight: 1.5 }}>
              tipp: preview spawnt dein dev-script lokal im project-pfad. nur owner darf das (security).
              shell-injection-zeichen (<code>; &amp; | ` $</code>) sind im command geblockt.
            </div>
          </div>
        )}

        <div style={{
          border: "1.5px solid var(--line)", borderRadius: 6,
          background: "#0a0a0c", height: "calc(100vh - 280px)", minHeight: 400,
          display: "flex", flexDirection: "column",
        }}>
          {isRunning && iframeUrl ? (
            <iframe key={iframeKey} src={iframeUrl}
                    style={{ flex: 1, width: "100%", border: 0, background: "#fff" }}
                    title="live preview" />
          ) : (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--ink-faint)", fontSize: 13, textAlign: "center", padding: 24,
            }}>
              {!preview.command
                ? 'noch kein dev-command konfiguriert · klick auf „config".'
                : "preview gestoppt · klick ▶ start"}
            </div>
          )}
        </div>
      </div>

      <aside className="pg-aside">
        <div className="pg-side-panel">
          <div className="eyebrow" style={{ marginBottom: 8 }}>dev-server log</div>
          <div style={{
            fontFamily: "monospace", fontSize: 10, lineHeight: 1.4,
            background: "#0a0a0c", padding: 8, borderRadius: 4,
            height: "calc(100vh - 320px)", minHeight: 360, overflow: "auto",
            color: "var(--ink-soft)",
          }}>
            {logs.length === 0 ? (
              <div style={{ color: "var(--ink-faint)" }}>keine logs · noch nicht gestartet</div>
            ) : logs.map((l, i) => (
              <div key={i} style={{ color: l.stream === "stderr" ? "#e7a06a" : "var(--ink-soft)", whiteSpace: "pre-wrap" }}>
                {l.text}
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

// ─── Screen: Sync ─────────────────────────────────────────────
function ScreenSync({ project, allSyncLog, lastFullSync, onSync, showToast }) {
  const log = allSyncLog.filter(e => e.projectId === project.id || !e.projectId).slice(0, 50);
  const sourceGlyph = (s) => ({ mobile: "📱→", desktop: "💻→", cloud: "☁", system: "!" }[s] || "·");

  const [sessions, setSessions] = useState([]);
  const [removing, setRemoving] = useState(null); // session-token to confirm
  const reload = useCallback(async () => {
    try {
      const r = await sync.listSessions();
      setSessions(r.sessions || []);
    } catch (e) {}
  }, []);

  useEffect(() => {
    let mounted = true;
    reload();
    const t = setInterval(() => { if (mounted) reload(); }, 5000);
    return () => { mounted = false; clearInterval(t); };
  }, [reload]);

  const removeDevice = async (token, name) => {
    try {
      await sync.removeSession(token);
      showToast?.(`gerät „${name}" entfernt`);
      reload();
    } catch (e) {
      showToast?.("⚠ " + e.message);
    }
    setRemoving(null);
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
        <div>
          <h2 className="h2">sync &amp; verlauf</h2>
          <div style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 4 }}>
            handy ↔ desktop ↔ cloud · letzter sync vor {relTime(lastFullSync)}
            {" · "}server: <code>{sync.serverUrl}</code>
            {" · "}<span className={"cc-dot" + (sync.connected ? " live" : "")}>{sync.connected ? "ws verbunden" : "ws getrennt"}</span>
          </div>
        </div>
        <button className="btn primary tiny" onClick={onSync}>jetzt synchronisieren</button>
      </div>

      <div className="devices" style={{ marginBottom: 14 }}>
        {sessions.length === 0 && (
          <div className="device" style={{ gridColumn: "span 3" }}>
            <div style={{ color: "var(--ink-faint)" }}>noch keine verbundenen geräte. nutze „+ handy verbinden" oben rechts.</div>
          </div>
        )}
        {sessions.map((s, i) => {
          const isLive = NOW() - s.lastSeen < 60000;
          return (
            <div key={i} className={"device" + (s.isMe ? " this" : "")}>
              <div className="device-head">
                <div className="icon">{s.deviceType === "mobile" ? "📱" : s.deviceType === "desktop" ? "💻" : "☁"}</div>
                {!s.isMe && s.token && (
                  <button className="x-btn device-x"
                          title="gerät entfernen"
                          onClick={() => setRemoving({ token: s.token, name: s.deviceName })}>×</button>
                )}
              </div>
              <div className="name">{s.deviceName}{s.isMe ? " · this" : ""}</div>
              <span className={"cc-dot" + (isLive ? " live" : "")}>
                {isLive ? "live" : relTime(s.lastSeen)}
              </span>
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-soft)" }}>
                seit {relTime(s.since)}
              </div>
            </div>
          );
        })}
      </div>

      {removing && (
        <Confirm title="gerät entfernen?"
                 message={`„${removing.name}" wird vom server getrennt und muss sich neu pairen.`}
                 confirmLabel="ja, entfernen" danger
                 onCancel={() => setRemoving(null)}
                 onConfirm={() => removeDevice(removing.token, removing.name)} />
      )}

      <div className="box">
        <div className="eyebrow">// änderungs-verlauf <span style={{ opacity: 0.5 }}>· {log.length}</span></div>
        {log.length === 0
          ? <div className="empty"><div>noch nichts protokolliert.</div></div>
          : log.map(row => (
              <div className="feed-row" key={row.id}>
                <span className="glyph">{sourceGlyph(row.source)}</span>
                <span dangerouslySetInnerHTML={{ __html: row.text }} />
                <span className="ts">{relTime(row.ts)}</span>
              </div>
            ))
        }
      </div>
    </>
  );
}

// ─── Modal: neues Projekt mit AI-Scaffold ─────────────────────
function NewProjectModal({ onClose, onCreate }) {
  const client = useSync();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [tech, setTech] = useState("flutter");
  const [path, setPath] = useState("");
  const [improving, setImproving] = useState(false);
  const [scaffolding, setScaffolding] = useState(false);
  const [err, setErr] = useState(null);
  const [scaffold, setScaffold] = useState(null); // { goals, rules, tasks, files }
  const [picks, setPicks] = useState({}); // index -> bool (per category)
  const nameRef = useRef(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const auth = () => ({ authorization: "Bearer " + client.token, "content-type": "application/json" });

  const aiImprove = async () => {
    if (!desc.trim()) return;
    setImproving(true); setErr(null);
    try {
      const r = await fetch(client.serverUrl + "/api/cc/scaffold", {
        method: "POST", headers: auth(),
        body: JSON.stringify({ mode: "improve", description: desc, name }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "fehler");
      setDesc(data.description || desc);
      if (data.techStack && data.techStack !== "other") setTech(data.techStack);
    } catch (e) { setErr(e.message); }
    finally { setImproving(false); }
  };

  const aiScaffold = async () => {
    if (!desc.trim() || !name.trim()) return;
    setScaffolding(true); setErr(null);
    try {
      const r = await fetch(client.serverUrl + "/api/cc/scaffold", {
        method: "POST", headers: auth(),
        body: JSON.stringify({ mode: "scaffold", description: desc, name }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "fehler");
      setScaffold(data);
      // Alle items als selected per default
      const ps = {};
      ["goals", "rules", "tasks", "files"].forEach((k) => {
        (data[k] || []).forEach((_, i) => { ps[`${k}-${i}`] = true; });
      });
      setPicks(ps);
    } catch (e) { setErr(e.message); }
    finally { setScaffolding(false); }
  };

  const createWithScaffold = () => {
    if (!name.trim()) return;
    const project = {
      name: name.trim(), description: desc.trim(),
      tech, path: path.trim(),
      starred: false, lastSync: NOW(),
      goals: [], files: [], tasks: [], rules: [], ideas: [], activity: [],
    };
    if (scaffold) {
      project.goals = (scaffold.goals || []).filter((_, i) => picks[`goals-${i}`] !== false);
      project.rules = (scaffold.rules || []).filter((_, i) => picks[`rules-${i}`] !== false)
        .map((r) => ({ category: r.category, text: r.text, active: true }));
      project.tasks = (scaffold.tasks || []).filter((_, i) => picks[`tasks-${i}`] !== false)
        .map((t) => ({ title: t.title, group: t.group, meta: t.meta, priority: t.priority, done: false, subtasks: [] }));
      project.files = (scaffold.files || []).filter((_, i) => picks[`files-${i}`] !== false);
    }
    onCreate(project);
  };

  // Wenn scaffold da: preview-state. Sonst: input-state.
  if (scaffold) {
    const cats = [
      { key: "goals", label: "ziele", items: scaffold.goals || [], render: (g) => g },
      { key: "rules", label: "regeln", items: scaffold.rules || [], render: (r) => `[${r.category}] ${r.text}` },
      { key: "tasks", label: "tasks", items: scaffold.tasks || [], render: (t) => `${"★".repeat(t.priority)} ${t.title} (${t.meta})` },
      { key: "files", label: "dateien", items: scaffold.files || [], render: (f) => `${"  ".repeat(f.depth)}${f.name}` },
    ];
    return (
      <div className="modal-bg" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
          <div className="modal-head">
            <div>
              <div className="eyebrow">// claude hat einen plan</div>
              <h2 className="h2">{name}</h2>
            </div>
            <button className="btn tiny" onClick={() => setScaffold(null)}>← zurück</button>
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 10, lineHeight: 1.5 }}>
            haken-weg = wird nicht angelegt. du kannst alles nachher editieren.
          </div>
          <div style={{ overflowY: "auto", flex: 1, marginBottom: 10 }}>
            {cats.map((cat) => (
              <div key={cat.key} className="box" style={{ marginBottom: 10 }}>
                <div className="eyebrow">// {cat.label} <span style={{ opacity: 0.5 }}>· {cat.items.length}</span></div>
                {cat.items.length === 0 && <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>—</div>}
                {cat.items.map((it, i) => {
                  const k = `${cat.key}-${i}`;
                  return (
                    <label key={k} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "4px 0", cursor: "pointer", fontSize: 12.5 }}>
                      <input type="checkbox" checked={picks[k] !== false}
                        onChange={(e) => setPicks((p) => ({ ...p, [k]: e.target.checked }))} />
                      <span style={{ flex: 1, fontFamily: cat.key === "files" ? "monospace" : "inherit" }}>
                        {cat.render(it)}
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="footer">
            <button className="btn" onClick={onClose}>abbrechen</button>
            <button className="btn" onClick={() => setScaffold(null)}>← zurück zur idee</button>
            <button className="btn primary" onClick={createWithScaffold}>projekt anlegen →</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">// neues projekt</div>
            <h2 className="h2">design mit claude</h2>
          </div>
          <button className="btn tiny" onClick={onClose}>×</button>
        </div>
        <label className="field">
          <span className="eyebrow">projektname</span>
          <input ref={nameRef} className="input big" placeholder="z.B. wave-fx"
                 value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="eyebrow">idee · beschreibe was du bauen willst</span>
          <textarea className="input" placeholder="z.B. Website mit login + chat + preise. Stack: nextjs + supabase."
                    rows={6}
                    value={desc} onChange={(e) => setDesc(e.target.value)} />
          <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
            <button className="btn tiny" onClick={aiImprove} disabled={improving || !desc.trim()}>
              {improving ? "✨ claude verbessert…" : "✨ claude verbessert die idee"}
            </button>
            <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>
              optional · macht das briefing präziser bevor der scaffold läuft
            </span>
          </div>
        </label>
        <label className="field">
          <span className="eyebrow">tech-stack</span>
          <select className="input" value={tech} onChange={(e) => setTech(e.target.value)}>
            {TECH_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="eyebrow">lokaler pfad <span style={{ opacity: 0.5 }}>(optional)</span></span>
          <input className="input" placeholder="z.B. C:\Users\du\projekte\mein-projekt"
                 value={path} onChange={(e) => setPath(e.target.value)} />
          <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 4, lineHeight: 1.4 }}>
            tipp: im explorer <strong>shift+rechtsklick</strong> → „als pfad kopieren".
          </div>
        </label>
        {err && (
          <div style={{ padding: 8, marginTop: 8, border: "1.5px solid #c33", borderRadius: 6, color: "#c33", fontSize: 12 }}>{err}</div>
        )}
        <div className="footer">
          <button className="btn" onClick={onClose}>abbrechen</button>
          <button className="btn" onClick={() => onCreate({
            name: name.trim(), description: desc.trim(), tech, path: path.trim(),
            starred: false, lastSync: NOW(),
            goals: [], files: [], tasks: [], rules: [], ideas: [], activity: [],
          })} disabled={!name.trim()}>leer anlegen</button>
          <button className="btn primary"
                  onClick={aiScaffold}
                  disabled={scaffolding || !name.trim() || !desc.trim()}>
            {scaffolding ? "✨ claude designt…" : "mit claude designen →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────
function App() {
  const client = useSync();
  const [, setTick] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [showPair, setShowPair] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile hamburger
  const [showAuth, setShowAuth] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProjSettings, setShowProjSettings] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [toast, setToast] = useState(null);

  // 30s-Tick für relative Zeiten
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Beim Boot: wenn Token vorhanden → connect, sonst → BootPairing zeigen
  useEffect(() => {
    if (client.hasSession && !client.connected) client.connect();
  }, [client]);

  // Erstkontakt: noch keine Session → Boot-Pairing
  if (!client.hasSession) {
    return <BootPairing onReady={() => setTick(x => x + 1)} />;
  }
  // State noch nicht geladen?
  if (!client.state) {
    return (
      <div className="boot">
        <div className="boot-card">
          <div className="eyebrow">// projectgamma</div>
          <h1 className="h1">verbindung wird aufgebaut…</h1>
          <div style={{ color: "var(--ink-soft)", marginTop: 12 }}>
            <span className={"cc-dot" + (client.connected ? " live" : "")}>
              {client.connected ? "verbunden, lade state…" : "verbinde mit " + client.serverUrl}
            </span>
            {client.lastError && <div style={{ color: "#c33", marginTop: 8 }}>⚠ {client.lastError}</div>}
          </div>
          <div className="footer" style={{ marginTop: 18 }}>
            <button className="btn" onClick={() => { client.logout(); setTick(x => x + 1); }}>session zurücksetzen</button>
          </div>
        </div>
      </div>
    );
  }

  const project = client.activeProject;
  const projects = client.projects;

  const showToast = (text) => {
    setToast(text);
    setTimeout(() => setToast(null), 2400);
  };

  const headerAction = (a) => {
    if (a === "syncNow") {
      client.mutate("DO_SYNC");
      client.mutate("ADD_SYNC_LOG", { entry: { source: "system", projectId: project.id, text: "manueller sync — alle geräte aktualisiert" }});
      showToast("synchronisiert");
    }
    if (a === "openIDE") {
      if (!project.path) { showToast("kein lokaler pfad gesetzt — bitte oben pflegen"); return; }
      // URL-encode damit pfade mit leerzeichen/sonderzeichen (z.B. "C:/My Projects/foo")
      // korrekt an vscode übergeben werden statt zu brechen.
      const normalized = project.path.replace(/\\/g, "/");
      window.location.href = "vscode://file/" + encodeURI(normalized);
      showToast("öffne in vscode…");
    }
    if (a === "share") {
      const data = JSON.stringify({ exportedAt: new Date().toISOString(), project }, null, 2);
      navigator.clipboard?.writeText(data).then(
        () => showToast(`export (${Math.round(data.length / 1024)} kB) in zwischenablage`),
        () => {
          const blob = new Blob([data], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url;
          a.download = project.name.replace(/[^a-z0-9-_]+/gi, "_") + ".json";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          showToast("export heruntergeladen");
        }
      );
    }
    if (a === "pairMobile") setShowPair(true);
    if (a === "openAuth") setShowAuth(true);
    if (a === "openMembers") setShowMembers(true);
    if (a === "openSettings") setShowSettings(true);
    if (a === "openProjectSettings") setShowProjSettings(true);
  };

  const createProject = (p) => {
    client.mutate("ADD_PROJECT", { project: p });
    setShowNew(false);
    showToast(`projekt „${p.name}“ angelegt`);
  };

  const deleteProject = (pid) => {
    const p = projects.find(x => x.id === pid);
    client.mutate("REMOVE_PROJECT", { projectId: pid });
    if (client.activeProjectId === pid) {
      const next = projects.find(x => x.id !== pid);
      if (next) client.setActiveProject(next.id);
    }
    setConfirmDelete(null);
    if (p) showToast(`projekt „${p.name}“ gelöscht`);
  };

  const onCcRun = async (arg) => {
    const taskIdOrOpts = arg;
    const opts = (typeof taskIdOrOpts === "object" && taskIdOrOpts !== null)
      ? taskIdOrOpts
      : { taskId: taskIdOrOpts, prompt: null };
    try {
      await client.ccRun({ projectId: project.id, taskId: opts.taskId, prompt: opts.prompt });
      showToast("cloud-code gestartet");
      client.setActiveTab("cloud");
    } catch (e) {
      showToast("⚠ " + e.message);
    }
  };
  const onCcStop = async () => {
    try { await client.ccStop(project.id); showToast("cloud-code abgebrochen"); }
    catch (e) { showToast("⚠ " + e.message); }
  };

  return (
    <div className="app">
      {/* Setup-check banner: zeigt fehlende deps für first-user — verschwindet automatisch wenn alle critical-deps da */}
      {window.SetupBanner && <window.SetupBanner serverUrl={client.serverUrl} />}
      <div className="titlebar">
        <span className="dot" /><span className="dot" /><span className="dot" />
        {/* D1 · Hamburger-toggle sichtbar nur auf <768px (CSS class .mobile-only) */}
        <button className="hamburger-toggle"
                onClick={() => setSidebarOpen(o => !o)}
                aria-label="menu" title="projekt-liste">
          ☰
        </button>
        <span className="crumb"><span className="brand-anim">ProjectGamma</span> · {project?.name || "—"} · {TABS.find(t => t.id === client.activeTab)?.label || ""}</span>
        <div className="right">
          <span className={"cc-dot" + (client.connected ? " live" : "")}>
            {client.connected ? `server · ${client.serverUrl.replace(/^https?:\/\//, "")}` : "server getrennt"}
          </span>
          <UpdateAvailableBanner state={client.state} />
          <ThemeToggle />
          {window.OfflineQueuePanel ? <window.OfflineQueuePanel client={client} /> : null}
        </div>
      </div>

      <div className="body">
        <div className={"side-wrapper" + (sidebarOpen ? " open-mobile" : "")}>
          <Sidebar projects={projects}
                 activeId={client.activeProjectId}
                 onSelect={(id) => { client.setActiveProject(id); client.setActiveTab("overview"); setSidebarOpen(false); }}
                 onNew={() => { setShowNew(true); setSidebarOpen(false); }}
                 ccRunning={client.ccRunning} />
        </div>
        {!project && (() => {
          // Welcome-state differenziert nach kontext:
          // - Account-eingeloggter user mit zero projekten → wartet auf invite
          //   (collab-fall: kollege auf team-server, owner muss einladen).
          // - Sonst → erstes-projekt-anlegen CTA (eigener server).
          const myEmail = (client.deviceName && /@/.test(client.deviceName)) ? client.deviceName : null;
          const isInviteeWaiting = myEmail && projects.length === 0;
          return (
          <div className="main" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <div style={{ maxWidth: 480, textAlign: "center" }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>// willkommen</div>
              <h1 className="h1" style={{ marginBottom: 12 }}>★ ProjectGamma</h1>
              {isInviteeWaiting ? (
                <>
                  <p style={{ color: "var(--ink-soft)", lineHeight: 1.5, marginBottom: 14 }}>
                    eingeloggt als <strong>{myEmail}</strong>.
                    <br />du bist auf einem team-server — der owner muss dich noch zu projekten einladen.
                  </p>
                  <div style={{
                    background: "var(--paper-soft, #f5f1e8)",
                    border: "1.5px solid var(--ink-faint, #ccc)",
                    borderRadius: 8, padding: 14, marginBottom: 16,
                    fontSize: 13, lineHeight: 1.6, textAlign: "left",
                  }}>
                    <strong>so geht's:</strong>
                    <ol style={{ margin: "8px 0 0 18px", padding: 0 }}>
                      <li>schick dem owner deine email: <code style={{ background: "#0001", padding: "2px 6px", borderRadius: 4 }}>{myEmail}</code></li>
                      <li>der owner klickt „👥 mitglieder verwalten" → „+ mitglied einladen"</li>
                      <li>sobald du eingeladen bist, erscheint sein projekt hier automatisch</li>
                    </ol>
                  </div>
                  <button className="btn tiny"
                          onClick={() => { navigator.clipboard?.writeText(myEmail); }}
                          title="email in zwischenablage kopieren">
                    📋 email kopieren
                  </button>
                </>
              ) : (
                <>
                  <p style={{ color: "var(--ink-soft)", lineHeight: 1.5, marginBottom: 24 }}>
                    Projekt-Manager mit Cloud-Code-Integration. Lege dein erstes Projekt an —
                    Aufgaben, Ideen + Regeln auf desktop und handy synchron.
                  </p>
                  <button className="btn primary" onClick={() => setShowNew(true)}
                          style={{ fontSize: 14, padding: "10px 20px" }}>
                    + erstes projekt anlegen
                  </button>
                  <div style={{ marginTop: 24, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                    <button className="btn tiny" onClick={() => setShowAuth(true)}>🔐 login / registrieren</button>
                    <button className="btn tiny" onClick={() => setShowSettings(true)}>⚙ settings (API-keys)</button>
                  </div>
                </>
              )}
            </div>
          </div>
          );
        })()}
        {project && (
          <div className="main">
            <MainHead project={project}
                      activeTab={client.activeTab}
                      onTab={(id) => client.setActiveTab(id)}
                      onAction={headerAction}
                      onDelete={() => setConfirmDelete(project.id)} />
            <div className="main-body" data-tab={client.activeTab}>
              {client.activeTab === "overview" && (
                <ScreenOverview project={project}
                                onOpenMembers={() => setShowMembers(true)}
                                onOpenPair={() => setShowPair(true)}
                                onSetTab={(id) => client.setActiveTab(id)} />
              )}
              {client.activeTab === "tasks" && <ScreenTasks project={project} onCcRun={(taskId) => onCcRun({ taskId })} />}
              {client.activeTab === "rules" && <ScreenRules project={project} />}
              {client.activeTab === "ideas" && <ScreenIdeas project={project} />}
              {client.activeTab === "team" && window.TeamPanel && (
                <window.TeamPanel project={project} sync={client} myEmail={client.deviceName} />
              )}
              {client.activeTab === "cloud" && (
                <ScreenCloud project={project}
                             onCcRun={onCcRun}
                             onCcStop={onCcStop}
                             ccStatus={client.ccStatus}
                             ccOutput={client.ccOutput}
                             ccRunning={client.ccRunning}
                             setCcRunning={(v) => client.mutate("TOGGLE_CC", { running: v })} />
              )}
              {client.activeTab === "preview" && <ScreenPreview project={project} />}
              {client.activeTab === "sync" && (
                <ScreenSync project={project}
                            allSyncLog={client.syncLog}
                            lastFullSync={client.lastFullSync}
                            onSync={() => headerAction("syncNow")}
                            showToast={showToast} />
              )}
            </div>
          </div>
        )}
      </div>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} onCreate={createProject} />}
      {showPair && <PairCodeModal onClose={() => setShowPair(false)} />}
      {showAuth && window.AccountAuthModal && <window.AccountAuthModal onClose={() => setShowAuth(false)} />}
      {showMembers && project && window.MembersModal && <window.MembersModal projectId={project.id} onClose={() => setShowMembers(false)} />}
      {showSettings && window.SettingsModal && <window.SettingsModal onClose={() => setShowSettings(false)} />}
      {showProjSettings && project && window.ProjectSettingsModal && (
        <window.ProjectSettingsModal project={project} onClose={() => setShowProjSettings(false)} />
      )}
      {confirmDelete && (
        <Confirm title="projekt löschen?"
                 message={`„${projects.find(p => p.id === confirmDelete)?.name || "?"}“ wird unwiderruflich gelöscht — alle aufgaben, regeln, ideen.`}
                 confirmLabel="ja, löschen" danger
                 onCancel={() => setConfirmDelete(null)}
                 onConfirm={() => deleteProject(confirmDelete)} />
      )}
      {toast && <div className="toast">{toast}</div>}
      {typeof window.UndoSnackbar === "function" && <window.UndoSnackbar />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
