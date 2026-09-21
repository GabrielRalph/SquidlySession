/** Localhost WebSocket client for RemoteAgent (ws://127.0.0.1:8765). */

export const DEFAULT_AGENT_URL = "ws://127.0.0.1:8765";
const RECONNECT_MS = 1500;
const MATCH_REFRESH_MS = 300;

function parseBounds(data) {
  if (!data) return null;
  const x = Number(data.x);
  const y = Number(data.y);
  const width = Number(data.width);
  const height = Number(data.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export class RemoteAgentClient {
  /**
   * @param {{url?: string, onStatus?: (info: {connected: boolean, bounds: object|null, error?: string|null}) => void}} [opts]
   */
  constructor(opts = {}) {
    this.url = opts.url || DEFAULT_AGENT_URL;
    this.onStatus = opts.onStatus || null;
    this.bounds = null;
    this._matchReq = null;
    this._surfaceId = null;
    this._matchTimer = 0;
    this._ws = null;
    this._wanted = false;
    this._reconnectTimer = 0;
    this._connecting = false;
    this._loggedWaiting = false;
    this._pending = [];
  }

  get connected() {
    return !!this._ws && this._ws.readyState === WebSocket.OPEN;
  }

  connect() {
    this._wanted = true;
    this._open();
  }

  disconnect() {
    this._wanted = false;
    this._clearReconnect();
    this._clearMatchTimer();
    this._pending = [];
    this._loggedWaiting = false;
    this.bounds = null;
    this._matchReq = null;
    this._surfaceId = null;
    const ws = this._ws;
    this._ws = null;
    this._connecting = false;
    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this._emitStatus();
  }

  /**
   * Ask the agent to map normalized coords onto the captured window/display.
   * Injection bounds are only set after a successful unique match.
   * @param {{surface?: string|null, width: number, height: number}} info
   */
  matchSurface(info) {
    const width = Number(info?.width);
    const height = Number(info?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    const surface = info.surface || "window";
    if (this._matchReq && this._matchReq.surface !== surface) {
      this._surfaceId = null;
    }
    this._matchReq = {
      surface,
      width,
      height,
    };
    this.bounds = null;
    if (this.connected) this._sendMatch();
    this._startMatchTimer();
    this._emitStatus();
  }

  /**
   * @param {object} command agent JSON (pixel x/y for mouse)
   * @return {boolean}
   */
  send(command) {
    if (!command) return false;
    if (!this.connected) {
      if (this._wanted) this._queue(command);
      return false;
    }
    try {
      this._ws.send(JSON.stringify(command));
      return true;
    } catch {
      return false;
    }
  }

  _sendMatch() {
    const req = this._matchReq;
    if (!req) return;
    this.send({
      type: "surface.match",
      surface: req.surface,
      width: req.width,
      height: req.height,
      ...(this._surfaceId != null ? { id: this._surfaceId } : {}),
    });
  }

  _queue(command) {
    if (command.type === "mouse.move") {
      const last = this._pending[this._pending.length - 1];
      if (last && last.type === "mouse.move") {
        this._pending[this._pending.length - 1] = command;
        return;
      }
    }
    this._pending.push(command);
    if (this._pending.length > 32) this._pending.shift();
  }

  _flushPending() {
    if (!this.bounds) return;
    const queued = this._pending;
    this._pending = [];
    for (const command of queued) this.send(command);
  }

  _open() {
    if (!this._wanted) return;
    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this._connecting) return;
    this._connecting = true;
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this._connecting = false;
      this._scheduleReconnect(String(err?.message || err));
      return;
    }
    this._ws = ws;
    ws.onopen = () => {
      this._connecting = false;
      this._loggedWaiting = false;
      this.bounds = null;
      console.log("%cremote-agent", "color:#3d9a6a", "connected", this.url);
      this._emitStatus();
      if (this._matchReq) this._sendMatch();
      this._startMatchTimer();
    };
    ws.onmessage = (ev) => this._onMessage(ev.data);
    ws.onerror = () => {
      /* onclose handles retry */
    };
    ws.onclose = () => {
      const wasOurs = this._ws === ws;
      this._connecting = false;
      if (wasOurs) this._ws = null;
      this.bounds = null;
      this._clearMatchTimer();
      if (!this._wanted) {
        this._emitStatus();
        return;
      }
      this._scheduleReconnect(null);
    };
  }

  _onMessage(raw) {
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (!data || data.type !== "surface.match") return;
    if (!data.ok) {
      this.bounds = null;
      console.warn("%cremote-agent", "color:#e07a2f", "surface.match failed", data.error || "");
      this._emitStatus(data.error || "no unique matching surface");
      return;
    }
    const bounds = parseBounds(data);
    if (!bounds) {
      this.bounds = null;
      this._emitStatus("invalid surface.match bounds");
      return;
    }
    this.bounds = bounds;
    if (Number.isInteger(data.id) && data.id > 0) this._surfaceId = data.id;
    const label = [data.kind, data.owner, data.name].filter(Boolean).join(" ");
    console.log(
      "%cremote-agent",
      "color:#3d9a6a",
      `surface ${Math.round(bounds.width)}×${Math.round(bounds.height)} @ ${Math.round(bounds.x)},${Math.round(bounds.y)}`,
      label,
    );
    this._emitStatus();
    this._flushPending();
  }

  _scheduleReconnect(error) {
    this._emitStatus(error);
    if (!this._wanted || this._reconnectTimer) return;
    if (!this._loggedWaiting) {
      this._loggedWaiting = true;
      console.warn("remote-agent waiting for", this.url, "— start RemoteAgent on this Mac");
    }
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = 0;
      this._open();
    }, RECONNECT_MS);
  }

  _clearReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = 0;
    }
  }

  _startMatchTimer() {
    if (this._matchTimer || !this._wanted || !this._matchReq || !this.connected) return;
    this._matchTimer = setInterval(() => {
      // Suspend injection until the agent confirms the original surface still exists.
      this.bounds = null;
      this._sendMatch();
    }, MATCH_REFRESH_MS);
  }

  _clearMatchTimer() {
    if (this._matchTimer) clearInterval(this._matchTimer);
    this._matchTimer = 0;
  }

  _emitStatus(error = null) {
    if (!(this.onStatus instanceof Function)) return;
    this.onStatus({
      connected: this.connected,
      bounds: this.bounds,
      error,
    });
  }
}
