# VideoCall Background Processing

This document describes the background effects used by VideoCall. The active
runtime route is intentionally small:

```text
camera -> Gregblur GPU -> Lite CPU fallback -> original camera
```

Both active engines expose the same runtime modes: `none`, `blur`, and `image`.

## Files

| File | Responsibility |
| --- | --- |
| [`background.js`](./background.js) | Selects Gregblur or Lite, owns the active engine, and exposes effect switching and diagnostics. |
| [`gregblur/`](./gregblur/) | Local Apache-2.0 Gregblur extension for WebGL2 blur and uploaded-image compositing. |
| [`background-lite.js`](./background-lite.js) | Smooth 30 FPS Canvas renderer and back-pressure controller for the Lite path. |
| [`background-lite-worker.js`](./background-lite-worker.js) | Runs the original MediaPipe Selfie Segmenter and mask conversion off the main thread. |
| [`../../Utilities/MediaPipe/vision-runtime.js`](../../Utilities/MediaPipe/vision-runtime.js) | Shares MediaPipe with Eye Gaze and collects rolling, silent whole-session performance telemetry. |
| [`background-rvm.js`](./background-rvm.js) | Retained RVM admission code. It is not imported by the active background router. |
| [`background-rvm-tfjs.js`](./background-rvm-tfjs.js) | Retained TensorFlow.js RVM adapter. It is not imported by the active background router. |



## Runtime flow

1. `background(stream)` validates the camera stream and inspects WebGL2.
2. A usable hardware WebGL2 renderer starts Gregblur.
3. If Gregblur is unavailable or fails, `background-lite.js` is loaded.
4. If Lite also fails, the original camera stream is returned so the call can
   continue.

RVM is not registered, selected, benchmarked, downloaded, or executed by this
flow. The two RVM files remain only as disconnected reference implementations.

## Gregblur GPU path

Gregblur uses the MediaPipe Selfie Multiclass model and keeps the confidence
mask as a WebGL texture. It applies joint-bilateral refinement and temporal
smoothing before the final composite.

- `blur` composites the sharp person over Gregblur's blurred camera texture.
- `image` cover-fits and uploads the selected image once, then composites it
  with the same refined foreground matte.
- `none` forwards the unprocessed camera frame.

Blur and image therefore use the same segmentation model, mask, edge treatment,
and output track. Mask pixels are not read back to the CPU.

| Profile | Segmentation | With recent Eye Gaze activity |
| --- | ---: | ---: |
| `high` | 30 fps | 20 fps |
| `balanced` | 30 fps | 12 fps |

The current Gregblur settings are a 25-pixel blur radius, 2x background
downsampling, and joint-bilateral mask refinement. Temporal refinement keeps a
maximum `0.24` history weight for small confidence changes, but reduces that
weight toward zero at moving silhouette edges so the mask follows motion sooner.
When a MediaPipe mask is reused, Gregblur now reuses its refined GPU texture as
well instead of repeating the expensive 11x11 bilateral pass for every video
frame. Temporal convergence and final compositing still run normally.

## Beauty skin smoothing

The Gregblur WebGL2 path also provides a `0`-`100` beauty slider. This effect
only smooths skin inside the detected face region; it does not reshape, warp,
or slim the face.

Eye Gaze and beauty share the same FaceLandmarker instance through
`vision-runtime.js`. Beauty reuses a recent Eye Gaze landmark result when one
is available and uses the same singleton detector when it is not.

The GPU shader applies a lightweight nine-sample smoothing filter inside an
elliptical face mask. Eye and mouth regions are protected, and strong local
detail is partially restored to avoid an unnaturally flat result. Changing the
slider only updates the shader strength and does not replace the video track or
restart WebRTC. Beauty is hidden when VideoCall falls back to the Lite engine.

## Lite CPU worker path

Lite uses the original MediaPipe Selfie Segmenter Landscape model with the CPU
delegate. MediaPipe inference and confidence-mask conversion run in a dedicated
Worker, while the main thread independently renders a `480x270`, 30 FPS
Canvas stream.

Segmentation has its own phase-locked timer instead of waiting for a 30 FPS render
callback. At most one frame is in flight; if the worker is busy, newer camera
frames are rendered normally rather than being queued. Worker completion wakes
the timer at the next exact deadline, and the latest completed mask is reused in
the meantime. This back-pressure rule avoids both a growing queue and the extra
render-callback wait that can make a 15-20 FPS target deliver about 11 FPS.

- `none` draws the original camera without requesting segmentation.
- `blur` renders a low-resolution blurred background and the full-resolution
  foreground from the latest mask.
- `image` prepares the uploaded image once, then uses the same foreground mask.
- Before the first mask, after a stale mask, or during a worker retry, Lite shows
  the direct camera instead of an inaccurate elliptical portrait cut-out.

The worker owns one background model instance and its own MediaPipe WASM context.
Eye Gaze stays on the main shared FaceLandmarker and is not scheduled or slowed by
the Lite worker. Replaced `ImageBitmap` backgrounds are closed, and terminating
Lite releases the worker, generated track, canvases, and retained image.

