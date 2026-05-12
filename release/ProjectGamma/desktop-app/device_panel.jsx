// Pro-Projekt Geräte-Panel — listet alle verbundenen geräte mit
// live-status (online/abwesend/offline), letzter projekt-aktivität und
// revoke-button (nur desktop-self, nicht für eigene session).
//
// Modul nutzt window.DeviceViewHelpers und sync.* (globals). Datenquelle:
// GET /api/projects/:id/devices — wird beim mount + nach STATE-pushes neu
// gezogen. Zwischenzeitlich rechnet refreshStatuses(client-tick) den
// status lokal um, damit "online"-anzeigen nicht stehen bleiben.
//
// Inline-styles statt styles.css-erweiterung (regel respektiert).
(function () {
  const { useEffect, useState, useMemo } = React;
  const H = window.DeviceViewHelpers;

  function DevicePanel({ project, me, apiBase, token }) {
    const [devices, setDevices] = useState([]);
    const [error, setError] = useState(null);
    const [now, setNow] = useState(Date.now());

    async function load() {
      if (!project || !apiBase) return;
      try {
        const r = await fetch(apiBase + "/api/projects/" + project.id + "/devices", {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok) throw new Error("http " + r.status);
        const data = await r.json();
        setDevices(data.devices || []);
        setError(null);
      } catch (e) { setError(e.message); }
    }

    useEffect(() => { load(); }, [project && project.id]);

    // Re-fetch bei state-push (lastSeen ändert sich serverseitig).
    useEffect(() => {
      const s = window.__sync;
      const off = s && typeof s.subscribe === "function" ? s.subscribe(load) : null;
      return () => { if (typeof off === "function") off(); };
    }, [project && project.id]);

    // Lokaler tick, damit "online → abwesend" ohne server-roundtrip sichtbar wird.
    useEffect(() => {
      const id = setInterval(() => setNow(Date.now()), 15_000);
      return () => clearInterval(id);
    }, []);

    const view = useMemo(() => H.refreshStatuses(devices, now), [devices, now]);

    async function revoke(d) {
      if (!H.canRevoke(d, me)) return;
      if (!confirm("gerät '" + d.deviceName + "' wirklich trennen?")) return;
      const r = await fetch(apiBase + "/api/sessions/" + d.token, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });
      if (r.ok) load();
    }

    if (!project) return null;
    return (
      <div className="box" style={{ marginBottom: 12 }}>
        <div className="eyebrow">// geräte · {view.length} verbunden</div>
        {error && <div style={{ color: "#a00", fontSize: 12 }}>fehler: {error}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
          {view.map((d) => (
            <div key={(d.token || d.deviceName) + ":" + d.since}
                 style={{ display: "flex", gap: 8, alignItems: "center",
                          padding: "6px 0", borderBottom: "1px dashed rgba(0,0,0,.15)" }}>
              <span aria-label={H.statusLabel(d.status)}
                    style={{ width: 8, height: 8, borderRadius: "50%",
                             background: d.status === "online" ? "#2a8" :
                                         d.status === "away" ? "#c90" : "#aaa" }} />
              <span style={{ flex: 1 }}>
                <b>{d.deviceName}</b>{" "}
                <span style={{ opacity: .6, fontSize: 12 }}>
                  ({d.deviceType}{d.isMe ? " · dieses gerät" : ""})
                </span>
              </span>
              <span style={{ fontSize: 12, opacity: .7 }}>
                {H.statusLabel(d.status)} · {H.formatRelative(d.lastSeen, now)}
              </span>
              {d.lastActivityInProjectAt && (
                <span style={{ fontSize: 11, opacity: .6 }}>
                  zuletzt aktiv: {H.formatRelative(d.lastActivityInProjectAt, now)}
                </span>
              )}
              {H.canRevoke(d, me) && (
                <button onClick={() => revoke(d)}
                        style={{ fontSize: 11, padding: "2px 8px" }}
                        title="gerät trennen">
                  trennen
                </button>
              )}
            </div>
          ))}
          {!view.length && !error && (
            <div style={{ fontSize: 12, opacity: .6 }}>keine geräte gefunden.</div>
          )}
        </div>
      </div>
    );
  }

  window.DevicePanel = DevicePanel;
})();
