/** Real ShareContent lifecycle with only DOM/media transport dependencies stubbed.
 * Run: node --experimental-vm-modules tests/manual_capture_source_smoke.mjs
 * No browser permission dialog or physical input is involved.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const sockets=[];
class Socket {
  static OPEN=1;
  static CONNECTING=0;
  readyState=0;
  sent=[];
  constructor() { sockets.push(this); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState=3; }
  open() { this.readyState=1; this.onopen(); }
}
const context=vm.createContext({console, setTimeout, clearTimeout, setInterval, clearInterval, WebSocket:Socket});
const actual=new Set(['share-content.js','remote-agent-client.js','remote-control-protocol.js','remote-control-status.js','capture-source.js']);
const cache=new Map();
const base=new URL('../src/Features/ShareContent/',import.meta.url);
async function load(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  const module=actual.has(url.pathname.split('/').pop())
    ? new vm.SourceTextModule(await fs.readFile(url,'utf8'),{context,identifier:url.href})
    : new vm.SyntheticModule(['SvgPlus','Features','ContentViewer','RTCSignaler','ConnectionManager'],function() {
      for (const name of ['SvgPlus','Features','ContentViewer','RTCSignaler','ConnectionManager']) this.setExport(name,class {});
    },{context,identifier:url.href});
  cache.set(url.href,module);
  await module.link((specifier,parent) => load(new URL(specifier,parent.identifier)));
  return module;
}
const root=await load(new URL('share-content.js',base));
await root.evaluate();
const ShareContent=root.namespace.default;
const {RemoteAgentClient}=cache.get(new URL('remote-agent-client.js',base).href).namespace;
const {CaptureSourceGuard,controlInputEnvelope}=cache.get(new URL('capture-source.js',base).href).namespace;
const feature=Object.create(ShareContent.prototype);
const settings={deviceId:'window-a',displaySurface:'window',width:800,height:600};
let stopped=0;
const track={id:'capture-track',label:'Shared window',getSettings:()=>settings,stop:()=>stopped++};
const stream={getVideoTracks:()=>[track]};
const writes=[];
const oldState={enabled:true,sharer:'sharer',controller:'controller',surface:'window',controlId:'old-control'};
Object.assign(feature,{
  _rcState:oldState,_retiredControlIds:new Set(),_rcHeldKeys:new Set(),_rcKeysArmed:false,
  _rcInjectCount:0,_isSharing:true,_captureSourceGuard:new CaptureSourceGuard(track),_shareScreen:{stream},
  _displaySurface:'window',sdata:{me:'sharer',set:(path,value)=>writes.push({path,value})},
  contentView:{displayType:'stream',content:{video:{videoWidth:400,videoHeight:300}},setRemoteControl:()=>{}},
});
const client=new RemoteAgentClient();
feature._rcAgent=client;
client.matchSurface({surface:'window',width:800,height:600}); client.connect(); sockets[0].open();
const reply={type:'surface.match',ok:true,kind:'window',id:42,x:0,y:0,width:800,height:600,
  guardedInput:true,foregroundControl:true,controlAllowed:true};
sockets[0].onmessage({data:JSON.stringify(reply)});
client._pending.push({type:'mouse.click',surfaceId:42});
settings.deviceId='window-b';
assert.equal(feature._checkCaptureSourceChange(),true);
assert.equal(feature._rcState.enabled,false);
assert.equal(feature._rcState.reason,'source_changed');
assert.equal(client.surfaceId,null);
assert.equal(client._pending.length,0);
assert.equal(sockets[0].readyState,3);
assert.equal(feature._shareScreen.stream,stream);
assert.equal(stopped,0);
feature._applyRemoteControlState(oldState);
assert.equal(feature._rcState.enabled,false);
feature._applyRemoteControlState({...oldState,controlId:'new-control'});
sockets[1].open();
const match=sockets[1].sent.find(message=>message.type==='surface.match');
assert.equal(match.id,undefined);
assert.equal(match.width,800); // Current track, not the old video frame's 400.
sockets[1].onmessage({data:JSON.stringify({...reply,id:77})});
const count=()=>sockets[1].sent.filter(message=>message.type==='mouse.click').length;
feature._onRemoteRtc(controlInputEnvelope('old-control','1|click|0.5|0.5|left|1'));
assert.equal(count(),0);
feature._onRemoteRtc(controlInputEnvelope('new-control','1|click|0.5|0.5|left|1'));
assert.equal(count(),1);
assert.equal(sockets[1].sent.find(message=>message.type==='mouse.click').surfaceId,77);
settings.width=1000;
assert.equal(feature._checkCaptureSourceChange(),false);
assert.ok(writes.some(({value})=>value.reason==='source_changed'));
client.disconnect();
const published=[];
feature.sdata.me='controller';
feature.session={videoCall:{sendData:(path,value)=>published.push(value)}};
feature._applyRemoteControlState({...oldState,controlId:'controller-old'});
const oldPublisher=feature._rcPublisher;
feature._applyRemoteControlState({...oldState,controlId:'controller-new'});
oldPublisher.emitClick({nx:0.5,ny:0.5},'left');
assert.equal(published.length,0);
feature._rcPublisher.emitClick({nx:0.5,ny:0.5},'left');
assert.equal(published.length,1);
assert.equal(published[0].controlId,'controller-new');
feature._rcPublisher.stop();
console.log('PASS real ShareContent: revoke old source, preserve video, reject stale authorization/input/publisher, bind fresh ID, accept new input, allow resize');
