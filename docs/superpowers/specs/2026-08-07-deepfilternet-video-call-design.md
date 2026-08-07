# DeepFilterNet video-call denoising

## Goal

Add a separate DeepFilterNet3 implementation to SquidlySession and make it the
default microphone denoiser for video calls. Preserve the existing RNNoise
implementation unchanged. In `video-call.js`, leave the former RNNoise adapter
call commented directly below the active DeepFilterNet call so it remains an
obvious manual rollback path.

The implementation is based on `/Users/poyaohuang/dev/side-project/denoise`,
but replaces that repository's `SharedArrayBuffer` transport with a transferable
`MessageChannel`. SquidlySession will therefore require neither cross-origin
isolation nor new COOP/COEP response headers.

## Runtime assets and model contract

The checked-in DeepFilterNet ONNX model is copied from the reference repository
and served as a local SquidlySession asset. Its SHA-256 is
`fe5eb64fa2e4154c83f8e4935e82871c850c154387ee892e0ab65fe179e7d8c9`.
ONNX Runtime Web and its required WebAssembly runtime are dependencies and are
also emitted by the existing Rollup asset pipeline. No inference resource is
loaded from a CDN.

The model accepts:

- `input_frame`: 480 mono float samples at 48 kHz.
- `states`: 45,304 recurrent float values.
- `atten_lim_db`: one float with value `0`.

It returns `enhanced_audio_frame` and `new_states`. Every adapter starts with a
zero-filled state and preserves the returned state across successive frames.

## Architecture

All DeepFilterNet-specific files live in a new
`src/Features/VideoCall/AudioUtils/DeepFilterNet/` directory. This keeps the
current `NoiseSuppress/` RNNoise feature intact.

The page creates a dedicated module Worker and initializes one ONNX Runtime
session before publishing the processed audio track. Inference runs only in
that Worker; it never runs on the page thread or Web Audio rendering thread.

After initialization, the adapter creates a `MessageChannel`. One transferable
port is sent to the Worker and the other to the AudioWorklet processor through
the worklet node's built-in port. The two audio-side components then communicate
directly without routing live PCM messages through the page.

The AudioWorklet:

1. Downmixes each Web Audio render quantum to mono.
2. Collects samples into 480-sample model frames.
3. Transfers at most one inference frame at a time to the Worker.
4. Queues returned enhanced samples for the output track.
5. Emits silence during startup or an output underrun.

The worklet retains at most eight unprocessed frames (80 ms at 48 kHz), in
addition to the single frame in flight. If inference cannot keep up, it drops
the oldest queued input frame rather than allowing call latency or memory use
to grow without bound. The next processed frame continues from the Worker's
current recurrent state. The implementation records no audio and retains no
PCM after processing.

## Public adapter and video-call integration

`createDeepFilterNetAdapter(inputStream, options)` mirrors the existing
`createNoiseSuppressionAdapter()` contract. It returns the processed stream,
stable processed audio track, context, worklet node, and idempotent `close()`
method.

The output stream preserves video tracks and replaces only the microphone
track. Microphone `trackchanged` events reconnect the graph while retaining the
same processed output track. Video `trackchanged` events update the output
stream and dispatch the same downstream event expected by the existing WebRTC
connection manager.

`video-call.js` will import DeepFilterNet actively and retain the former
RNNoise import as a comment. It will initialize the adapter as follows in
intent:

```js
this._noiseSuppressionAdapter = await createDeepFilterNetAdapter(rawStream);
// this._noiseSuppressionAdapter =
//     await createNoiseSuppressionAdapter(rawStream);
```

The existing lifecycle field name is retained to avoid unrelated changes.

## Errors and cleanup

Adapter construction fails before WebRTC publication when the browser lacks
Worker, AudioWorklet, WebAssembly, or required Web Audio support; when the model
or runtime asset cannot load; when ONNX initialization/inference fails; or when
the audio context cannot enter the running state.

Any partial-construction failure terminates the Worker and disconnects nodes
already created. `close()` is idempotent and removes track listeners,
disconnects graph nodes, stops only the generated output track, closes the
audio context, closes the message ports, and terminates the Worker. Original
camera and microphone tracks remain owned by the existing webcam lifecycle.

## Build integration

The existing `relURL(<literal>, import.meta)` Rollup plugin emits JavaScript
assets as chunks and binary files as hashed assets. The adapter uses literal
paths for its Worker, worklet, ONNX model, and required ONNX Runtime WebAssembly
assets so both direct source development and deployment builds can locate them.
The package adds `onnxruntime-web` at the same compatible version used by the
reference repository.

## Verification

Automated tests will cover:

- Model feed validation and recurrent-state chaining.
- Worker initialization, ordered inference, transfer protocol, and propagated
  errors.
- Worklet frame assembly, bounded backpressure, ordered enhanced output, and
  silence on startup/underrun.
- Adapter stream replacement, device-change behavior, failure cleanup, and
  idempotent close.
- Video-call integration selecting DeepFilterNet while retaining the commented
  RNNoise rollback call.
- Production build emission of the Worker, worklet, model, and local ONNX
  Runtime assets.

Fresh unit tests and the full production build must pass. A browser smoke test
will start a video-call microphone path, confirm that the local model loads,
and confirm finite processed samples reach the generated track without
cross-origin isolation.
