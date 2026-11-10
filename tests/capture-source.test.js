import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureSourceGuard, authorizedControlPayload, controlInputEnvelope } from '../src/Features/ShareContent/capture-source.js';
import { remoteControlStatusCopy } from '../src/Features/ShareContent/remote-control-status.js';
import { RemoteAgentClient } from '../src/Features/ShareContent/remote-agent-client.js';

function fixture() {
  const settings = {deviceId:'window-a', displaySurface:'window', width:800, height:600};
  const track = {id:'track-a', label:'Window A', getSettings:() => settings};
  return {settings, track, guard:new CaptureSourceGuard(track)};
}

test('moving/resizing the same captured window does not revoke control', () => {
  const {settings, track, guard} = fixture();
  settings.width=1200; settings.height=900;
  assert.equal(guard.changed(track), false);
});

test('same-kind and same-size source replacement is still a different source', () => {
  const {settings, track, guard} = fixture();
  settings.deviceId='window-b';
  assert.equal(guard.changed(track), true);
});

test('replacement tracks, labels, capture handles and surface kinds revoke the old binding', () => {
  const {track, guard} = fixture();
  assert.equal(guard.changed({...track}), true);
  track.label='Window B';
  assert.equal(guard.changed(track), true);
  const handleFixture=fixture();
  handleFixture.track.getCaptureHandle=() => ({origin:'https://example.com', handle:'new-tab'});
  assert.equal(handleFixture.guard.changed(handleFixture.track), true);
  const kindFixture=fixture();
  kindFixture.settings.displaySurface='monitor';
  assert.equal(kindFixture.guard.changed(kindFixture.track), true);
});

test('queued input from old authorization never reaches the new shared content', () => {
  const old=controlInputEnvelope('control-old','1|click|0.5|0.5|left|1');
  assert.equal(authorizedControlPayload(old,'control-new'), null);
  assert.equal(authorizedControlPayload(old,null), null);
  assert.equal(authorizedControlPayload('1|click|0.5|0.5|left|1','control-new'), null);
  const current=controlInputEnvelope('control-new','1|click|0.5|0.5|left|1');
  assert.equal(authorizedControlPayload(current,'control-new'),current.payload);
});

test('new capture authorization opens a fresh native connection without the previous window ID', () => {
  const original=globalThis.WebSocket;
  const sockets=[];
  class Socket {
    static OPEN=1;
    static CONNECTING=0;
    readyState=0;
    sent=[];
    constructor() { sockets.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState=3; }
    open() { this.readyState=1; this.onopen(); this.onmessage({data:JSON.stringify({type:"screen.info", explicitSurfaceBinding:true})}); }
  }
  globalThis.WebSocket=Socket;
  const client=new RemoteAgentClient();
  const reply={type:'surface.match',ok:true,kind:'window',x:0,y:0,width:800,height:600,
    guardedInput:true,foregroundControl:true,controlAllowed:true,id:42};
  try {
    client.matchSurface({surface:'window',width:800,height:600});
    client.connect(); sockets[0].open();
    client.candidates = [{id:42}];
    assert.equal(client.selectSurface(42), true);
    sockets[0].onmessage({data:JSON.stringify(reply)});
    const lateMessage=sockets[0].onmessage;
    client._pending.push({type:'mouse.click',surfaceId:42});
    client.disconnect();
    assert.equal(client.surfaceId,null);
    assert.deepEqual(client._pending,[]);
    client.matchSurface({surface:'window',width:800,height:600});
    client.connect(); sockets[1].open();
    const match=sockets[1].sent.find(message => message.type==='surface.match');
    assert.equal(match.id,undefined);
    assert.equal(match.startPaused,false);
    lateMessage({data:JSON.stringify(reply)});
    assert.equal(client.surfaceId,null);
    client.candidates = [{id:77}];
    assert.equal(client.selectSurface(77), true);
    sockets[1].onmessage({data:JSON.stringify({...reply,id:77})});
    assert.equal(client.surfaceId,77);
  } finally {
    client.disconnect(); globalThis.WebSocket=original;
  }
});

test('desktop, minimized and changed-source notices give both people distinct actions', () => {
  assert.match(remoteControlStatusCopy('window_not_visible',true).detail,/desktop.*Resume control/);
  assert.match(remoteControlStatusCopy('window_minimized',true).detail,/minimized.*Resume control/);
  for (const sharer of [true,false]) {
    const copy=remoteControlStatusCopy('source_changed',sharer);
    assert.match(copy.title,/turned off/);
    assert.doesNotMatch(copy.detail,/Resume control/);
  }
});
