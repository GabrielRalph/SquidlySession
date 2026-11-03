import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteAgentClient } from '../src/Features/ShareContent/remote-agent-client.js';
import { remoteControlStatusCopy } from '../src/Features/ShareContent/remote-control-status.js';

test('automatic foreground recovery does not require manual resume on reconnect', () => {
  const client = new RemoteAgentClient();
  client._matchReq = {surface:'window', width:400, height:300};
  const reply = {type:'surface.match', ok:true, id:42, kind:'window', x:10, y:20,
    width:400, height:300, guardedInput:true, foregroundControl:true,
    controlAllowed:false, pauseReason:'preparing_window'};
  client._onMessage(JSON.stringify(reply));
  assert.equal(client.statusCode, 'preparing_window');
  assert.equal(client._resumeRequired, false);
  assert.equal(client.bounds, null);
  client._onMessage(JSON.stringify({type:'mouse.click', ok:false, pauseReason:'preparing_window'}));
  assert.equal(client._resumeRequired, false);
  client._onMessage(JSON.stringify({...reply, controlAllowed:true, pauseReason:null}));
  assert.equal(client.statusCode, 'ready');
  assert.equal(client._surfaceId, 42);
  assert.ok(client.bounds);
  client._onMessage(JSON.stringify({...reply, type:'surface.pause', pauseReason:'paused_by_sharer'}));
  assert.equal(client._resumeRequired, true);
  client.disconnect();
});

test('both users see automatic foreground recovery instead of an occlusion pause', () => {
  for (const isSharer of [true, false]) {
    const copy = remoteControlStatusCopy('preparing_window', isSharer);
    assert.doesNotMatch(copy.title, /paused/i);
    assert.match(copy.detail, /continue automatically/i);
    assert.doesNotMatch(copy.detail, /select resume/i);
  }
});

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
