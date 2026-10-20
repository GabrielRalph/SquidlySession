import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteAgentClient } from '../src/Features/ShareContent/remote-agent-client.js';

test('identifies each connection, updates changed metadata, and honors menu disconnect', () => {
  const original = globalThis.WebSocket;
  const sockets = [];
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 0;
    sent = [];
    constructor() { sockets.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen(); }
  }
  globalThis.WebSocket = Socket;
  let tab = 'First tab';
  const client = new RemoteAgentClient({ getSessionInfo: () => ({meeting:'meeting-qa', browser:'Chrome', tab}) });
  try {
    client.connect();
    sockets[0].open();
    assert.deepEqual(sockets[0].sent[0], {type:'session.identify', meeting:'meeting-qa', browser:'Chrome', tab:'First tab'});
    client._identifySession();
    assert.equal(sockets[0].sent.length, 1);
    tab = 'Renamed tab';
    client._identifySession();
    assert.equal(sockets[0].sent[1].tab, tab);
    sockets[0].readyState = 3;
    sockets[0].onclose({code:4000});
    assert.equal(client._wanted, false);
    assert.equal(client._reconnectTimer, 0);
    client.connect();
    sockets[1].open();
    assert.equal(sockets[1].sent[0].type, 'session.identify');
  } finally {
    client.disconnect();
    globalThis.WebSocket = original;
  }
});
