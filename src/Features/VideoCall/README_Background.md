# VideoCall background processing

This is the maintenance reference for the current background-effects
implementation: startup selection, frame processing, ownership, diagnostics,
and validation.

## Feature and file map

| Mode | Gregblur GPU | Lite CPU |
| --- | --- | --- |
| `none` | Direct camera | Direct camera; segmentation paused |
| `blur` | WebGL blur | Canvas blur |
| `image` | WebGL replacement | Canvas replacement |
| Beauty smoothing | Yes | No |

The router returns one processed video track and preserves input audio tracks.
Effect changes update the existing engine without replacing its WebRTC track.

| File | Responsibility |
| --- | --- |
| [`background.js`](./background.js) | Public API, startup selection, engine ownership, Gregblur integration, and diagnostics. |
| [`background-benchmark.js`](./background-benchmark.js) | Sequential measurement, ranking, and locked winner selection. |
| [`background-lite.js`](./background-lite.js) | Lite scheduling, fixed buffers, same-source-frame composition, fallback, and cleanup. |
| [`background-lite-worker.js`](./background-lite-worker.js) | MediaPipe CPU inference and mask conversion in a Worker. |
| [`gregblur/`](./gregblur/) | WebGL2 refinement, composition, beauty, and track adapters. |
| [`vision-runtime.js`](../../Utilities/MediaPipe/vision-runtime.js) | Shared MediaPipe loading, FaceLandmarker ownership, and telemetry. |
| [`background-rvm.js`](./background-rvm.js), [`background-rvm-tfjs.js`](./background-rvm-tfjs.js) | Disconnected references; not imported by the active router. |

## Startup selection

```text
camera clone -> Gregblur trial --+
                                 +-> measured ranking -> winner fixed for call
camera clone -> Lite trial -------+
original audio tracks -------------------------------> output stream
```

`background(stream)` serializes startup requests and cancels a superseded
request. Hardware WebGL2 admits Gregblur; Lite is the CPU candidate when Canvas
capture is available. Auto mode tests candidates one at a time, each with one
second of warmup and approximately two seconds of sampling.

The probe observes output FPS, p95 output-frame interval, segmentation FPS, and
p95 mask age. A valid candidate needs at least 5 output FPS, 1 segmentation FPS,
and 15 mask-age samples. Lower scores win:

```text
score = p95 mask age
      + 2 * output cadence/stall penalty
      + 2 * mask-update interval penalty
```

This short comparison does not measure network delay, remote playback,
segmentation accuracy, edge quality, or long-call thermal behaviour.

Trials are sequential and own cloned camera tracks. A valid final trial may be
retained; another winner restarts after that trial is released. If restart
fails, the next ranked candidate is attempted. With no valid candidate, the
router returns original video.

The selected engine stays fixed until the call ends. Resource allocation may
change segmentation frequency, but never switches engines. A new call runs a
new comparison; there is no periodic or mid-call reevaluation.

The default preference is `auto`. A Lite diagnostic override applies to the
next call:

```js
window.squidlyBackground.setEnginePreference("lite-cpu");
window.squidlyBackground.setEnginePreference("auto");
```

## Lite CPU path

Lite uses MediaPipe `selfie_segmenter_landscape` float16 with the CPU delegate.
The preferred backend owns one model in a Worker. If Worker setup,
`OffscreenCanvas`, or bitmap transfer is unavailable, Lite creates the same
model on the main thread. This remains inside the locked Lite engine.

### Same-source-frame composition

```text
camera frame A
    +-> fixed 480 x 270 pending source
             +-> scaled 256 x 144 input -> mask A
             +--------------------------> frame A + mask A
```

The camera is read once after a scheduling slot is accepted. Analysis is derived
from that retained snapshot. When the matching timestamp returns, foreground
and background use the same snapshot. Live camera frame B is never combined
with mask A.

Two fixed canvases exchange roles. `pendingFrame` remains unchanged while its
mask is in flight; `pairedFrame` keeps the latest completed pair. Only one
request may be in flight, so no frame queue grows during a call. A result with
the wrong timestamp cannot release or replace the current request.

A pair arriving more than 250 ms after capture is dropped so a stall cannot
rewind output. Raw camera may be shown until a fresh pair is available. This
removes source/mask temporal mismatch, while adding whole-frame delay from
capture, inference, delivery, conversion, composition, and encoding. Distinct
processed frames follow completions up to the 30 FPS capture ceiling.
Classification mistakes and spatial edge softness may still affect contours.

### Lite scheduling and rendering

The pump uses phase-locked deadlines and skips missed slots instead of queuing
catch-up work. Duplicate decoded frames do not consume a slot.

| Level | Worker maximum | Main-thread fallback maximum |
| --- | ---: | ---: |
| `normal` | 30 fps | 10 fps |
| `constrained` | 20 fps | 7 fps |
| `critical` | 6 fps | 4 fps |
| `hidden` | 1 fps | 1 fps |

Recent Eye Gaze caps the Worker at 15 FPS. Measured sustainable rate can lower
these maxima. Moderate pressure must persist for two seconds before downgrade;
healthy state permits one recovery level after three seconds. Severe pressure
reacts immediately.

Scheduling uses the median of the last five end-to-end delivery samples, bounded
below by inference time. One spike cannot poison the rate for a long period;
repeated slow delivery still lowers it. Camera cadence telemetry is separate
from completion cadence so reduced inference cannot recursively throttle itself.

