import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentWindowCapture } from '../src/Features/ShareContent/agent-window-capture.js';
import { RemoteAgentClient } from '../src/Features/ShareContent/remote-agent-client.js';

function fixture() {
  const originals = {WebSocket:globalThis.WebSocket, document:globalThis.document, createImageBitmap:globalThis.createImageBitmap};
  const sockets = [];
  class Socket {
    static OPEN = 1; static CONNECTING = 0;
    readyState = 1; sent = [];
    constructor(url) {this.url = url; sockets.push(this);}
    send(raw) {this.sent.push(JSON.parse(raw));}
    close() {this.readyState = 3; this.onclose?.();}
    receive(data) {this.onmessage({data:typeof data === 'object' && !(data instanceof Blob) ? JSON.stringify(data) : data});}
  }
  let frames = 0, stopped = 0, released = 0;
  const track = {requestFrame:() => frames++, stop:() => stopped++, addEventListener:() => {}};
  const stream = {getVideoTracks:() => [track], getTracks:() => [track]};
  const canvas = {width:0, height:0, getContext:() => ({drawImage:() => {}}), captureStream:fps => {assert.equal(fps,0); return stream;}};
  globalThis.WebSocket = Socket;
  globalThis.document = {createElement:() => canvas};
  globalThis.createImageBitmap = async () => ({width:800, height:600, close:() => released++});
  return {sockets, stream, stats:() => ({frames,stopped,released}), restore:() => Object.assign(globalThis, originals)};
}

test('one native selection provides video and the same control identity without another picker', async () => {
  const f = fixture();
  const capture = new AgentWindowCapture();
  const control = new RemoteAgentClient();
  try {
    const started = capture.start();
    const socket = f.sockets[0];
    assert.match(socket.url, /\/capture$/);
    socket.receive({type:'capture.info', unifiedWindowCapture:true});
    assert.deepEqual(socket.sent, [{type:'capture.start'}]);
    socket.receive({type:'capture.started',id:42,captureId:'live-lease',kind:'window'});
    socket.receive(new Blob(['JPEG']));
    assert.equal(await started, f.stream);
    assert.deepEqual(f.stream.agentCapture, {id:42,captureId:'live-lease'});
    control.matchSurface({surface:'window', width:800,height:600,nativeCapture:f.stream.agentCapture});
    control.connect();
    const controlSocket = f.sockets[1];
    controlSocket.onopen();
    controlSocket.receive({type:'screen.info',explicitSurfaceBinding:true});
    const match = controlSocket.sent.find(m => m.type === 'surface.match');
    assert.equal(match.id,42);
    assert.equal(match.captureId,'live-lease');
    assert.equal(control.candidates.length,0);
    capture.stop(); capture.stop();
    assert.deepEqual(f.stats(), {frames:1,stopped:1,released:1});
    assert.deepEqual(socket.sent.at(-1), {type:'capture.stop'});
  } finally {capture.stop(); control.disconnect(); f.restore();}
});

test('cancelled OS picker and capture failures reject once and close transport', async () => {
  const f = fixture();
  try {
    for (const cancelled of [true,false]) {
      const capture = new AgentWindowCapture();
      const started = capture.start();
      const socket = f.sockets.at(-1);
      socket.receive({type:'capture.error',cancelled,error:'Access denied'});
      await assert.rejects(started, error => cancelled ? error.name === 'AbortError' : error.message === 'Access denied');
      assert.equal(capture.closed,true);
      assert.equal(socket.readyState,3);
    }
  } finally {f.restore();}
});

test('capture socket loss ends live video and notifies the sharing lifecycle once', async () => {
  const f = fixture();
  let ended = 0;
  const capture = new AgentWindowCapture({onEnded:() => ended++});
  try {
    const started = capture.start();
    const socket = f.sockets[0];
    socket.receive({type:'capture.started',id:42,captureId:'lease'});
    socket.receive(new Blob(['JPEG']));
    await started;
    socket.onclose(); socket.onclose();
    assert.equal(ended,1);
    assert.equal(f.stats().stopped,1);
    assert.equal(capture.closed,true);
  } finally {capture.stop(); f.restore();}
});
