# DeepFilterNet Video-Call Denoising Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local DeepFilterNet3 microphone adapter and make it the default denoiser in Squidly video calls while preserving RNNoise as commented rollback code.

**Architecture:** A dedicated module Worker owns ONNX Runtime, the model session, and its recurrent state. A directly connected `MessageChannel` carries one 480-sample frame at a time between the Worker and an AudioWorklet; the worklet bounds pending input to eight frames, so the feature needs no `SharedArrayBuffer`, cross-origin isolation, or new response headers.

**Tech Stack:** Browser JavaScript modules, Web Audio AudioWorklet, Web Workers, transferable MessagePorts and ArrayBuffers, ONNX Runtime Web 1.27.0, Rollup 4, Node's built-in test runner.

## Global Constraints

- Keep all new implementation files in `src/Features/VideoCall/AudioUtils/DeepFilterNet/`.
- Preserve `src/Features/VideoCall/AudioUtils/NoiseSuppress/` unchanged.
- Copy the local 15 MB model from `/Users/poyaohuang/dev/side-project/denoise/public/dfn/denoiser_model.onnx`; expected SHA-256: `fe5eb64fa2e4154c83f8e4935e82871c850c154387ee892e0ab65fe179e7d8c9`.
- Use 48,000 Hz mono audio, 480-sample frames, and 45,304 recurrent state floats.
- Bundle the model and ONNX Runtime WebAssembly locally; do not use a CDN.
- Run inference only in the dedicated Worker, never on the page or AudioWorklet rendering thread.
- Use `MessageChannel`, not `SharedArrayBuffer`; require no COOP/COEP headers.
- Allow one inference frame in flight and at most eight queued input frames; discard the oldest queued frame on overflow.
- Output silence until processed audio is available and during underruns.
- Preserve the existing adapter lifecycle field `_noiseSuppressionAdapter`.
- Comment both the RNNoise import and active call in `video-call.js`; do not delete them.
- Follow strict red-green-refactor for every production behavior.

---

## File Structure

- `deepfilternet-model.js`: constants, tensor feed validation, and output validation.
- `deepfilternet-worker-host.js`: stateful runtime orchestration independent of Worker globals.
- `deepfilternet-worker-client.js`: initialization and MessagePort connection API for the page.
- `deepfilternet-worker-source.js`: actual Worker global and ONNX Runtime implementation.
- `deepfilternet-worker.js`: generated standalone module-Worker bundle used at runtime.
- `deepfilternet-worklet-core.js`: testable frame assembly, queueing, backpressure, and output logic.
- `deepfilternet-worklet-source.js`: AudioWorklet global wrapper around the core.
- `deepfilternet-worklet.js`: generated standalone AudioWorklet bundle used at runtime.
- `deepfilternet.js`: WebRTC-compatible stream adapter and resource lifecycle.
- `denoiser_model.onnx`: local DeepFilterNet3 model.
- `ort-wasm-simd-threaded.wasm`: local single-threaded ONNX Runtime binary (the filename is upstream-defined even with `numThreads = 1`).

---

### Task 1: Local model contract and ONNX runtime assets

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-model.js`
- Create: `src/Features/VideoCall/AudioUtils/DeepFilterNet/denoiser_model.onnx`
- Create: `src/Features/VideoCall/AudioUtils/DeepFilterNet/ort-wasm-simd-threaded.wasm`
- Test: `tests/deepfilternet-model.test.js`

**Interfaces:**
- Consumes: `onnxruntime-web@1.27.0` and its `Tensor` constructor.
- Produces: `DFN_SAMPLE_RATE`, `DFN_FRAME_SIZE`, `DFN_STATE_SIZE`, `createDeepFilterNetFeeds(TensorClass, frame, state)`, and `readDeepFilterNetOutputs(outputs)`.

- [ ] **Step 1: Add failing model-contract tests**

```js
test("DeepFilterNet feeds use the model's exact names and dimensions", () => {
  const feeds = createDeepFilterNetFeeds(
    FakeTensor,
    new Float32Array(480),
    new Float32Array(45_304),
  );
  assert.deepEqual(Object.keys(feeds), ["input_frame", "states", "atten_lim_db"]);
  assert.deepEqual(feeds.input_frame.dims, [480]);
  assert.deepEqual(feeds.states.dims, [45_304]);
  assert.deepEqual(feeds.atten_lim_db.data, new Float32Array([0]));
});

