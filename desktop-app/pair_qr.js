// QR-Pairing-Helper für desktop-app.
// `buildPairQrPayload` ist pure und unter node:test prüfbar.
// `toQrSvg` ist nur im browser nutzbar (greift auf das globale `qrcode`
// von `qrcode-generator`@1.4.4 zu, das via CDN in index.html geladen wird).
//
// Dual-Module: in CommonJS (node-tests) wird nur `buildPairQrPayload` exportiert.
// Im browser wird das ganze modul als `window.pair_qr` registriert.

(function () {
  "use strict";

  /**
   * Baut den QR-Payload-String für das Pairing.
   * Schema: pgamma://pair?host=<host>&port=<port>&code=<code>&pub=<publicIp>
   * - host = LAN-IP (schneller path im gleichen netz)
   * - pub  = optionale public-IP (internet-fallback wenn LAN nicht klappt)
   * Mobile-app parst host/port/code/pub und probiert beide URLs.
   * @param {{host:string, port:string|number, code:string, publicIp?:string}} args
   * @returns {string}
   */
  function buildPairQrPayload(args) {
    const host = String((args && args.host) || "").trim();
    if (!host) throw new Error("host fehlt");
    const portRaw = args && args.port;
    const portNum = typeof portRaw === "number" ? portRaw : parseInt(String(portRaw), 10);
    if (!Number.isInteger(portNum) || portNum <= 0) throw new Error("port ungültig");
    const code = String((args && args.code) || "").trim();
    if (!code) throw new Error("code fehlt");
    const h = encodeURIComponent(host);
    const c = encodeURIComponent(code);
    const pub = String((args && args.publicIp) || "").trim();
    const pubQ = pub ? "&pub=" + encodeURIComponent(pub) : "";
    // Bugfix (audit): alle alternativen LAN-IPs als hosts-liste mitgeben,
    // mobile probiert sie wenn der primary-host nicht erreichbar ist.
    // Verhindert „QR zeigt auf VPN-adapter-IP, phone kann's nicht erreichen".
    const alt = Array.isArray(args && args.hosts) ? args.hosts.filter(x => x && x !== host) : [];
    const altQ = alt.length ? "&hosts=" + encodeURIComponent(alt.join(",")) : "";
    return `pgamma://pair?host=${h}&port=${portNum}&code=${c}${pubQ}${altQ}`;
  }

  /**
   * Rendert einen QR-Code als SVG-String. Erwartet das globale `qrcode`
   * (qrcode-generator UMD lib). Liefert `null` wenn die Lib fehlt — der caller
   * zeigt dann einen sichtbaren fallback statt stillem skip.
   * @param {string} text
   * @param {{cellSize?:number, margin?:number}} [opts]
   * @returns {string|null}
   */
  function toQrSvg(text, opts) {
    const g = (typeof globalThis !== "undefined" ? globalThis : null);
    const qrFactory = g && g.qrcode;
    if (typeof qrFactory !== "function") {
      // Sichtbar warnen statt silent-skip (regel: silent-skip-pattern vermeiden).
      if (g && g.console) g.console.warn("[pair_qr] qrcode-generator lib nicht verfügbar");
      return null;
    }
    const typeNumber = 0; // auto
    const errorCorrection = "M";
    const cellSize = (opts && opts.cellSize) || 4;
    const margin = (opts && opts.margin) || 4;
    try {
      const q = qrFactory(typeNumber, errorCorrection);
      q.addData(String(text));
      q.make();
      return q.createSvgTag({ cellSize, margin, scalable: true });
    } catch (e) {
      if (g && g.console) g.console.warn("[pair_qr] QR-rendering fehlgeschlagen:", e && e.message);
      return null;
    }
  }

  const api = { buildPairQrPayload, toQrSvg };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.pair_qr = api;
  }
})();
