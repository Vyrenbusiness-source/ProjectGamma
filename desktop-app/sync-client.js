/* ProjectGamma · Desktop · SyncClient
   HTTP-API + WebSocket gegen Sync-Server (default localhost:7892).
   Persistiert Token in localStorage. Listener bekommen jedes neue STATE-Frame. */

// Default-URL: bevorzugt same-origin (wenn die desktop-app vom sync-server
// selbst gehostet wird), sonst localhost:7892 (separate dev-server).
// Same-origin macht das setup auch auf anderen rechnern/IPs ohne änderung
// brauchbar — und vermeidet CORS-issues.
function _defaultSyncUrl() {
  try {
    if (typeof window !== "undefined" && window.location && window.location.origin
        && window.location.protocol.startsWith("http")) {
      const o = window.location.origin;
      // localhost:7891 → der alte split-mode → fallback zu :7892
      if (/:7891$/.test(o)) return "http://localhost:7892";
      return o;
    }
  } catch (_) {}
  return "http://localhost:7892";
}
const SYNC_DEFAULT_URL = _defaultSyncUrl();
const SYNC_LS_TOKEN     = "projectgamma.sync.token";
const SYNC_LS_URL       = "projectgamma.sync.url";
const SYNC_LS_DEVICE    = "projectgamma.sync.deviceName";
const SYNC_LS_ACTIVE    = "projectgamma.sync.activeProjectId";
const SYNC_LS_TAB       = "projectgamma.sync.activeTab";
const SYNC_LS_QUEUE     = "projectgamma.sync.offlineQueue";

class SyncClient {
  constructor() {
    this.serverUrl   = localStorage.getItem(SYNC_LS_URL) || SYNC_DEFAULT_URL;
    this.token       = localStorage.getItem(SYNC_LS_TOKEN);
    this.deviceName  = localStorage.getItem(SYNC_LS_DEVICE) || "desktop";
    this.activeProjectId = localStorage.getItem(SYNC_LS_ACTIVE) || null;
    this.activeTab   = localStorage.getItem(SYNC_LS_TAB) || "overview";
    this.state       = null;
    this.connected   = false;
    this.lastError   = null;
    this.ws          = null;
    this.listeners   = new Set();
    this.ccStatus    = {}; // projectId -> { state, ... }
    this.ccOutput    = {}; // projectId -> string (last cc output)
    this._reconnectAttempt = 0;
    this._heartbeat  = null;
    this._reconnectTimer = null;
    this._pairing    = null; // {code, expiresAt} bei aktivem Pair-Init
    this.offlineQueue = (typeof window !== "undefined" && window.createOfflineQueue)
      ? window.createOfflineQueue({ max: 100 })
      : null;
    this._loadOfflineQueue();
  }

  _loadOfflineQueue() {
    if (!this.offlineQueue) return;
    try {
      const raw = localStorage.getItem(SYNC_LS_QUEUE);
      if (raw) this.offlineQueue.fromJson(JSON.parse(raw));
    } catch (e) { /* ignore corrupt queue */ }
  }

  _saveOfflineQueue() {
    if (!this.offlineQueue) return;
    try { localStorage.setItem(SYNC_LS_QUEUE, JSON.stringify(this.offlineQueue.toJson())); }
    catch (e) {}
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn(this); }

  get hasSession() { return !!this.token; }