test("DeepFilterNet rejects frames and recurrent state with invalid lengths", () => {
  assert.throws(
    () => createDeepFilterNetFeeds(FakeTensor, new Float32Array(479), new Float32Array(45_304)),
    /frame length/i,
  );
  assert.throws(
    () => createDeepFilterNetFeeds(FakeTensor, new Float32Array(480), new Float32Array(45_303)),
    /state length/i,
  );
});

test("DeepFilterNet rejects malformed model outputs", () => {
  assert.throws(
    () => readDeepFilterNetOutputs({
      enhanced_audio_frame: { data: new Float32Array(479) },
      new_states: { data: new Float32Array(45_304) },
    }),
    /output frame/i,
  );
});
```

- [ ] **Step 2: Run the model test and verify RED**

Run: `node --test tests/deepfilternet-model.test.js`

Expected: FAIL because `deepfilternet-model.js` does not exist.

- [ ] **Step 3: Implement the minimal model contract**

```js
export const DFN_SAMPLE_RATE = 48_000;
export const DFN_FRAME_SIZE = 480;
export const DFN_STATE_SIZE = 45_304;

export function createDeepFilterNetFeeds(TensorClass, frame, state) {
  if (frame.length !== DFN_FRAME_SIZE) throw new RangeError("Invalid DeepFilterNet frame length.");
  if (state.length !== DFN_STATE_SIZE) throw new RangeError("Invalid DeepFilterNet state length.");
  return {
    input_frame: new TensorClass("float32", frame, [DFN_FRAME_SIZE]),
    states: new TensorClass("float32", state, [DFN_STATE_SIZE]),
    atten_lim_db: new TensorClass("float32", new Float32Array([0]), [1]),
  };
}
```

`readDeepFilterNetOutputs()` must require `Float32Array` values of lengths 480 and 45,304 and return `{ frame, state }`.

- [ ] **Step 4: Install and copy the exact local assets**

Run: `npm install onnxruntime-web@1.27.0`

Copy the reference model to the new feature directory and copy
`node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm` beside it.
Verify the model with:

Run: `shasum -a 256 src/Features/VideoCall/AudioUtils/DeepFilterNet/denoiser_model.onnx`

Expected: `fe5eb64fa2e4154c83f8e4935e82871c850c154387ee892e0ab65fe179e7d8c9`.

- [ ] **Step 5: Run the model test and full existing suite to verify GREEN**

Run: `node --test tests/deepfilternet-model.test.js && npm test`

Expected: both commands pass with zero failures.

- [ ] **Step 6: Commit the model contract**

```bash
git add package.json package-lock.json tests/deepfilternet-model.test.js src/Features/VideoCall/AudioUtils/DeepFilterNet
git commit -m "feat: add local DeepFilterNet model contract"
```

---

### Task 2: Stateful inference Worker and page client

**Files:**
- Create: `src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worker-host.js`
- Create: `src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worker-client.js`
- Create: `src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worker-source.js`
- Test: `tests/deepfilternet-worker.test.js`

**Interfaces:**
- Consumes: model constants and validation from Task 1.
- Produces: `DeepFilterNetWorkerHost`, `DeepFilterNetWorkerClient`, and `createDeepFilterNetWorkerClient(worker)`; request types are `initialize` and `connect`, while port messages are `process`, `processed`, and `error`.

- [ ] **Step 1: Add failing Worker-host tests for recurrent state and errors**

```js
test("Worker passes returned recurrent state to the next frame", async () => {
  const seenStates = [];
  const runtime = {
    initialize: async () => {},
    processFrame: async (frame, state) => {
      seenStates.push(state[0]);
      const nextState = state.slice();
      nextState[0] += 1;
      return { frame: frame.slice(), state: nextState };
    },
  };
  const host = new DeepFilterNetWorkerHost(() => runtime);
  await host.initialize("/model.onnx", "/ort.wasm");
  await host.process(new Float32Array(480));
  await host.process(new Float32Array(480));
  assert.deepEqual(seenStates, [0, 1]);
});

