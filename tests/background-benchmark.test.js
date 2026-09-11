import test from 'node:test';
import assert from 'node:assert/strict';
import {rankCandidates, chooseStartupEngine} from '../src/Features/VideoCall/background-benchmark.js';
const metrics=(age=30,fps=30)=>({maskAgeP95Ms:age,outputFps:fps,segmentationFps:20});
const report=()=>({results:[],ranking:[],restartFailures:[],winner:null,locked:false});

test('ranking balances stale masks against choppy output and rejects invalid data',()=>{
 const results=[
  {engine:'choppy',ok:true,...metrics(10,10)},
  {engine:'responsive',ok:true,...metrics(30,30)},
  {engine:'stale',ok:true,...metrics(70,30)},
  {engine:'bad',ok:true,...metrics(null,30)},
  {engine:'frozen',ok:true,...metrics(0,0)},
  {engine:'missing-masks',ok:true,...metrics(0,30),segmentationFps:0},
  {engine:'infinite',ok:true,...metrics(0,Infinity)},
 ];
 assert.deepEqual(rankCandidates(results).map(r=>r.engine),['responsive','stale','choppy']);
});

test('candidates never overlap; loser released; winner retained once and locked',async()=>{
 let live=0;const events=[];const state=report();
 const candidates=['gpu','cpu'].map(name=>({name,start:async()=>{
  assert.equal(live,0);live++;events.push('start '+name);
  return {ok:true,mode:name,destroy:async()=>{live--;events.push('stop '+name);}};
 }}));
 const winner=await chooseStartupEngine(candidates,async engine=>metrics(engine.mode==='cpu'?25:80),new AbortController().signal,state);
 assert.equal(winner.mode,'cpu');assert.equal(live,1);assert.equal(state.locked,true);
 assert.deepEqual(events,['start gpu','stop gpu','start cpu']);
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(events.length,3);
 assert.equal(state.reusedTrial,true); // no reevaluation timer after selection
 await winner.destroy();assert.equal(live,0);
});

test('probe failures do not prevent a measured survivor winning',async()=>{
 const state=report();let stopped=0;
 const candidates=[
  {name:'gpu',start:async()=>{throw new Error('GPU unavailable');}},
  {name:'cpu',start:async()=>({ok:true,destroy:async()=>stopped++})},
 ];
 const winner=await chooseStartupEngine(candidates,async()=>metrics(),new AbortController().signal,state);
 assert.equal(state.winner,'cpu');assert.equal(stopped,0);assert.equal(state.results[0].ok,false);
 await winner.destroy();
});

test('failed winner restart tries next measured candidate before locking',async()=>{
 const starts={gpu:0,cpu:0};const state=report();
 const candidates=['gpu','cpu'].map(name=>({name,start:async()=>{
  starts[name]++;
  if(name==='gpu' && starts[name]===2) return {ok:false,reason:'restart failed'};
  return {ok:true,mode:name,destroy:async()=>{}};
 }}));
 await chooseStartupEngine(candidates,async e=>metrics(e.mode==='gpu'?20:40),new AbortController().signal,state);
 assert.equal(state.winner,'cpu');assert.equal(state.restartFailures.length,1);assert.equal(state.locked,true);
});

test('cancellation releases in-progress trial and starts no successor',async()=>{
 const abort=new AbortController();let starts=0,stops=0;
 const candidates=['gpu','cpu'].map(name=>({name,start:async()=>{
  starts++;return {ok:true,destroy:async()=>stops++};
 }}));
 await assert.rejects(chooseStartupEngine(candidates,async()=>{abort.abort();return metrics();},abort.signal,report()),{name:'AbortError'});
 assert.equal(starts,1);assert.equal(stops,1);
});

test('no usable measurements produces no unmeasured selection',async()=>{
 let stops=0;const state=report();
 const winner=await chooseStartupEngine([{name:'cpu',start:async()=>({ok:true,destroy:async()=>stops++})}],
 async()=>metrics(40,0),new AbortController().signal,state);
 assert.equal(winner,null);assert.equal(stops,1);assert.equal(state.locked,false);
});

