import test from 'node:test';
import { hasSignificantMotion, createMaskMotionDetector } from '../src/Features/VideoCall/gregblur/motion-detector.js';
import { getMotionSegmentationFps } from '../src/Features/VideoCall/gregblur/latency-policy.js';
import assert from 'node:assert/strict';
import { getHeadroomSegmentationFps, getMaskHistoryWeight } from '../src/Features/VideoCall/gregblur/latency-policy.js';
import { createSegmentationClock } from '../src/Features/VideoCall/gregblur/segmentation-clock.js';
import { createGregblurBackgroundPipeline } from '../src/Features/VideoCall/gregblur/pipeline.js';

for (const fps of [12, 20, 30]) {
  test('30 FPS camera preserves ' + fps + ' Hz segmentation budget', () => {
    const clock = createSegmentationClock();
    let runs = 0;
    for (let frame = 0; frame < 300; frame++) {
      if (clock.shouldRun(frame * 1000 / 30, fps, runs > 0)) runs++;
    }
    assert.equal(runs, fps * 10);
  });
}

test('stalls skip missed inference slots; rate changes, missing masks and resets recover', () => {
  const clock = createSegmentationClock();
  assert.equal(clock.shouldRun(0, 20, false), true);
  assert.equal(clock.shouldRun(10, 20, true), false);
  assert.equal(clock.shouldRun(5000, 20, true), true);
  assert.equal(clock.shouldRun(5010, 20, true), false);
  assert.equal(clock.shouldRun(5010, 12, true), true);
  assert.equal(clock.shouldRun(5011, 12, false), true);
  assert.equal(clock.shouldRun(0, 12, true), true);
  clock.reset();
  assert.equal(clock.shouldRun(1, 12, true), true);
});

// Record GL render targets and pass counts.
// This checks the real pipeline orchestration, without pretending to test GPU speed.
test('mask passes run only on updates, stay bounded, and preserve full-size output', async () => {
  let id = 0, target = null, viewport = [], unit = 0, program = null;
  const attachments = new Map(), boundTextures = new Map(), draws = [];
  const constants = new Map(), samplers = new Map(), failures = [], deleted = new Set();
  const gl = new Proxy({
    useProgram: value => { program = value; },
    uniform1i: (name, value) => {
      if (!samplers.has(program)) samplers.set(program, new Map());
      samplers.get(program).set(name, value);
    },
    deleteTexture: texture => {
      if (deleted.has(texture)) failures.push('Texture deleted twice');
      deleted.add(texture);
    },
    createTexture: () => ({ id: ++id }),
    createFramebuffer: () => ({ id: ++id }),
    createProgram: () => ({ id: ++id }),
    createShader: () => ({ id: ++id }),
    createVertexArray: () => ({ id: ++id }),
    createBuffer: () => ({ id: ++id }),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_p, name) => name,
    checkFramebufferStatus: () => gl.FRAMEBUFFER_COMPLETE,
    bindFramebuffer: (_type, value) => { target = value; },
    activeTexture: value => { unit = value; },
    bindTexture: (_type, value) => { boundTextures.set(unit, value); },
    framebufferTexture2D: (_a, _b, _c, texture) => attachments.set(target, texture),
    viewport: (...values) => { viewport = values; },
    drawArrays: () => {
      if (target) {
        for (const sampler of samplers.get(program)?.values() ?? []) {
          if (boundTextures.get(gl.TEXTURE0 + sampler) === attachments.get(target)) {
            failures.push('Framebuffer feedback loop');
          }
        }
      }
      draws.push({ target, viewport: [...viewport] });
    },
  }, {
    get(object, key) {
      if (key in object) return object[key];
      if (/^[A-Z0-9_]+$/.test(key)) {
        if (!constants.has(key)) constants.set(key, /^TEXTURE[0-9]+$/.test(key) ? 10000 + Number(key.slice(7)) : ++id);
        return constants.get(key);
      }
      return () => {};
    },
  });
  const original = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return gl; }
  };
  let updated = true, moving = false, closed = 0, destroyed = 0;
  const pipeline = createGregblurBackgroundPipeline({
    async init() {},
    segment: () => ({ confidenceTexture: {}, updated, moving, close: () => closed++ }),
    destroy: () => destroyed++,
  });
  try {
    await pipeline.init(640, 480);
    const render = (source, time) => {
      draws.length = 0;
      pipeline.processFrame(source, time);
      return [...draws];
    };
    const camera = { width: 640, height: 480 };
    const first = render(camera, 0);
    assert.equal(first.length, 6); // orientation, refine, background x3, composite
    assert.deepEqual(first[1].viewport, [0, 0, 320, 240]);
    assert.deepEqual(first.at(-1).viewport, [0, 0, 640, 480]);
    assert.equal(render(camera, 50).length, 7); // smoothing without a history copy
    assert.equal(render(camera, 60).length, 7); // repeated swaps remain feedback-free
    updated = false;
    assert.equal(render(camera, 66).length, 5); // no refine, smooth or history copy
    assert.deepEqual(pipeline.getState().maskSize, { width: 320, height: 240 });
    render({ width: 1920, height: 1080 }, 100);
    assert.deepEqual(pipeline.getState().maskSize, { width: 320, height: 180 });
    assert.deepEqual(pipeline.getState().outputSize, { width: 1920, height: 1080 });
    pipeline.setEffect({ mode: 'none' });
    assert.equal(render(camera, 133).length, 2);
    pipeline.setEffect({ mode: 'blur' });
    assert.equal(render(camera, 166).length, 6); // history reset
    moving = true;
    updated = true;
    assert.equal(render(camera, 200).length, 6); // motion bypasses history
    assert.equal(render(camera, 233).length, 6); // repeated motion swaps
    moving = false;
    assert.equal(render(camera, 266).length, 7); // history resumes safely
    assert.equal(closed, 9);
  } finally {
    pipeline.destroy();
    assert.equal(destroyed, 1);
    assert.deepEqual(failures, []);
    if (original === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = original;
  }
});