test("Worker host rejects inference before initialization", async () => {
  const host = new DeepFilterNetWorkerHost(() => ({}));
  await assert.rejects(() => host.process(new Float32Array(480)), /not initialized/i);
});
```

Also test that `attachPort()` processes a transferred frame, transfers the 480-sample result back, and responds with `{ type: "error", message }` when runtime inference throws.

- [ ] **Step 2: Run Worker tests and verify RED**

Run: `node --test tests/deepfilternet-worker.test.js`

Expected: FAIL because the Worker host and client modules do not exist.

- [ ] **Step 3: Implement the stateful Worker host**

`initialize(modelUrl, wasmUrl)` creates the runtime, awaits its initialization, validates a zero-frame inference as a startup probe, and then resets recurrent state to all zeros. `process(frame)` validates the 480 samples, awaits exactly one runtime call, validates output, stores the returned state, and returns the enhanced frame. `attachPort(port)` installs the `process`/`processed` transfer protocol and calls `port.start?.()`.

- [ ] **Step 4: Implement the page Worker client**

```js
export class DeepFilterNetWorkerClient {
  constructor(worker) {
    this.worker = worker;
    this.nextId = 1;
    this.pending = new Map();
    worker.onmessage = ({ data }) => this._handleResponse(data);
    worker.onerror = ({ message }) => this._rejectAll(new Error(message));
  }
  initialize(modelUrl, wasmUrl) {
    return this._request({ type: "initialize", modelUrl, wasmUrl });
  }
  connect(port) {
    return this._request({ type: "connect", port }, [port]);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    this._rejectAll(new Error("DeepFilterNet worker was closed."));
  }
  _request(message, transfer = []) {
    if (this.closed) return Promise.reject(new Error("DeepFilterNet worker was closed."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id }, transfer);
    });
  }
}
```

The client must propagate Worker error events and `{ type: "error" }` replies as `Error` rejections. Tests assert observable promise resolution/rejection and termination, not fake call counts.

- [ ] **Step 5: Implement the real ONNX Worker source**

Import `{ env, InferenceSession, Tensor }` from `onnxruntime-web/wasm`. Set `env.wasm.numThreads = 1`, `env.wasm.proxy = false`, and `env.wasm.wasmPaths = { wasm: wasmUrl }` before `InferenceSession.create(modelUrl, { executionProviders: ["wasm"] })`. Call `session.run(createDeepFilterNetFeeds(Tensor, frame, state))` and pass its result through `readDeepFilterNetOutputs()`.

- [ ] **Step 6: Run Worker tests and full suite to verify GREEN**

Run: `node --test tests/deepfilternet-worker.test.js && npm test`

Expected: both commands pass with zero failures.

- [ ] **Step 7: Commit Worker orchestration**

```bash
git add tests/deepfilternet-worker.test.js src/Features/VideoCall/AudioUtils/DeepFilterNet
git commit -m "feat: add stateful DeepFilterNet worker"
```

---

### Task 3: Header-free AudioWorklet transport with bounded latency

**Files:**
- Create: `src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worklet-core.js`
- Create: `src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worklet-source.js`
- Test: `tests/deepfilternet-worklet.test.js`

**Interfaces:**
- Consumes: 480-sample frames and the Worker's `process`/`processed`/`error` port protocol.
- Produces: `DeepFilterNetWorkletBridge`, whose `process(inputChannels, outputChannel)` method is called for every render quantum and whose `connect(port)` method attaches the inference Worker.

- [ ] **Step 1: Add failing worklet-core tests**

Use literal sample fixtures to cover these observable behaviors:

```js
test("worklet assembles 480 mono samples and permits only one frame in flight", () => {
  const sent = [];
  const bridge = new DeepFilterNetWorkletBridge((frame) => sent.push(frame.slice()));
  for (let block = 0; block < 4; block += 1) {
    bridge.process([new Float32Array(128).fill(block + 1)], new Float32Array(128));
  }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 480);
  assert.deepEqual([...sent[0].slice(0, 128)], new Array(128).fill(1));
});

