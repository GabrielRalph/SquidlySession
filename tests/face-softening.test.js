import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { FaceSoftener } from "../src/Features/VideoCall/face-softener.js";

// 这些测试检查状态和绘图调用，不代替摄像头上的画质 / GPU 性能测试。
class FakeContext {
  filter = "none";
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  fillStyle = "black";
  calls = [];
  stack = [];
  clearRect(...args) { this.calls.push(["clear", ...args]); }
  drawImage(...args) {
    this.calls.push(["composite", this.globalCompositeOperation]);
    this.calls.push(["draw", this.filter, this.globalAlpha, ...args]);
  }
  save() { this.stack.push([this.filter, this.globalAlpha, this.globalCompositeOperation, this.fillStyle]); }
  restore() { [this.filter, this.globalAlpha, this.globalCompositeOperation, this.fillStyle] = this.stack.pop(); }
  beginPath() {}
  moveTo(...args) { this.calls.push(["move", ...args]); }
  lineTo() {}
  closePath() {}
  rect() {}
  ellipse(...args) { this.calls.push(["ellipse", ...args]); }
  clip(rule) { this.calls.push(["clip", rule]); }
  fill() { this.calls.push(["fill", this.filter]); }
  fillRect(...args) { this.calls.push(["fillRect", this.globalCompositeOperation, this.fillStyle, ...args]); }
  translate() {}
  scale() {}
  setTransform(...args) { this.calls.push(["transform", ...args]); }
  createRadialGradient() {
    const stops = [];
    return { stops, addColorStop: (...args) => stops.push(args) };
  }
}

class FakeCanvas {
  width = 300;
  height = 150;
  context = new FakeContext();
  getContext() { return this.context; }
}

function installGlobals(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    });
  }
}

const outline = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

function facePoints() {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  outline.forEach((index, i) => {
    const angle = i / outline.length * Math.PI * 2 - Math.PI / 2;
    points[index] = { x: 0.5 + 0.2 * Math.cos(angle), y: 0.5 + 0.3 * Math.sin(angle) };
  });
  const regions = [
    [[33, 133, 159, 145, 70, 63, 105, 66, 107], 0.41, 0.41],
    [[362, 263, 386, 374, 336, 296, 334, 293, 300], 0.59, 0.41],
    [[61, 291, 0, 17, 13, 14, 40, 270, 91, 321], 0.5, 0.64],
  ];
  for (const [indices, x, y] of regions) indices.forEach((index, i) => {
    points[index] = { x: x + (i % 2 ? 0.04 : -0.04), y: y + (i % 3 ? 0.02 : -0.02) };
  });
  return points;
}

function softenerHarness(t) {
  installGlobals(t, { document: { createElement: () => new FakeCanvas() } });
  const model = {
    calls: [], points: facePoints(), closed: 0,
    detectForVideo(frame, timestamp) {
      this.calls.push({ frame, timestamp });
      return { faceLandmarks: this.points ? [this.points] : [] };
    },
    close() { this.closed++; },
  };
  return { model, softener: new FaceSoftener(model), frame: { width: 480, height: 360 } };
}

test("zero strength bypasses inference and drawing", t => {
  const { model, softener, frame } = softenerHarness(t);
  assert.equal(softener.apply(frame, 0, 1), frame);
  assert.equal(model.calls.length, 0);
  assert.equal(softener.context.calls.length, 0);
});