  async _http(method, path, body) {
    const headers = { "content-type": "application/json" };
    if (this.token) headers.authorization = "Bearer " + this.token;
    const res = await fetch(this.serverUrl + path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error(data.error || ("http " + res.status));
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  /// Desktop-Self-Init (lokal, ohne Code) — bekommt Token zurück.
  async selfInit() {
    const data = await this._http("POST", "/api/pair/desktop-init", { deviceName: this.deviceName });
    this.token = data.token;
    localStorage.setItem(SYNC_LS_TOKEN, this.token);
    localStorage.setItem(SYNC_LS_URL, this.serverUrl);
    localStorage.setItem(SYNC_LS_DEVICE, this.deviceName);
    this._emit();
    return data;
  }

  /// Account-Login (multi-user schicht 1+2). Liefert user-token, das
  /// server-seitig per memberships gefiltert wird (sieht nur projekte mit rolle).
  async loginWithAccount({ email, password }) {
    const data = await this._http("POST", "/api/auth/login", { email, password });
    this._adoptUserToken(data, email);
    return data;
  }

  /// Account-Register + auto-login. Erster registrierter user wird OWNER
  /// aller bestehenden projekte (server-seitiger bootstrap).
  async registerAccount({ email, password }) {
    const data = await this._http("POST", "/api/auth/register", { email, password });
    this._adoptUserToken(data, email);
    return data;
  }

  /// /api/auth/me — liefert current user wenn user-token aktiv ist.
  /// Bei pair-token: 401 → null. Wird vom UI für „eingeloggt als …" genutzt.
  async getMe() {
    try {
      return await this._http("GET", "/api/auth/me");
    } catch (e) {
      if (e.status === 401 || e.status === 503) return null;
      throw e;
    }
  }

  _adoptUserToken(data, email) {
    this.token = data.token;
    this.deviceName = email; // synthetic device-name = email
    localStorage.setItem(SYNC_LS_TOKEN, this.token);
    localStorage.setItem(SYNC_LS_URL, this.serverUrl);
    localStorage.setItem(SYNC_LS_DEVICE, this.deviceName);
    this._emit();
  }

  /// Generiert einen 6-stelligen Pairing-Code für Mobile-Verbindung.
  async genPairingCode() {
    const data = await this._http("POST", "/api/pair/init", { deviceName: this.deviceName });
    this._pairing = { code: data.code, expiresAt: data.expiresAt };
    this._emit();
    return this._pairing;
  }

  /// Verbindet WebSocket. Empfängt STATE/CC_STATUS/CC_OUTPUT/PONG.
  connect() {
    if (!this.token) return;
    this.disconnect();
    const wsUrl = this.serverUrl.replace(/^http/, "ws") + "/ws?token=" + this.token;
    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        this._reconnectAttempt = 0;
        this.lastError = null;
        this._heartbeat?.stop();
        this._heartbeat = (window.createHeartbeatMonitor && window.createHeartbeatMonitor({
          pingInterval: 25000,
          pongTimeout: 10000,
          onPing: () => this._send({ type: "PING" }),
          onTimeout: () => { try { this.ws?.close(); } catch (e) {} },
        })) || null;
        this._heartbeat?.start();
        this._emit();
        // Reconnect: pending dispatches als optimistisches UI nachfahren.
        this._drainOfflineQueue();
      };
      ws.onmessage = (evt) => this._onMessage(evt.data);
      ws.onerror = () => { this.lastError = "websocket-fehler"; };
      ws.onclose = () => this._onClose();
    } catch (e) {
      this.lastError = "verbindung fehlgeschlagen: " + e.message;
      this._scheduleReconnect();
      this._emit();
    }
  }

  disconnect() {
    this._heartbeat?.stop(); this._heartbeat = null;
    clearTimeout(this._reconnectTimer); this._reconnectTimer = null;
    try { this.ws?.close(); } catch (e) {}
    this.ws = null;
    this.connected = false;
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    switch (msg.type) {
      case "STATE":
        this.state = msg.state;
        if (!this.activeProjectId && this.state.projects?.length) {
          this.activeProjectId = this.state.projects[0].id;
          localStorage.setItem(SYNC_LS_ACTIVE, this.activeProjectId);
        }
        this._emit();
        break;
      case "CC_STATUS":
        this.ccStatus[msg.projectId] = msg.status;
        if (typeof msg.output === "string") this.ccOutput[msg.projectId] = msg.output;
        this._emit();
        break;
      case "CC_OUTPUT":
        this.ccOutput[msg.projectId] = (this.ccOutput[msg.projectId] || "") + (msg.chunk || "");
        this._emit();
        break;
      case "ERROR":
        this.lastError = msg.error;
        this._emit();
        break;
      case "PUSH_NOTIFICATION":
        if (msg.notification) {
          if (!this.notifications && typeof window !== "undefined" && window.createNotificationsInbox) {
            this.notifications = window.createNotificationsInbox({ max: 50 });
          }
          if (this.notifications && this.notifications.push(msg.notification)) this._emit();
        }
        break;
      case "PONG": this._heartbeat?.notePong(); break;
    }
  }

  _onClose() {
    this.connected = false;
    this.ws = null;
    this._heartbeat?.stop(); this._heartbeat = null;
    this._scheduleReconnect();
    this._emit();
  }

