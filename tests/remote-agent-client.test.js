import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteAgentClient } from '../src/Features/ShareContent/remote-agent-client.js';
import { remoteControlStatusCopy } from '../src/Features/ShareContent/remote-control-status.js';

test('automatic foreground recovery does not require manual resume on reconnect', () => {
  const client = new RemoteAgentClient();
  client._surfaceId = 42;
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

test('waiting for ownership survives reconnect and ignores stale socket callbacks', () => {
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
    open() { this.readyState = 1; this.onopen(); this.onmessage({data:JSON.stringify({type:"screen.info", explicitSurfaceBinding:true})}); }
  }
  globalThis.WebSocket = Socket;
  const client = new RemoteAgentClient();
  try {
    client._surfaceId = 42;
    client._matchReq = {surface:'window', width:400, height:300};
    client.connect();
    sockets[0].open();
    const reply = {type:'surface.match', ok:true, id:42, kind:'window', x:10, y:20,
      width:400, height:300, guardedInput:true, foregroundControl:true,
      controlAllowed:false, pauseReason:'window_in_use'};
    sockets[0].onmessage({data:JSON.stringify(reply)});
    assert.equal(client._resumeRequired, false);
    assert.equal(client.bounds, null);
    assert.equal(client.statusCode, 'window_in_use');
    sockets[0].onmessage({data:JSON.stringify({type:'mouse.click', pauseReason:'window_in_use'})});
    assert.equal(client._resumeRequired, false);

    sockets[0].readyState = 3;
    client.connect();
    sockets[1].open();
    const match = sockets[1].sent.find(message => message.type === 'surface.match');
    assert.equal(match.id, 42);
    assert.equal(match.startPaused, false);
    sockets[1].onmessage({data:JSON.stringify({...reply, controlAllowed:true, pauseReason:null})});
    const timer = client._matchTimer;
    sockets[0].onclose({code:4000});
    sockets[0].onmessage({data:JSON.stringify(reply)});
    sockets[0].onopen();
    assert.equal(client._wanted, true);
    assert.equal(client._ws, sockets[1]);
    assert.equal(client._matchTimer, timer);
    assert.equal(client.statusCode, 'ready');
    assert.ok(client.bounds);
  } finally {
    client.disconnect();
    globalThis.WebSocket = original;
  }
});

test('waiting copy promises automatic recovery without claiming a different meeting', () => {
  for (const isSharer of [true, false]) {
    const copy = remoteControlStatusCopy('window_in_use', isSharer);
    assert.doesNotMatch(copy.title, /paused/i);
    assert.match(copy.detail, /continue automatically/i);
    assert.doesNotMatch(copy.detail, /another session|resume control/i);
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
    open() { this.readyState = 1; this.onopen(); this.onmessage({data:JSON.stringify({type:"screen.info", explicitSurfaceBinding:true})}); }
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


test('requires explicit selection even for same-size windows and waits for capability handshake', () => {
  const original = globalThis.WebSocket;
  let socket;
  class Socket {
    static OPEN = 1; static CONNECTING = 0;
    readyState = 0; sent = [];
    constructor() { socket = this; }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; }
  }
  globalThis.WebSocket = Socket;
  const client = new RemoteAgentClient();
  const receive = data => socket.onmessage({data:JSON.stringify(data)});
  try {
    client.matchSurface({surface:'window', width:0, height:0});
    client.connect(); socket.readyState = 1; socket.onopen();
    assert.equal(socket.sent.some(m => m.type === 'surface.match'), false);
    receive({type:'screen.info'});
    client._sendMatch();
    assert.equal(client.statusCode, 'agent_update_required');
    assert.equal(socket.sent.some(m => m.type === 'surface.match'), false);
    receive({type:'screen.info', explicitSurfaceBinding:true});
    assert.equal(socket.sent.at(-1).id, undefined);
    const waiting = {type:'surface.match', ok:false, pauseReason:'surface_selection_required',
      candidates:[{id:42, width:400, height:300}, {id:43, width:400, height:300}]};
    receive(waiting);
    assert.equal(client.surfaceId, null);
    assert.equal(client.bounds, null);
    assert.equal(client._resumeRequired, false);
    assert.equal(client.selectSurface(99), false);
    assert.equal(client.selectSurface(43), true);
    assert.equal(socket.sent.at(-1).id, 43);
    assert.equal(socket.sent.at(-1).width, 0);
    receive(waiting); // A previously queued list reply must not undo selection.
    assert.equal(client.statusCode, 'preparing_window');
    const reply = {type:'surface.match', ok:true, id:42, kind:'window', x:10, y:20,
      width:900, height:700, guardedInput:true, foregroundControl:true, controlAllowed:true};
    receive(reply); // The reply cannot silently substitute a different ID.
    assert.equal(client.bounds, null);
    receive({...reply, id:43});
    assert.equal(client.bounds.width, 900);
    assert.equal(client.statusCode, 'ready');
    client._sendMatch();
    assert.equal(socket.sent.at(-1).id, 43);
  } finally { client.disconnect(); globalThis.WebSocket = original; }
});