test("worklet emits silence until enhanced samples arrive", () => {
  const output = new Float32Array(128).fill(1);
  const bridge = new DeepFilterNetWorkletBridge(() => {});
  bridge.process([new Float32Array(128)], output);
  assert.deepEqual(output, new Float32Array(128));
});
```

Add tests proving stereo input is averaged to mono, a returned frame releases exactly one next queued frame, enhanced samples are emitted in order across 128-sample output boundaries, and a ninth queued frame discards the oldest of the eight pending frames.

- [ ] **Step 2: Run worklet tests and verify RED**

Run: `node --test tests/deepfilternet-worklet.test.js`

Expected: FAIL because the worklet core does not exist.

- [ ] **Step 3: Implement minimal frame and queue logic**

Maintain one 480-sample input accumulator, `pendingFrames` capped at eight, one `inFlight` flag, and an ordered enhanced-sample queue. `receiveProcessedFrame(frame)` validates 480 samples, queues it for output, clears `inFlight`, and immediately sends the oldest pending input. Overflow uses `pendingFrames.shift()` before appending the newest frame.

- [ ] **Step 4: Implement the AudioWorklet wrapper**

Register `DeepFilterNetWorkletProcessor`. Its built-in node port accepts `{ type: "connect", port }`, gives the port to the bridge, and forwards Worker error messages back to the page as `{ type: "error", message }`. `process(inputs, outputs)` downmixes all provided input channels, writes only the mono output channel, and always returns `true`.

- [ ] **Step 5: Run worklet tests and full suite to verify GREEN**

Run: `node --test tests/deepfilternet-worklet.test.js && npm test`

Expected: both commands pass with zero failures.

- [ ] **Step 6: Commit the real-time bridge**

```bash
git add tests/deepfilternet-worklet.test.js src/Features/VideoCall/AudioUtils/DeepFilterNet
git commit -m "feat: add header-free DeepFilterNet audio bridge"
```

---

### Task 4: WebRTC-compatible DeepFilterNet stream adapter

**Files:**
- Create: `src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet.js`
- Test: `tests/deepfilternet-adapter.test.js`

**Interfaces:**
- Consumes: runtime URLs, `DeepFilterNetWorkerClient`, generated Worker/worklet modules, and browser Web Audio/MediaStream APIs.
- Produces: `createDeepFilterNetAdapter(inputStream, options = {})`, returning `{ stream, audioTrack, context, node, close }` with the same contract as `createNoiseSuppressionAdapter()`.

- [ ] **Step 1: Add failing adapter lifecycle test**

Adapt the real fake browser boundary in `tests/noise-suppression-adapter.test.js`. Assert that the returned stream contains the original video track and generated audio track; the context is 48 kHz and running; the processor name is `DeepFilterNetWorkletProcessor`; a MessageChannel port reaches both Worker and worklet; audio device changes reconnect the source without replacing the generated output track; video changes propagate; and two `close()` calls terminate/close/stop each owned resource exactly once.

Add separate tests for non-48-kHz injected contexts and Worker initialization failure. Both must reject and release already-created resources without stopping original capture tracks.

- [ ] **Step 2: Run adapter tests and verify RED**

Run: `node --test tests/deepfilternet-adapter.test.js`

Expected: FAIL because `deepfilternet.js` does not exist.

- [ ] **Step 3: Implement adapter construction**

Use literal `relURL()` calls for:

```js
const WORKER_URL = relURL("./deepfilternet-worker.js", import.meta);
const WORKLET_URL = relURL("./deepfilternet-worklet.js", import.meta);
const MODEL_URL = relURL("./denoiser_model.onnx", import.meta);
const WASM_URL = relURL("./ort-wasm-simd-threaded.wasm", import.meta);
```

Validate the input stream/audio track and required browser APIs. Create or accept a 48 kHz `AudioContext`, initialize the Worker, load the worklet, create a mono worklet node and media-stream destination, connect a new `MessageChannel`, then connect the current microphone source. Resume the context and fail unless it is running.

- [ ] **Step 4: Implement track changes and idempotent cleanup**

Mirror the existing RNNoise adapter's stable-audio-track behavior. On any failure, remove installed listeners, disconnect created nodes, close ports/client/context, and stop only the generated output track. `close()` performs the same ownership-safe teardown once.

- [ ] **Step 5: Run adapter tests and full suite to verify GREEN**

Run: `node --test tests/deepfilternet-adapter.test.js && npm test`

Expected: both commands pass with zero failures.

- [ ] **Step 6: Commit the adapter**

```bash
git add tests/deepfilternet-adapter.test.js src/Features/VideoCall/AudioUtils/DeepFilterNet
git commit -m "feat: add DeepFilterNet stream adapter"
```

---

### Task 5: Generated runtime bundles, default video-call integration, and build verification

**Files:**
- Modify: `package.json`
- Create (generated): `src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worker.js`
- Create (generated): `src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worklet.js`
- Modify: `src/Features/VideoCall/video-call.js`
- Test: `tests/deepfilternet-integration.test.js`

**Interfaces:**
- Consumes: Worker/worklet source entries and `createDeepFilterNetAdapter()`.
- Produces: standalone browser-loadable runtime modules and the default live video-call path.

- [ ] **Step 1: Add a failing build/runtime integration test**

Create a Node test that invokes Rollup's JavaScript API against the Worker
source with `inlineDynamicImports: true`, calls `bundle.generate({ format:
"es", inlineDynamicImports: true })`, and asserts that the emitted Worker chunk
contains no unresolved `from "onnxruntime-web` or `from
'onnxruntime-web` import. Repeat for the worklet source and assert it registers
`DeepFilterNetWorkletProcessor`.