  _scheduleReconnect() {
    if (!this.token) return;
    this._reconnectAttempt++;
    const calc = (typeof window !== "undefined" && window.computeBackoff)
      ? window.computeBackoff
      : (n) => Math.min(30000, 1000 * Math.pow(1.6, n - 1));
    const delay = calc(this._reconnectAttempt, { base: 1000, factor: 1.6, max: 30000, jitter: 0.2 });
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  _send(obj) {
    try { this.ws?.send(JSON.stringify(obj)); } catch (e) {}
  }

  /// Mutation. Bevorzugt WS, fällt zurück auf offline-queue + HTTP.
  /// Bei !connected ODER ws.readyState != OPEN(1) wird das mut in die offline-queue
  /// gespiegelt — verhindert silent-drop wenn der WS gerade closing/connecting ist
  /// während `connected` noch stale auf true steht.
  /// Fire-and-forget: kein await für server-ack; UI rendert optimistisch und
  /// drainAndSend schickt die queue nach reconnect.
  async mutate(type, payload = {}) {
    const mut = { type, payload };
    const wsReady = this.ws && this.ws.readyState === 1;
    if (this.connected && wsReady) {
      this._send({ type: "MUT", mutation: mut });
      return;
    }
    if (this.offlineQueue) {
      this.offlineQueue.enqueue(type, payload);
      this._saveOfflineQueue();
      this._emit();
    }
  }

  /// Pending-Queue an Server senden (Reconnect-Flow). Pure-Logik in
  /// drainAndSend ausgelagert, damit ohne DOM testbar.
  async _drainOfflineQueue() {
    if (!this.offlineQueue || !window.drainAndSend) return;
    if (!this.offlineQueue.pending().length) return;
    await window.drainAndSend({
      queue: this.offlineQueue,
      sender: (item) => {
        if (this.connected && this.ws && this.ws.readyState === 1) {
          this._send({ type: "MUT", mutation: { type: item.type, payload: item.payload } });
          return true;
        }
        return false;
      },
    });
    this._saveOfflineQueue();
    this._emit();
  }

  /// UI-trigger: einzelnes failed-item erneut versuchen.
  async retryQueueItem(id) {
    if (!this.offlineQueue) return;
    this.offlineQueue.retry(id);
    this._saveOfflineQueue();
    this._emit();
    if (this.connected) await this._drainOfflineQueue();
  }

  /// UI-trigger: item verwerfen.
  dropQueueItem(id) {
    if (!this.offlineQueue) return;
    this.offlineQueue.drop(id);
    this._saveOfflineQueue();
    this._emit();
  }

  /// Cloud-Code starten.
  async ccRun({ projectId, taskId, prompt }) {
    return this._http("POST", "/api/cc/run", { projectId, taskId, prompt });
  }
  async ccStop(projectId) {
    return this._http("POST", "/api/cc/stop", { projectId });
  }
  async ccSuggest(projectId) {
    return this._http("POST", "/api/cc/suggest", { projectId });
  }
  async ccBughunt(projectId) {
    return this._http("POST", "/api/cc/bughunt", { projectId });
  }
  async listSessions() {
    return this._http("GET", "/api/sessions");
  }
  async removeSession(token) {
    return this._http("DELETE", "/api/sessions/" + encodeURIComponent(token));
  }

  setActiveProject(id) {
    this.activeProjectId = id;
    // Null-guard: ohne den check landet beim löschen des letzten projekts der
    // string "null" im localStorage und beim nächsten boot ist activeId truthy.
    if (id) localStorage.setItem(SYNC_LS_ACTIVE, id);
    else    localStorage.removeItem(SYNC_LS_ACTIVE);
    this._emit();
  }
  setActiveTab(id) {
    this.activeTab = id;
    localStorage.setItem(SYNC_LS_TAB, id);
    this._emit();
  }

  async logout() {
    if (this.token) {
      try { await this._http("POST", "/api/logout"); } catch (e) {}
    }
    this.disconnect();
    this.token = null;
    this.state = null;
    localStorage.removeItem(SYNC_LS_TOKEN);
    this._emit();
  }

  // Convenience accessors
  get projects() { return this.state?.projects || []; }
  get activeProject() {
    const id = this.activeProjectId;
    if (!id) return this.projects[0];
    return this.projects.find(p => p.id === id) || this.projects[0];
  }
  get syncLog() { return this.state?.syncLog || []; }
  get sessions() { return this.state?.sessions || []; }
  get ccRunning() { return !!this.state?.ccRunning; }
  get lastFullSync() { return this.state?.lastFullSync || 0; }
}

window.SyncClient = SyncClient;
