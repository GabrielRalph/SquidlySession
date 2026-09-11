import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';

// Execute the actual Lite functions with controlled time/camera/Worker mocks.
// CDN model imports and DOM startup are deliberately outside this unit test.
const source=fs.readFileSync(new URL('../src/Features/VideoCall/background-lite.js',import.meta.url),'utf8');
const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const names=new Set(['getSchedulingLatencyMs','createScheduler','classifyWorkerPerformance','claimSegmentationSlot',
 'cancelSegmentationTimer','scheduleSegmentation','runSegmentationTick',
 'resumeSegmentationOnCameraFrame','recordMaskFrame']);
const constants=new Set(['OUTPUT','ANALYSIS','LEVELS','LEVEL_MAX_FPS','MAIN_THREAD_MAX_FPS',
 'SCHEDULE_TOLERANCE_MS','ALLOCATION_CHECK_MS','RECOVERY_MS','WORKER_RECOVERY_MS','WORKER_DOWNGRADE_MS']);
const code=ast.body.filter(n=>n.type==='FunctionDeclaration' && names.has(n.id.name) ||
 n.type==='VariableDeclaration' && constants.has(n.declarations[0].id.name))
 .map(n=>source.slice(n.start,n.end)).join(String.fromCharCode(10));
function setup() {
 let now=100, timers=[], posts=0;
 const context=vm.createContext({performance:{now:()=>now},console,
  setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;}, clearTimeout:()=>{},
  getSessionPerformanceState:()=>({visibility:'visible',frameSamples:30,longTaskRatio:0,slowFrameRatio:0}),
  wasVisionTaskRecentlyActive:()=>false,drawCover:()=>{},
  createImageBitmap:async()=>({close(){}}),
  recordSegmentationError:(_state,message)=>{throw new Error(message);},
 });
 vm.runInContext(code,context);
 const state={running:true,effectMode:'blur',segmentationBusy:false,waitingForCameraFrame:false,
  fallbackPromise:null,workerFailed:false,retrySegmentationAt:-Infinity,
  nextSegmentationAt:100,scheduledTargetFps:30,segmentationTimerId:null,
  executionMode:'worker',video:{currentTime:1},lastSegmentedVideoTime:1,
  pendingFrame:{canvas:{},context:{}},lastMediaPipeTimestamp:-1,analysis:{canvas:{},context:{clearRect(){}}},
  worker:{postMessage(){posts++;}},getAllocation:()=>({targetFps:30,level:'normal'}),
  maskLatencySamples:[20,20,20],maskCompletedTimes:[],deliveryStalls:0,
  averageInferenceMs:16.1,averageMaskLatencyMs:20,averageMaskIntervalMs:0,maskSourceTimestampMs:0};
 return {context,state,setNow:v=>now=v,timers,posts:()=>posts};
}
test('duplicate camera frame keeps its slot and sleeps until the next camera callback',async()=>{
 const h=setup();
 await h.context.runSegmentationTick(h.state);
 assert.equal(h.state.nextSegmentationAt,100);
 assert.equal(h.state.waitingForCameraFrame,true);
 assert.equal(h.timers.length,0);
 h.context.scheduleSegmentation(h.state);
 assert.equal(h.timers.length,0); // no busy timer loop
 h.state.video.currentTime=1.033;
 h.setNow(105);
 await h.context.resumeSegmentationOnCameraFrame(h.state);
 assert.equal(h.timers.length,0);
 assert.equal(h.posts(),1);
 assert.equal(h.state.nextSegmentationAt,100+1000/30);
 await h.context.runSegmentationTick(h.state);
 assert.equal(h.posts(),1); // one request in flight
});
test('measured 16 ms worker can target 30 FPS; round-trip cost limits slower delivery',()=>{
 const h=setup();
 assert.equal(h.context.createScheduler(h.state)().targetFps,30);
 h.state.averageMaskLatencyMs=60;h.state.maskLatencySamples=[60,60,60];
 assert.equal(h.context.createScheduler(h.state)().targetFps,15);
 h.state.averageMaskLatencyMs=h.state.averageInferenceMs=0;h.state.maskLatencySamples=[];
 assert.equal(h.context.createScheduler(h.state)().targetFps,20);
});
test('end-to-end latency includes time outside model inference',()=>{
 const h=setup();
 h.setNow(123);
 h.context.recordMaskFrame(h.state,100);
 assert.equal(h.state.lastMaskLatencyMs,23);
 assert.equal(h.state.hasMask,true);
});

test('reported 1499 ms delivery spike does not reduce a 9.7 ms worker to 2 FPS',()=>{
 const h=setup();h.state.averageInferenceMs=9.7;h.state.maskLatencySamples=[13,14,12,13];
 h.setNow(1599.4);h.context.recordMaskFrame(h.state,100);
 assert.equal(h.state.deliveryStalls,1);
 assert.equal(h.state.nextSegmentationAt,-Infinity);
 assert.equal(h.context.createScheduler(h.state)().targetFps,30);
 assert.equal(h.context.getSchedulingLatencyMs(h.state),13);
});
test('sustained delivery slowdown is respected and recovers after fresh samples',()=>{
 const h=setup();h.state.maskLatencySamples=[12,13,60,65,61];
 assert.equal(h.context.createScheduler(h.state)().targetFps,15);
 for(let i=0;i<3;i++){h.setNow(200+i*33);h.context.recordMaskFrame(h.state,190+i*33);}
 assert.equal(h.context.createScheduler(h.state)().targetFps,30);
 assert.equal(h.state.maskLatencySamples.length,5);
});
test('startup delivery outlier waits for evidence instead of imposing a persistent cap',()=>{
 const h=setup();h.state.averageInferenceMs=9.7;h.state.maskLatencySamples=[1500];
 assert.equal(h.context.createScheduler(h.state)().targetFps,30);
});