test("softening uses a feathered mask, protects features and restores canvas state", t => {
  const { model, softener, frame } = softenerHarness(t);
  assert.equal(softener.apply(frame, 50, 1), softener.output);
  assert.equal(model.calls[0].frame, frame);
  const draws = softener.context.calls.filter(c => c[0] === "draw");
  assert.equal(draws.length, 3);
  assert.match(draws[0][1], /^blur\(/);
  assert.equal(draws[0][2], 0.3);
  assert.equal(draws[0][3], frame);
  assert.equal(draws[1][1], "none");
  assert.equal(draws[1][2], 1);
  assert.equal(draws[1][3], softener.mask);
  assert.equal(draws[2][1], "none");
  assert.equal(draws[2][2], 1);
  assert.equal(draws[2][3], frame);
  assert.deepEqual(softener.context.calls.filter(c => c[0] === "composite").map(c => c[1]),
    ["source-over", "destination-in", "destination-over"]);
  const maskCalls = softener.maskContext.calls;
  assert.match(maskCalls.find(c => c[0] === "fill")[1], /^blur\(/);
  const holes = maskCalls.filter(c => c[0] === "fillRect");
  assert.equal(holes.length, 3);
  for (const hole of holes) {
    assert.equal(hole[1], "destination-out");
    assert.deepEqual(hole[2].stops, [[0, "white"], [0.65, "white"], [1, "rgba(255, 255, 255, 0)"]]);
  }
  assert.equal(maskCalls.filter(c => c[0] === "clip").length, 0);
  assert.equal(maskCalls.filter(c => c[0] === "transform").length, 3);
  for (const ctx of [softener.context, softener.maskContext]) {
    assert.equal(ctx.filter, "none");
    assert.equal(ctx.globalAlpha, 1);
    assert.equal(ctx.globalCompositeOperation, "source-over");
    assert.equal(ctx.stack.length, 0);
  }
});

test("detection is rate limited but rendering uses the latest frame", t => {
  const { model, softener, frame } = softenerHarness(t);
  softener.apply(frame, 50, 0);
  const next = { width: 480, height: 360 };
  softener.apply(next, 50, 20);
  assert.equal(model.calls.length, 1);
  assert.equal(softener.context.calls.filter(c => c[0] === "draw").at(-3)[3], next);
  assert.equal(softener.maskContext.calls.filter(c => c[0] === "fill").length, 1);
  softener.apply(next, 50, 67);
  assert.equal(model.calls.length, 2);
  assert.equal(softener.maskContext.calls.filter(c => c[0] === "fill").length, 2);
});

test("lost faces fade briefly then discard old geometry even between detections", t => {
  const { model, softener, frame } = softenerHarness(t);
  softener.apply(frame, 100, 0);
  model.points = null;
  const current = { width: 480, height: 360 };
  assert.equal(softener.apply(current, 100, 70), softener.output);
  const alpha = () => softener.context.calls.filter(c => c[0] === "draw").at(-3)[2];
  assert(alpha() > 0 && alpha() < 0.6);
  assert.equal(softener.context.calls.filter(c => c[0] === "draw").at(-3)[3], current);
  softener.apply(current, 100, 140);
  assert(alpha() < 0.1);
  // 160ms 已过期，不等待下一次定位，也不因连续丢失而延长截止时间。
  assert.equal(softener.apply(current, 100, 161), current);
  assert.equal(softener.face, null);
  assert.equal(softener.apply(current, 100, 230), current);
  model.points = facePoints();
  assert.equal(softener.apply(current, 100, 300), softener.output);
});

test("partially visible faces are processed but completely offscreen faces are skipped", t => {
  const { model, softener, frame } = softenerHarness(t);
  model.points = facePoints().map(p => ({ x: p.x - 0.4, y: p.y }));
  assert.equal(softener.apply(frame, 100, 0), softener.output);
  assert(softener.face.x < 0);
  softener.reset();
  model.points = facePoints().map(p => ({ x: p.x - 2, y: p.y }));
  assert.equal(softener.apply(frame, 100, 100), frame);
});

test("invalid faces are skipped; resize, zero and close discard old geometry", t => {
  const { model, softener, frame } = softenerHarness(t);
  model.points[10].x = NaN;
  assert.equal(softener.apply(frame, 50, 0), frame);
  model.points = facePoints();
  softener.apply(frame, 50, 100);
  model.points = null;
  const resized = { width: 640, height: 480 };
  assert.equal(softener.apply(resized, 50, 110), resized);
  assert.equal(softener.face, null);
  assert.equal(softener.mask.width, 640);
  assert.equal(softener.output.height, 480);
  model.points = facePoints();
  softener.apply(resized, 50, 200);
  assert.equal(softener.apply(resized, 0, 210), resized);
  assert.equal(softener.face, null);
  softener.close();
  softener.close();
  assert.equal(model.closed, 1);
  for (const canvas of [softener.output, softener.mask]) {
    assert.equal(canvas.width, 1);
    assert.equal(canvas.height, 1);
  }
  assert.equal(softener.apply(frame, 50, 300), frame);
});

test("failed rendering still restores drawing state", t => {
  const { softener, frame } = softenerHarness(t);
  t.mock.method(softener.context, "drawImage", () => { throw Error("draw failure"); });
  assert.throws(() => softener.apply(frame, 100, 0), /draw failure/);
  assert.equal(softener.context.filter, "none");
  assert.equal(softener.context.globalAlpha, 1);
  assert.equal(softener.context.globalCompositeOperation, "source-over");
  assert.equal(softener.context.stack.length, 0);
  softener.close();
});

test("failed mask drawing still restores drawing state", t => {
  const { softener, frame } = softenerHarness(t);
  t.mock.method(softener.maskContext, "fillRect", () => { throw Error("mask failure"); });
  assert.throws(() => softener.apply(frame, 100, 0), /mask failure/);
  assert.equal(softener.maskContext.filter, "none");
  assert.equal(softener.maskContext.globalCompositeOperation, "source-over");
  assert.equal(softener.maskContext.stack.length, 0);
  softener.close();
});

function source(file) {
  return fs.readFileSync(new URL("../src/Features/VideoCall/" + file, import.meta.url), "utf8");
}
function withoutImports(code) {
  return code.replace(/^import[\s\S]*?from\s*"[^"]+";\r?\n/gm, "");
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function pipelineHarness(t, createOverride) {
  const outputTrack = { enabled: true, stops: 0, stop() { this.stops++; } };
  const cameraTrack = { kind: "video", enabled: true };
  const audioTrack = { kind: "audio" };
  const input = {
    getVideoTracks: () => [cameraTrack], getAudioTracks: () => [audioTrack],
    addEventListener() {}, removeEventListener() {},
  };
  const video = {
    readyState: 2, videoWidth: 640, videoHeight: 480, style: {}, pending: null,
    setAttribute() {}, play: async () => {}, pause() {}, remove() {},
    requestVideoFrameCallback(callback) { this.pending = callback; return 1; },
    cancelVideoFrameCallback() { this.pending = null; },
    tick() { const callback = this.pending; this.pending = null; callback(); },
  };
  const canvases = [];
  installGlobals(t, {
    document: { body: { append() {} }, createElement(type) {
      if (type === "video") return video;
      const canvas = new FakeCanvas();
      canvas.captureStream = () => ({ getVideoTracks: () => [outputTrack] });
      canvases.push(canvas);
      return canvas;
    } },
    window: { addEventListener() {}, removeEventListener() {} },
    MediaStream: class { constructor(tracks) { this.tracks = tracks; } },
  });
  const segmentation = [], rendering = [], faceCalls = [];
  let inCallback = false, loads = 0;
  class Segmenter {
    constructor(name) { this.name = name; this.webglContext = {}; this.invertMask = name === "standard"; }
    async load() {}
    segment(frame, timestamp, draw) {
      segmentation.push({ frame, name: this.name });
      inCallback = true;
      try { draw({}); } finally { inCallback = false; }
    }
    close() {}
  }
  class Renderer {
    draw(...args) { assert(inCallback, "render must stay inside mask callback"); rendering.push(args); }
  }
  const softened = { width: 480, height: 360, softened: true };
  const instance = {
    closed: 0, fail: false,
    apply(...args) { if (this.fail) throw Error("GPU test failure"); faceCalls.push(args); return softened; },
    reset() {}, close() { this.closed++; },
  };
  const factory = { create() { loads++; return createOverride ? createOverride() : Promise.resolve(instance); } };
  const create = new Function("BackgroundRenderer", "Segmenter", "FaceSoftener",
    withoutImports(source("background.js")).replace("export async function", "return async function")
  )(Renderer, Segmenter, factory);
  const effect = await create(input, error => { throw error; });
  return { effect, instance, video, canvases, segmentation, rendering, faceCalls, softened,
    outputTrack, audioTrack, loads: () => loads };
}

test("both models and all background modes support face softening without changing tracks", async t => {
  const h = await pipelineHarness(t);
  const stream = h.effect.stream;
  assert.equal(h.loads(), 0);
  await h.effect.setFaceSoftening(50);
  h.video.tick();
  assert.equal(h.rendering.at(-1)[3], h.softened);
  assert.notEqual(h.segmentation.at(-1).frame, h.softened);
  await h.effect.setModel("lightweight");
  h.video.tick();
  assert.equal(h.segmentation.at(-1).name, "lightweight");
  assert.equal(h.rendering.at(-1)[3], h.softened);
  const background = {};
  h.effect.setImage(background);
  h.video.tick();
  assert.equal(h.rendering.at(-1)[2], background);
  h.effect.setMode("none");
  const count = h.segmentation.length;
  h.video.tick();
  assert.equal(h.segmentation.length, count);
  assert.equal(h.canvases[1].context.calls.at(-1)[3], h.softened);
  await h.effect.setFaceSoftening(0);
  const faceCount = h.faceCalls.length;
  h.video.tick();
  assert.equal(h.faceCalls.length, faceCount);
  assert.equal(h.effect.stream, stream);
  assert.equal(stream.tracks[1], h.audioTrack);
  assert.equal(h.loads(), 1);
  h.effect.stop();
  assert.equal(h.instance.closed, 1);
  assert.equal(h.outputTrack.stops, 1);
});

test("turning off during loading does not re-enable the effect", async t => {
  const pending = deferred();
  const h = await pipelineHarness(t, () => pending.promise);
  const loading = h.effect.setFaceSoftening(40);
  await h.effect.setFaceSoftening(0);
  pending.resolve(h.instance);
  await loading;
  assert.equal(h.effect.getState().faceSoftening, 0);
  h.effect.stop();
});

test("stopping during loading closes the late model", async t => {
  const pending = deferred();
  const h = await pipelineHarness(t, () => pending.promise);
  const loading = h.effect.setFaceSoftening(40);
  h.effect.stop();
  pending.resolve(h.instance);
  await assert.rejects(loading, /cancelled/);
  assert.equal(h.instance.closed, 1);
});

test("softening failure turns off only the effect and reports the error", async t => {
  const h = await pipelineHarness(t);
  t.mock.method(console, "warn", () => {});
  let notified;
  h.effect.onFaceSofteningError(error => { notified = error; });
  await h.effect.setFaceSoftening(40);
  h.instance.fail = true;
  h.video.tick();
  assert.match(notified.message, /GPU test failure/);
  assert.equal(h.effect.getState().faceSoftening, 0);
  assert.equal(h.effect.getState().running, true);
  assert.equal(h.outputTrack.stops, 0);
  assert.equal(h.rendering.at(-1)[0], h.rendering.at(-1)[3]);
  h.effect.stop();
});

test("model load failures can be retried and invalid strengths are rejected", async t => {
  let attempt = 0;
  let instance;
  const h = await pipelineHarness(t, () => ++attempt === 1
    ? Promise.reject(Error("load test failure")) : Promise.resolve(instance));
  instance = h.instance;
  await assert.rejects(h.effect.setFaceSoftening(NaN), /between/);
  await assert.rejects(h.effect.setFaceSoftening(101), /between/);
  await assert.rejects(h.effect.setFaceSoftening(30), /load test failure/);
  assert.equal(h.effect.getState().running, true);
  await h.effect.setFaceSoftening(30);
  assert.equal(h.effect.getState().faceSoftening, 30);
  h.effect.stop();
});

test("renderer keeps the raw background and selects softened foreground for both models", t => {
  installGlobals(t, { document: { createElement: () => new FakeCanvas() } });
  const calls = [];
  class DrawingUtils { drawConfidenceMask(...args) { calls.push(args); } }
  const Renderer = new Function("DrawingUtils", withoutImports(source("background-renderer.js"))
    .replace("export class", "class") + "\nreturn BackgroundRenderer;")(DrawingUtils);
  const frame = { width: 480, height: 360 }, foreground = {}, mask = {};
  for (const invert of [false, true]) {
    const renderer = new Renderer(new FakeCanvas(), {}, invert);
    renderer.draw(frame, mask, null, foreground);
    assert.equal(calls.at(-1)[invert ? 1 : 2], foreground);
    assert.equal(renderer.backgroundContext.calls.find(c => c[0] === "draw")[3], frame);
  }
});

test("face model asset exists and is a static relURL recognized by the build plugin", () => {
  const match = source("face-softener.js").match(/relURL\("([^"]+)", import\.meta\)/);
  assert(match);
  const asset = new URL("../src/Features/VideoCall/" + match[1], import.meta.url);
  assert(fs.statSync(asset).size > 1000000);
});

test("popup keeps six presets and upload working beside the softening slider", async t => {
  class Element {
    children = [];
    listeners = {};
    style = {};
    value = "";
    disabled = false;
    files = [];
    append(...children) { this.children.push(...children); }
    addEventListener(event, callback) { (this.listeners[event] ??= []).push(callback); }
    querySelectorAll() { return this.children; }
    async emit(event) { for (const callback of this.listeners[event] ?? []) await callback(); }
  }
  const mode = new Element(), file = new Element(), slider = new Element();
  const value = new Element(), model = new Element(), status = new Element();
  const container = new Element(), imageOption = new Element();
  mode.querySelector = () => imageOption;
  const selectors = {
    'select[name="mode"]': mode, 'input[type="file"]': file,
    '[name="faceSoftening"]': slider, '[name="faceSofteningValue"]': value,
    '[role=status]': status, '[data-background-presets]': container,
    'select[name="model"]': model,
  };
  const dialog = new Element();
  dialog.querySelector = selector => {
    assert(selectors[selector], "unexpected or ambiguous selector: " + selector);
    return selectors[selector];
  };
  installGlobals(t, {
    document: { body: new Element(), createTextNode: text => text,
      createElement: tag => tag === "dialog" ? dialog : new Element() },
    window: { addEventListener() {} },
    Image: class extends Element { async decode() {} },
  });
  const revoked = [];
  t.mock.method(URL, "createObjectURL", () => "blob:test");
  t.mock.method(URL, "revokeObjectURL", url => revoked.push(url));
  const state = { running: true, model: "standard", faceSoftening: 0, faceSofteningReady: false };
  const pending = deferred();
  const applied = [];
  const effect = {
    getState: () => state,
    onFaceSofteningError(callback) { this.faceError = callback; },
    async setFaceSoftening(amount) {
      if (!state.faceSofteningReady) await pending.promise;
      state.faceSofteningReady = true;
      state.faceSoftening = amount;
    },
    setImage: image => applied.push(image), setMode() {},
    async setModel(name) { state.model = name; },
  };
  const code = source("video-call.js");
  const start = code.indexOf("_setupBackgroundControls() {");
  const end = code.indexOf("async initialise()", start);
  assert(start >= 0 && end > start);
  const presets = Array.from({ length: 6 }, (_, i) => ({ name: "Preset " + i, url: "image" + i }));
  const holder = new Function("BACKGROUND_PRESETS", "return ({" + code.slice(start, end) + "});")(presets);
  holder._backgroundEffect = effect;
  holder.session = { toolBar: { addMenuItems() {} } };
  holder._setupBackgroundControls();
  assert.equal(container.children.length, 6);
  assert.equal(file.listeners.change.length, 1);
  assert.equal(value.value, "0%");
  slider.value = "50";
  const loading = slider.emit("input");
  assert.equal(slider.disabled, true);
  assert.equal(file.disabled, true);
  assert(container.children.every(button => button.disabled));
  pending.resolve();
  await loading;
  assert.equal(value.value, "50%");
  assert.equal(file.disabled, false);
  slider.value = "65";
  const dragging = slider.emit("input");
  assert.equal(slider.disabled, false, "ready slider must allow continuous dragging");
  await dragging;
  for (const button of container.children) {
    assert.equal(button.type, "button");
    await button.emit("click");
  }
  file.files = [{ name: "photo.jpg" }];
  await file.emit("change");
  assert.equal(applied.length, 7);
  assert.deepEqual(revoked, ["blob:test"]);
  assert.equal(container.children.length, 6);
  model.value = "lightweight";
  await model.emit("change");
  assert.equal(state.model, "lightweight");
  assert.equal(state.faceSoftening, 65);
  state.faceSoftening = 0;
  effect.faceError(Error("test failure"));
  assert.equal(value.value, "0%");
  assert.match(status.textContent, /test failure/);
});