Worker and fallback mask conversion remain equivalent: one-neighbour foreground
expansion followed by smoothstep alpha mapping. Blur is drawn at `240x135`
with a 5-pixel blur and scaled to `480x270`. Foreground uses the paired
full-size source, small edge blur, and 2-pixel mask padding. Uploaded images are
cover-fitted once and reused.

## Gregblur GPU path

Gregblur uses MediaPipe `selfie_multiclass_256x256` on GPU. It keeps confidence
as a WebGL texture, applies joint-bilateral refinement and bounded temporal
history, then composites without CPU mask readback.

Gregblur processes current camera video and may reuse the last mask when a slot
is skipped. It does not have Lite's same-source-frame guarantee. Startup
measurement decides whether its combined latency/cadence is better.

| Profile | Base segmentation | With recent Eye Gaze |
| --- | ---: | ---: |
| `high` | 30 fps | 20 fps |
| `balanced` | 20 fps | 12 fps |

`balanced` is the default unless `high` is requested. Healthy measured
headroom may allow 30 FPS; warmup, sustainable-rate, pressure, and visibility
caps can lower it.

The compositor uses a 25-pixel blur radius, 2x background downsampling,
joint-bilateral refinement, and at most `0.12` temporal history weight.
History decays with source time and rejects significant confidence changes. A
250 ms gap or backwards timestamp clears it. Cached masks skip redundant
refinement and copy passes.

Beauty is Gregblur-only. It shares the FaceLandmarker used by Eye Gaze, protects
eyes and mouth, and updates shader strength without replacing the track. The
earlier CPU motion-readback experiment is disabled because measured readback
cost increased frame pressure.

## Shared telemetry

`vision-runtime.js` keeps a silent five-second rolling window containing:

- main-thread long-task time when supported;
- delivered camera/video cadence and slow-frame ratio;
- per-task duration and run frequency;
- estimated combined Vision load;
- page visibility.

Gregblur and Lite use separate policies because their costs differ. Transient
background/frame/long-task telemetry resets between startup candidates so one
does not bias the next. Shared FaceLandmarker ownership and Eye Gaze history
remain intact. Automatic logging is limited to initialization and resource
transitions; there is no per-frame logging.

## Controls and diagnostics

The toolbar supports no effect, blur, uploaded image, and Gregblur beauty.
PNG, JPEG, WebP, and GIF images up to 20 MB are decoded locally.

```js
await window.squidlyBackground.setEffect("none");
await window.squidlyBackground.setEffect("blur");
await window.squidlyBackground.setEffect("image", {
  image: decodedImageBitmap,
  imageName: "office.jpg",
});
window.squidlyBackground.setBeautyStrength(45);
window.squidlyBackground.report();
const state = window.squidlyBackground.getState();
await window.squidlyBackground.destroy();
```

| Field | Meaning |
| --- | --- |
| `selection.engine` | Locked engine. |
| `selection.reason` | Selection or fallback explanation. |
| `selection.benchmark` | Measurements, ranking, failures, winner, and lock. |
| `engineState` | Current engine-specific state. |

Important Lite diagnostics:

| Field | Meaning |
| --- | --- |
| `compositionMode` | `same-source-frame` when pairing is active. |
| `framePairing.pendingFrames` | Bounded in-flight count: 0 or 1. |
| `framePairing.sourceTimestampMs`, `maskTimestampMs` | Completed pair identity; values must match. |
| `framePairing.lastCompositeLatencyMs` | Snapshot to local composition; excludes remote playback. |
| `framePairing.droppedLatePairs` | Results rejected after 250 ms. |
| `maskProvider.averageInferenceMs` | Model plus mask preparation. |
| `maskProvider.averageMaskLatencyMs` | Snapshot-to-mask-return average. |
| `maskProvider.measuredSegmentationFps` | Completions in the latest second. |
| `allocator` | Target FPS, pressure level, reasons, and recovery. |

Gregblur reports `segmentationScheduler`, `gpuComposite`, `faceLandmarks`,
and `mediaPipeRuntime`.

## Ownership and cleanup

The router owns cancellation, camera clones, active-engine selection, and clone
release. Engines own generated tracks and processing resources. Original audio
tracks are borrowed and must not be stopped.

Cleanup runs before replacement, when the input ends, on `pagehide`, or through
`destroy()`. It stops generated tracks, terminates the Lite Worker, closes
MediaPipe tasks and owned images, releases WebGL/Canvas resources, cancels
callbacks, and removes hidden videos.

## Validation

```sh
node --test \
  tests/background-lite-pairing.test.js \
  tests/background-lite-scheduling.test.js \
  tests/background-benchmark.test.js \
  tests/background-latency.test.js
```

The suite covers selection lifecycle, scheduling, long-call state, source/mask
identity, fixed-buffer reuse, wrong/late results, effects, GPU timing policy,
and rendering. Generate `background.js` through Rollup to catch syntax and
module-resolution errors.

Tests mock camera, Canvas, Worker, WebGL, and time APIs. After latency-sensitive
changes, test a real call with fast movement, a longer call, tab hide/restore,
Eye Gaze plus blur, image replacement, and teardown.

## Maintenance rules

- Keep selection startup-only and fixed for the call.
- Keep Worker and main-thread Lite mask conversion equivalent.
- Preserve one in-flight request and two fixed source buffers.
- Echo source timestamps unchanged through Worker messages.
- Close transferred bitmaps at the receiver and owned images on replacement.
- Keep camera-delivery telemetry separate from inference completions.
- Preserve sequential trial ownership when changing startup scoring.
- Treat blur as a visual effect rather than a privacy boundary; exceptional
  fallback paths can show unprocessed video.