If Worker initialisation, `OffscreenCanvas`, `createImageBitmap`, or worker mask
conversion is unavailable, Lite automatically creates the same MediaPipe model
on the main thread instead of disabling background effects. This compatibility
path keeps the 30 FPS renderer but caps segmentation at 10 FPS (`normal`), 7 FPS
(`constrained`), 4 FPS (`critical`), or 1 FPS (`hidden`). The diagnostic state
reports `mode: "main-thread"` and preserves `workerFallbackReason`.

If a development server exposes the main Squidly module and its Worker asset on
different origins or ports, Lite copies the already-served Worker source into a
same-origin Blob Worker. This avoids a browser Worker-construction restriction;
it does not duplicate the MediaPipe model or change production routing.

Lite expands the mask by one analysis pixel to protect moving edges. The earlier
whole-person centroid predictor remains removed; the independent phase-locked
scheduler improves mask freshness without prediction, another model, or changes
to MediaPipe output.

## Adaptive resource allocation

Background scheduling no longer reacts only to whether Eye Gaze is on or off.
`vision-runtime.js` maintains a silent five-second rolling window containing:

- main-thread long-task time, when the browser exposes the Long Tasks API;
- video frames that arrive late relative to the active engine's own target FPS;
- combined estimated load from FaceLandmarker and background segmentation;
- average inference time and run frequency for each Vision task;
- page visibility.

Gregblur starts with the profile budget shown above, including the lower base
rate reserved while Eye Gaze is active. It then applies one of four resource
levels: `normal`, `constrained`, `critical`, or `hidden`. Constrained and
critical levels lower background segmentation frequency while leaving Eye Gaze,
audio, WebRTC negotiation, and the selected background effect unchanged. A
2.5-second downgrade cooldown prevents rapid changes, and recovery requires a
stable 10-second window to avoid oscillation.

Lite keeps video output at 30 FPS and changes only the worker's mask-update rate:
`normal` permits up to 20 FPS, `constrained` 12 FPS, `critical` 6 FPS, and a
hidden page 1 FPS. Recent Eye Gaze activity caps the normal Worker rate at 15
FPS. An independent phase-locked deadline preserves the requested average rate
without waiting for a render callback or restarting the interval after every
completed request. Only one inference can run, so this does not create a queue.
Worker allocation is based on main-thread and video-rendering pressure, not the
worker's own Vision load, so segmentation cannot accidentally throttle itself
in a feedback loop. The measured MediaPipe inference time can lower these caps
further, and a single in-flight request guarantees that work never accumulates.
Recovery is gradual after an eight-second stable period.

## Runtime controls

The VideoCall toolbar provides:

- `no background effect`
- `blur background`
- `upload background image`
- `beauty`, which opens the skin-smoothing strength slider on Gregblur

PNG, JPEG, WebP, and GIF files up to 20 MB are decoded locally. They are not
uploaded to a server.

The same modes are available programmatically:

```js
await setBackgroundEffect("none");
await setBackgroundEffect("blur");
await setBackgroundEffect("image", {
  image: decodedImageBitmap,
  imageName: "office.jpg",
});
setBeautyStrength(45);
```

## Configuration and diagnostics

The `quality` option controls the Gregblur profile:

```js
const processed = await background(cameraStream, { quality: "balanced" });
```

When no explicit quality is supplied, Gregblur starts with `balanced` on every
device. During its two-second warm-up it requests no more than 20 segmentation
updates per second, then combines whole-session pressure with measured inference
time to select a sustainable rate. `high` is used only when explicitly requested.

Runtime state is available in the browser console:

```js
// Prints one grouped model, task, and resource-allocation report.
window.squidlyBackground.report();

// Returns the same underlying state without printing anything.
window.squidlyBackground.getState();
await window.squidlyBackground.setEffect("image", {
  image: decodedImageBitmap,
  imageName: "office.jpg",
});
await window.squidlyBackground.destroy();
```

The automatic console output is intentionally limited to model initialization
and resource-level transitions. There is no per-frame logging. The on-demand
report is the single place to inspect the active model and delegate, model
instance counts, target segmentation FPS, Eye Gaze activity, pressure reasons,
late-frame and long-task ratios, and per-task inference load. Diagnostics also
include renderer information, attempted engines, the active effect mode,
output-track state, and uploaded-image state.

### Automatic engine selection

There is no manual engine preference. Every call inspects the current WebGL2
renderer and starts Gregblur when hardware acceleration is available. Gregblur
startup failure or software rendering selects Lite CPU; Lite failure preserves
the original camera stream. Once an engine starts, the call keeps that engine
and model until cleanup instead of replacing it while the call is active.

## Cleanup and requirements

The active engine is destroyed before another engine starts and on `pagehide`.
Cleanup stops generated tracks, closes MediaPipe tasks, releases GPU or Canvas
resources, removes hidden video elements, and closes owned `ImageBitmap` files.

Gregblur requires WebGL2. Lite requires Canvas 2D and
`HTMLCanvasElement.captureStream()`. `Worker`, `OffscreenCanvas`, and
`createImageBitmap()` enable its preferred non-blocking path but are no longer
required for background effects to remain available. Both MediaPipe models are
fetched on first use and can be cached by the browser.