const healthy = {
  longTaskRatio: 0, slowFrameRatio: 0, estimatedVisionLoad: 0.30,
  tasks: { 'background-segmenter': { active: true, averageDurationMs: 8, estimatedLoad: 0.16 } },
};
test('fast inference borrows headroom without removing resource limits', () => {
  assert.equal(getHeadroomSegmentationFps(20, healthy, true), 30);
  assert.equal(getHeadroomSegmentationFps(12, healthy, true), 30);
  assert.equal(getHeadroomSegmentationFps(20, healthy, false), 20); // warmup/pressure/recovery
  for (const patch of [
    { estimatedVisionLoad: 0.50 },
    { longTaskRatio: 0.04 },
    { slowFrameRatio: 0.08 },
    { tasks: {} },
    { tasks: { 'background-segmenter': { active: true, averageDurationMs: 20, estimatedLoad: 0.16 } } },
    { tasks: { 'background-segmenter': { active: false, averageDurationMs: 8, estimatedLoad: 0.16 } } },
  ]) assert.equal(getHeadroomSegmentationFps(20, { ...healthy, ...patch }, true), 20);
});
test('history decays in source time and expires across stalls or rewinds', () => {
  const at30 = getMaskHistoryWeight(0.12, 1000 / 30, 0);
  const at12 = getMaskHistoryWeight(0.12, 1000 / 12, 0);
  assert.ok(Math.abs(at30 - 0.12) < 1e-8);
  assert.ok(at12 < 0.005);
  assert.equal(getMaskHistoryWeight(0.12, 300, 0), 0);
  assert.equal(getMaskHistoryWeight(0.12, 0, 100), 0);
  assert.equal(getMaskHistoryWeight(0.12, 100, -Infinity), 0);
});

test('local movement triggers refresh; exposure and sensor noise do not', () => {
 const still = new Float32Array(768).fill(80);
 assert.equal(hasSignificantMotion(still, null), false);
 assert.equal(hasSignificantMotion(still, still), false);
 assert.equal(hasSignificantMotion(still.map(v=>v+30), still), false);
 assert.equal(hasSignificantMotion(still.map((v,i)=>v+(i%3-1)*4), still), false);
 const moving = still.slice();
 moving.fill(160, 100, 160);
 assert.equal(hasSignificantMotion(moving, still), true);
});
test('motion boost requires measured capacity and stops under pressure', () => {
 const state = { ...healthy, estimatedVisionLoad: 0.31,
   tasks: { 'background-segmenter': { active: true, averageDurationMs: 13, estimatedLoad: 0.26 } } };
 assert.equal(getMotionSegmentationFps(20,state,true),30);
 assert.equal(getMotionSegmentationFps(20,state,false),20);
 assert.equal(getMotionSegmentationFps(20,{...state,estimatedVisionLoad:0.6},true),20);
 assert.equal(getMotionSegmentationFps(20,{...state,slowFrameRatio:0.2},true),20);
 assert.equal(getMotionSegmentationFps(20,{...state,tasks:{}},true),20);
});
test('motion reference advances only when a mask is accepted; failed sampling disables cleanly', () => {
 const original = globalThis.OffscreenCanvas;
 let bright = false, fail = false;
 globalThis.OffscreenCanvas = class {
  getContext() {return {
   drawImage() {if(fail) throw new Error('readback unavailable');},
   getImageData() {
    const data = new Uint8ClampedArray(768*4).fill(80);
    if(bright) data.fill(160,100*4,160*4);
    return {data};
   },
  };}
 };
 try {
  const detector=createMaskMotionDetector();
  assert.equal(detector.sample({}),false);
  detector.commit();
  bright=true;
  assert.equal(detector.sample({}),true);
  assert.equal(detector.sample({}),true); // skipped inference retains reference
  detector.commit();
  assert.equal(detector.sample({}),false);
  fail=true;
  assert.equal(detector.sample({}),false);
  assert.equal(detector.getState().disabledReason,'readback unavailable');
  detector.reset();
  assert.equal(detector.getState().disabledReason,null);
 } finally {
  if(original===undefined) delete globalThis.OffscreenCanvas;
  else globalThis.OffscreenCanvas=original;
 }
});
