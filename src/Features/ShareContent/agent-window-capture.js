import { DEFAULT_AGENT_URL } from './remote-agent-client.js';

/** One OS selection supplies both pixels and the native identity for control. */
export class AgentWindowCapture {
  constructor({url = DEFAULT_AGENT_URL, onEnded = null} = {}) {
    this.url = `${url.replace(/\/$/, '')}/capture`;
    this.onEnded = onEnded;
    this.closed = false;
    this.surface = null;
    this.stream = null;
    this._decoding = false;
    this._latestFrame = null;
  }

  async start() {
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d', {alpha:false});
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'blob';
    return new Promise((resolve, reject) => {
      this._reject = reject;
      this._resolve = resolve;
      // Only the connection/handshake has a short timeout. OS selection can
      // take as long as the person needs without losing their picker.
      this._timer = setTimeout(() => this._fail(new Error('Open RemoteAgent, then try sharing again.')), 5000);
      this.ws.onmessage = event => {
        if (this.closed) return;
        if (typeof event.data !== 'string') {
          this._latestFrame = event.data;
          this._drawLatest();
          return;
        }
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'capture.info') {
          clearTimeout(this._timer);
          if (!data.unifiedWindowCapture) {
            this._fail(new Error('Update and restart RemoteAgent to share a window.'));
            return;
          }
          this.ws.send(JSON.stringify({type:'capture.start'}));
        } else if (data.type === 'capture.started') {
          clearTimeout(this._timer);
          if (!Number.isInteger(data.id) || data.id <= 0 || typeof data.captureId !== 'string') {
            this._fail(new Error('The shared window could not be prepared. Try sharing again.'));
            return;
          }
          this.surface = data;
          this._timer = setTimeout(() => this._fail(new Error('No picture was received. Check RemoteAgent Screen Recording access and try again.')), 10000);
        } else if (data.type === 'capture.error') {
          const error = new Error(data.cancelled ? 'Sharing cancelled.' : data.error || 'Window sharing stopped.');
          if (data.cancelled) error.name = 'AbortError';
          this._fail(error);
        } else if (data.type === 'screen.info') {
          this._fail(new Error('Update and restart RemoteAgent to share a window.'));
        }
      };
      this.ws.onclose = () => {
        if (!this.closed) this._fail(new Error('RemoteAgent disconnected. Share the window again after reconnecting.'));
      };
      this.ws.onerror = () => this._fail(new Error('Cannot connect to RemoteAgent. Open it, then try sharing again.'));
    });
  }

  async _drawLatest() {
    if (this._decoding || !this._latestFrame || this.closed || !this.surface) return;
    this._decoding = true;
    const blob = this._latestFrame;
    this._latestFrame = null;
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
      if (this.closed) return;
      if (this.canvas.width !== bitmap.width || this.canvas.height !== bitmap.height) {
        this.canvas.width = bitmap.width;
        this.canvas.height = bitmap.height;
      }
      this.context.drawImage(bitmap, 0, 0);
      if (!this.stream) {
        this.stream = this.canvas.captureStream(0);
        // Identity comes only from this live native capture, never video size.
        this.stream.agentCapture = {captureId:this.surface.captureId, id:this.surface.id};
        this.track = this.stream.getVideoTracks()[0];
        this.track.addEventListener('ended', () => this._fail(new Error('Window sharing stopped. Share the window again.')));
      }
      this.track.requestFrame();
      if (this._resolve) {
        clearTimeout(this._timer);
        this._resolve(this.stream);
        this._resolve = this._reject = null;
      }
    } catch {
      this._fail(new Error('The shared picture could not be displayed. Share the window again.'));
    } finally {
      bitmap?.close();
      this._decoding = false;
      if (this._latestFrame && !this.closed) this._drawLatest();
    }
  }

  _fail(error) {
    if (this.closed) return;
    const started = !!this.stream;
    const reject = this._reject;
    this._reject = null;
    this.stop();
    reject?.(error);
    if (started) this.onEnded?.(error);
  }

  stop() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this._timer);
    this._latestFrame = null;
    this.stream?.getTracks().forEach(track => track.stop());
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({type:'capture.stop'}));
    this.ws?.close();
    this._reject?.(Object.assign(new Error('Sharing cancelled.'), {name:'AbortError'}));
    this._resolve = this._reject = null;
  }
}
