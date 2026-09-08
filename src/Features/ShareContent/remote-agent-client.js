/** Localhost WebSocket client for RemoteAgent (ws://127.0.0.1:8765). */

export const DEFAULT_AGENT_URL = "ws://127.0.0.1:8765";
const RECONNECT_MS = 1500;

export class RemoteAgentClient {
  /**
   * @param {{url?: string, onStatus?: (info: {connected: boolean, bounds: object|null, error?: string|null}) => void}} [opts]
   */
  constructor(opts = {}) {
    this.url = opts.url || DEFAULT_AGENT_URL;
    this.onStatus = opts.onStatus || null;
    this.bounds = null;
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
    this._pending = [];
    this._loggedWaiting = false;
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
      console.log("%cremote-agent", "color:#3d9a6a", "connected", this.url);
      this._emitStatus();
      this.send({ type: "screen.info" });
    };
    ws.onmessage = (ev) => this._onMessage(ev.data);
    ws.onerror = () => {
      /* onclose handles retry */
    };
    ws.onclose = () => {
      const wasOurs = this._ws === ws;
      this._connecting = false;
      if (wasOurs) this._ws = null;
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
    if (!data || data.type !== "screen.info" || !data.ok) return;
    const x = Number(data.x);
    const y = Number(data.y);
    const width = Number(data.width);
    const height = Number(data.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
    this.bounds = { x, y, width, height };
    console.log(
      "%cremote-agent",
      "color:#3d9a6a",
      `screen ${Math.round(width)}×${Math.round(height)} @ ${Math.round(x)},${Math.round(y)}`,
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

  _emitStatus(error = null) {
    if (!(this.onStatus instanceof Function)) return;
    this.onStatus({
      connected: this.connected,
      bounds: this.bounds,
      error,
    });
  }
}
