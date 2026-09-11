import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';

const source = fs.readFileSync(new URL('../src/Features/VideoCall/background-lite.js', import.meta.url), 'utf8');
const names = new Set(['drawCover', 'claimSegmentationSlot', 'runSegmentationTick',
  'recordSegmentation', 'recordMaskFrame', 'acceptWorkerMask', 'acceptMainThreadMask',
  'commitPairedFrame', 'renderFrame', 'drawForeground', 'drawBlurBackground', 'drawDirectVideo']);
const constants = new Set(['OUTPUT', 'ANALYSIS', 'BLUR', 'MAIN_THREAD_MAX_FPS',
  'MASK_MAX_AGE_MS', 'PAIR_MAX_LATENCY_MS', 'MASK_RENDER_PADDING', 'SCHEDULE_TOLERANCE_MS']);
const code = parse(source, {ecmaVersion:'latest', sourceType:'module'}).body
  .filter(n => n.type === 'FunctionDeclaration' && names.has(n.id.name) ||
    n.type === 'VariableDeclaration' && constants.has(n.declarations[0].id.name))
  .map(n => source.slice(n.start, n.end)).join('\n');

function surface() {
  const canvas = {width:480, height:270, frame:null};
  const draws = [];
  const context = {clearRect(){}, save(){}, restore(){},
    drawImage(source) { draws.push({source, frame:source.frame}); canvas.frame = source.frame; },
    createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};}, putImageData(){}};
  return {canvas, context, draws};
}
function setup() {
  let now = 100, posts = [], scheduled = 0;
  const context = vm.createContext({performance:{now:()=>now}, HTMLMediaElement:{HAVE_CURRENT_DATA:2},
    noteVisionTaskRun(){}, noteSessionFrame(){throw new Error('Output must not feed camera cadence');},
    scheduleSegmentation(){scheduled++;}, cancelSegmentationTimer(){},
    recordSegmentationError(_s,m){throw new Error(m);},
    createImageBitmap:async canvas=>({frame:canvas.frame, close(){}})});
  vm.runInContext(code, context);
  const state = {running:true, effectMode:'blur', segmentationBusy:false, fallbackPromise:null,
    workerFailed:false, retrySegmentationAt:-Infinity, nextSegmentationAt:-Infinity,
    lastSegmentedVideoTime:-1, lastMediaPipeTimestamp:-1, executionMode:'worker',
    getAllocation:()=>({targetFps:30,level:'normal'}), video:{width:640,height:480,currentTime:1,readyState:2,frame:'A'},
    inputTrack:{enabled:true,muted:false,readyState:'live'}, output:{...surface(),track:{}},
    pendingFrame:surface(), pairedFrame:surface(), pendingFrameTimestampMs:null, pairedFrameTimestampMs:null,
    analysis:surface(), mask:surface(), foreground:surface(), blur:surface(), background:surface(),
    worker:{postMessage(data){posts.push(data);}},
    maskLatencySamples:[],maskCompletedTimes:[],deliveryStalls:0,segmentationRuns:0,
    averageInferenceMs:0,averageMaskLatencyMs:0,averageMaskIntervalMs:0,maskSourceTimestampMs:-Infinity,
    renderedFrames:0,renderWindowStartedAt:0,pairedFrames:0,droppedLatePairs:0,pairNeedsRender:false};
  const mask = timestampMs => ({timestampMs,width:256,height:144,inferenceMs:10,
    bitmap:{frame:'mask',closed:false,close(){this.closed=true;}}});
  return {context,state,posts,mask,setNow:v=>now=v,scheduled:()=>scheduled};
}

test('camera advances A to B while inference runs: analysis, foreground and blur all use A', async()=>{
  const h=setup(), s=h.state;
  await h.context.runSegmentationTick(s);
  assert.equal(h.posts[0].bitmap.frame,'A');
  s.video.frame='B';s.video.currentTime=2;h.setNow(118);
  h.context.acceptWorkerMask(s,h.mask(100));
  assert.equal(s.foreground.draws[0].frame,'A');
  assert.equal(s.blur.draws[0].frame,'A');
  assert.equal(s.pairedFrameTimestampMs,s.maskSourceTimestampMs);
  assert.equal(s.lastCompositeLatencyMs,18);
  assert.equal(s.pairedFrames,1);
  const draws=s.output.draws.length;
  h.context.renderFrame(s,120);
  assert.equal(s.output.draws.length,draws); // camera callback cannot replace completed output
});

test('one request in flight and two source buffers are reused without overwriting the completed pair', async()=>{
  const h=setup(),s=h.state,first=s.pendingFrame,second=s.pairedFrame;
  await h.context.runSegmentationTick(s);
  s.video.frame='B';s.video.currentTime=2;
  await h.context.runSegmentationTick(s);
  assert.equal(h.posts.length,1);assert.equal(first.canvas.frame,'A');
  h.setNow(118);h.context.acceptWorkerMask(s,h.mask(100));
  h.setNow(134);await h.context.runSegmentationTick(s);
  assert.equal(s.pendingFrame,second);assert.equal(s.pairedFrame,first);
  assert.equal(first.canvas.frame,'A');assert.equal(second.canvas.frame,'B');
  h.setNow(150);h.context.acceptWorkerMask(s,h.mask(134));
  assert.equal(s.pairedFrame,second);assert.equal(s.pendingFrame,first);
  assert.equal(s.foreground.draws[2].frame,'B');
});

test('mismatched or shutdown results close bitmaps without releasing a current request or rendering',async()=>{
  const h=setup(),s=h.state;
  await h.context.runSegmentationTick(s);
  const stale=h.mask(99);h.context.acceptWorkerMask(s,stale);
  assert.equal(stale.bitmap.closed,true);assert.equal(s.segmentationBusy,true);
  assert.equal(s.pairedFrames,0);assert.equal(s.pendingFrameTimestampMs,100);
  s.running=false;
  const late=h.mask(100);h.context.acceptWorkerMask(s,late);
  assert.equal(late.bitmap.closed,true);assert.equal(s.pairedFrames,0);
});

test('turning the effect off during inference keeps live raw output when its result arrives',async()=>{
  const h=setup(),s=h.state;
  await h.context.runSegmentationTick(s);
  s.effectMode='none';s.video.frame='B';h.setNow(118);
  h.context.acceptWorkerMask(s,h.mask(100));
  assert.equal(s.output.draws.at(-1).frame,'B');assert.equal(s.pairedFrames,0);
});

test('main-thread mask conversion uses the same pairing commit and image mode uses retained foreground',async()=>{
  const h=setup(),s=h.state;
  await h.context.runSegmentationTick(s);
  s.effectMode='image';s.video.frame='B';h.setNow(118);
  h.context.acceptMainThreadMask(s,{width:1,height:1,values:[1]},100);
  assert.equal(s.foreground.draws[0].frame,'A');assert.equal(s.blur.draws.length,0);
  assert.equal(s.pairedFrames,1);
});


test('a 1.5 second delivery stall drops the old pair and requests a fresh frame',async()=>{
  const h=setup(),s=h.state;
  await h.context.runSegmentationTick(s);
  s.video.frame='latest';h.setNow(1600);
  h.context.acceptWorkerMask(s,h.mask(100));
  assert.equal(s.pairedFrames,0);assert.equal(s.droppedLatePairs,1);
  assert.equal(s.pendingFrameTimestampMs,null);assert.equal(s.nextSegmentationAt,-Infinity);
  assert.equal(s.output.draws.at(-1).frame,'latest');assert.equal(h.scheduled(),1);
});