test('offscreen camera callback posts before composition without asynchronous bitmap copying',()=>{
 const h=setup();let copies=0,transfers=0;
 h.state.video.currentTime=2;
 h.state.analysis.canvas.transferToImageBitmap=()=>{transfers++;return {close(){}};};
 h.context.createImageBitmap=async()=>{copies++;throw new Error('Async path used');};
 const pending=h.context.resumeSegmentationOnCameraFrame(h.state);
 assert.equal(h.posts(),1); // already sent before awaiting callback result
 assert.equal(transfers,1);assert.equal(copies,0);
 return pending;
});
test('early camera callback neither steals a future slot nor adds worker work',async()=>{
 const h=setup();h.state.video.currentTime=2;h.state.nextSegmentationAt=150;
 await h.context.resumeSegmentationOnCameraFrame(h.state);
 assert.equal(h.posts(),0);assert.equal(h.state.nextSegmentationAt,150);
 h.state.effectMode='none';h.setNow(200);
 await h.context.resumeSegmentationOnCameraFrame(h.state);
 assert.equal(h.posts(),0);
});

test('reported 28 FPS output with two moderate long tasks retains 30 FPS worker budget',()=>{
 const h=setup();
 const snapshot={visibility:'visible',frameSamples:140,estimatedFrameFps:28,
  slowFrameRatio:0.06,longTaskRatio:0.06};
 h.context.getSessionPerformanceState=()=>snapshot;
 h.state.averageInferenceMs=16.6;h.state.maskLatencySamples=[18,18,18];
 assert.equal(h.context.classifyWorkerPerformance(snapshot).level,'normal');
 assert.equal(h.context.createScheduler(h.state)().targetFps,30);
});
test('real frame pressure, severe long tasks and missing evidence still throttle',()=>{
 const h=setup();
 const normal={visibility:'visible',frameSamples:140,estimatedFrameFps:28,
  slowFrameRatio:0.06,longTaskRatio:0.06};
 for(const [patch,expected] of [
  [{estimatedFrameFps:20},'constrained'],
  [{slowFrameRatio:0.15},'constrained'],
  [{frameSamples:0},'constrained'],
  [{longTaskRatio:0.18},'critical'],
  [{slowFrameRatio:0.28},'critical'],
  [{visibility:'hidden'},'hidden'],
 ]) assert.equal(h.context.classifyWorkerPerformance({...normal,...patch}).level,expected);
});

test('brief pressure does not lower masks; sustained pressure uses 20 FPS and recovers in 3 seconds',()=>{
 const h=setup();let pressure=false;
 h.context.getSessionPerformanceState=()=>({visibility:'visible',frameSamples:100,
  estimatedFrameFps:pressure?22:28,slowFrameRatio:pressure?0.15:0.03,longTaskRatio:0});
 const allocation=h.context.createScheduler(h.state);
 assert.equal(allocation().targetFps,30);
 pressure=true;h.setNow(1100);assert.equal(allocation().targetFps,30);
 pressure=false;h.setNow(2100);assert.equal(allocation().targetFps,30);
 pressure=true;h.setNow(3100);assert.equal(allocation().targetFps,30);
 h.setNow(5100);assert.equal(allocation().targetFps,20);
 pressure=false;h.setNow(6100);assert.equal(allocation().recoveryInMs,3000);
 h.setNow(9100);assert.equal(allocation().targetFps,30);
});
test('critical pressure is immediate; returning from hidden does not leave masks at 1 FPS',()=>{
 const h=setup();let visibility='visible',critical=false;
 h.context.getSessionPerformanceState=()=>({visibility,frameSamples:100,
  estimatedFrameFps:28,slowFrameRatio:0.03,longTaskRatio:critical?0.2:0});
 const allocation=h.context.createScheduler(h.state);
 assert.equal(allocation().targetFps,30);
 critical=true;h.setNow(1100);assert.equal(allocation().targetFps,6);
 visibility='hidden';h.setNow(2100);assert.equal(allocation().targetFps,1);
 visibility='visible';critical=false;h.setNow(3100);assert.equal(allocation().targetFps,30);
});
test('twenty-minute simulated call does not accumulate downgrade from isolated pressure spikes',()=>{
 const h=setup();let pressure=false;
 h.context.getSessionPerformanceState=()=>({visibility:'visible',frameSamples:100,
  estimatedFrameFps:pressure?22:28,slowFrameRatio:pressure?0.15:0.03,longTaskRatio:0});
 const allocation=h.context.createScheduler(h.state);
 for(let second=0;second<1200;second++) {
  pressure=second%30===10;h.setNow(100+second*1000);
  assert.equal(allocation().targetFps,30);
 }
});