The production-build assertion also proves that `video-call.js` reaches the
DeepFilterNet adapter: the model, WASM, Worker, and worklet are emitted only
when the adapter is present in the live Rollup module graph. Keep the direct
adapter call in `initialise()` instead of adding a single-use selection
abstraction solely for this test.

- [ ] **Step 2: Run integration tests and verify RED**

Run: `node --test tests/deepfilternet-integration.test.js`

Expected: FAIL because standalone bundles and DeepFilterNet video-call selection are absent.

- [ ] **Step 3: Add deterministic runtime build scripts and generate bundles**

Add scripts that bundle each source with ES output and inline dynamic imports:

```json
"build:deepfilternet-worker": "rollup src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worker-source.js --format es --inlineDynamicImports --file src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worker.js",
"build:deepfilternet-worklet": "rollup src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worklet-source.js --format es --inlineDynamicImports --file src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worklet.js",
"build:deepfilternet": "npm run build:deepfilternet-worker && npm run build:deepfilternet-worklet"
```

Run: `npm run build:deepfilternet`

Expected: both generated runtime modules are created successfully.

- [ ] **Step 4: Make DeepFilterNet the active video-call adapter**

```js
import { createDeepFilterNetAdapter } from "./AudioUtils/DeepFilterNet/deepfilternet.js";
// import { createNoiseSuppressionAdapter } from "./AudioUtils/NoiseSuppress/noise-suppression.js";

this._noiseSuppressionAdapter = await createDeepFilterNetAdapter(rawStream);
// this._noiseSuppressionAdapter =
//   await createNoiseSuppressionAdapter(rawStream);
```

Do not rename the lifecycle property or modify RNNoise files.

- [ ] **Step 5: Run focused and full verification**

Run: `node --test tests/deepfilternet-integration.test.js`

Run: `npm test`

Run: `npm run build:deepfilternet`

Run: `npm run compile-for-deployment`

Run: `find build -type f \( -name '*denoiser_model*' -o -name '*ort-wasm*' -o -name '*deepfilternet-worker*' -o -name '*deepfilternet-worklet*' \) -print`

Run: `git diff --check`

Expected: every command exits 0; tests report zero failures; the `find` command
prints one local model, one WASM runtime, and emitted Worker/worklet chunks; no
COOP/COEP or SharedArrayBuffer code is introduced.

- [ ] **Step 6: Browser smoke test**

Serve the source app, start the video-call microphone path in a browser without cross-origin isolation, and confirm:

1. `crossOriginIsolated` may remain `false`.
2. The local ONNX model and WASM requests return 200.
3. The generated output track remains live.
4. Worker messages produce finite 480-sample enhanced frames.
5. Switching microphones retains the same generated output track.

- [ ] **Step 7: Commit the default integration**

```bash
git add package.json src/Features/VideoCall/video-call.js src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worker.js src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worklet.js tests/deepfilternet-integration.test.js
git commit -m "feat: use DeepFilterNet for video-call denoising"
```