test('output probe measures actual frame counters and always detaches its video',async()=>{
 const fs = await import('node:fs');
 const vm = await import('node:vm');
 const {parse} = await import('acorn');
 const source=fs.readFileSync(new URL('../src/Features/VideoCall/background-benchmark.js',import.meta.url),'utf8');
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 const declarations=ast.body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n)
  .filter(n=>n?.type==='FunctionDeclaration' && ['pause','measureStartupEngine'].includes(n.id.name));
 const code=declarations.map(n=>source.slice(n.start,n.end)).join(String.fromCharCode(10));
 let now=0,frames=0,removed=0,paused=0;
 const video={style:{},play:async()=>{},pause:()=>paused++,remove:()=>removed++,
  getVideoPlaybackQuality:()=>({totalVideoFrames:frames})};
 const ctx=vm.createContext({performance:{now:()=>now},document:{visibilityState:'visible',
  createElement:()=>video,body:{appendChild(){}}},
  setTimeout:(fn,ms)=>{queueMicrotask(()=>{now+=ms;frames+=ms*30/1000;fn();});return 1;},clearTimeout:()=>{}});
 vm.runInContext(code,ctx);
 const engine={stream:{},getState:()=>({outputTrackState:'live',maskProvider:{maskAgeMs:40,segmentationRuns:now*20/1000}})};
 const metrics=await ctx.measureStartupEngine(engine,new AbortController().signal);
 assert.equal(metrics.outputFps,30);assert.equal(metrics.segmentationFps,20);
 assert.equal(metrics.maskAgeP95Ms,40);assert.equal(metrics.sampleCount,20);
 assert.equal(metrics.measuredMs,2000);
 assert.equal(removed,1);assert.equal(paused,1);assert.equal(video.srcObject,null);
 ctx.document.visibilityState='hidden';
 await assert.rejects(ctx.measureStartupEngine(engine,new AbortController().signal),/visible/);
 assert.equal(removed,2);assert.equal(video.srcObject,null);
});

test('frame stalls lose even when average FPS looks healthy',()=>{
 const results=[
 {engine:'bursty',ok:true,...metrics(20,30),frameIntervalP95Ms:100},
 {engine:'steady',ok:true,...metrics(45,30),frameIntervalP95Ms:34},
 ];
 assert.equal(rankCandidates(results)[0].engine,'steady');
});

test('reported laptop regression favours the faster-updating CPU contour',()=>{
 const results=[
 {engine:'gregblur',ok:true,outputFps:22.8,segmentationFps:8.1,maskAgeP95Ms:115},
 {engine:'lite-cpu',ok:true,outputFps:13.1,segmentationFps:12.2,maskAgeP95Ms:103},
 ];
 assert.equal(rankCandidates(results)[0].engine,'lite-cpu');
});

test('startup telemetry reset removes prior background pressure but preserves Eye Gaze',async()=>{
 const fs=await import('node:fs');const vm=await import('node:vm');const {parse}=await import('acorn');
 const source=fs.readFileSync(new URL('../src/Utilities/MediaPipe/vision-runtime.js',import.meta.url),'utf8');
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 const fn=ast.body.find(n=>n.type==='ExportNamedDeclaration' && n.declaration?.id?.name==='resetBackgroundPerformanceWindow').declaration;
 const face={active:true};
 const context=vm.createContext({performance:{now:()=>100},backgroundWindowStartedAt:0,
  frameSamples:[{interval:100}],longTaskSamples:[{duration:100}],lastSessionFrameAt:1,
  taskActivity:new Map([['background-segmenter',{}],['background-motion',{}],['face-landmarker',face]])});
 vm.runInContext(source.slice(fn.start,fn.end),context);
 context.resetBackgroundPerformanceWindow();
 assert.equal(context.frameSamples.length,0);assert.equal(context.longTaskSamples.length,0);
 assert.equal(context.lastSessionFrameAt,-Infinity);assert.equal(context.backgroundWindowStartedAt,100);
 assert.equal(context.taskActivity.size,1);assert.equal(context.taskActivity.get('face-landmarker'),face);
});
