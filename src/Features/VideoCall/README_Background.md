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
| Beauty smoothing | Face-region GPU filter | Lightweight skin-tone Canvas filter |

The router returns one processed video track and preserves input audio tracks.
Effect changes update the existing engine without replacing its WebRTC track.

| File | Responsibility |
| --- | --- |
| [`background.js`](./background.js) | Public API, startup selection, engine ownership, Gregblur integration, and diagnostics. |
| [`background-benchmark.js`](./background-benchmark.js) | Sequential measurement, ranking, and locked winner selection. |
| [`background-lite.js`](./background-lite.js) | Lite scheduling, fixed buffers, same-source-frame composition, fallback, and cleanup. |
| [`background-lite-worker.js`](./background-lite-worker.js) | MediaPipe CPU inference and mask conversion in a Worker. |
| [`beauty-lite.js`](./beauty-lite.js) | Optional skin-tone softening with reusable Canvas buffers and no extra model. |
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

Gregblur beauty shares the FaceLandmarker used by Eye Gaze, protects
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

The toolbar supports no effect, blur, uploaded image, and beauty on both engines.
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
| `selection.benchmark.reusedTrial` | Whether the final measured instance was retained. Present after a measured winner is selected. |
| `selection.benchmark.winnerWarmupMs` | Extra warmup for a restarted winner: 1000 ms, or 0 for a retained trial. Not set for the explicit Lite override. |
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
| `workerInfo.warmup` | Worker startup warmup runs, durationMs, and error. Absent for main-thread fallback. |

Gregblur reports `segmentationScheduler`, `gpuComposite`, `faceLandmarks`,
and `mediaPipeRuntime`.

## Ownership and cleanup

### Lite beauty

The existing Beauty slider sets strength from 0 to 100; zero (the default) skips
all beauty processing and allocation. Start around 30-40 for subtle softening.
Lite samples colour at 160x90, estimates skin-like chroma and luminance, reduces
the mask around strong local contrast, and blends a 1.2-pixel softened source
with a maximum 45% contribution. There is no face reshaping or extra model.

In blur/image modes, beauty uses the retained source before the person matte is
applied. Uploaded backgrounds remain unchanged. With no background effect it
processes live video. Colour matching is approximate: skin-coloured clothing or
backgrounds can also be softened in raw mode, and unusual lighting can weaken
the effect. It does not precisely identify anatomical skin or facial features.

Four reusable canvases are allocated on first use and released with the engine.
This adds one small pixel readback and a Canvas filter when enabled; performance
on the laptop still needs measurement. engineState.beauty.lastDurationMs reports
local processing time. Beauty failures fall back to the original source and
disable the optional filter, preserving background effects; lastBeautyError
contains the reason. Changing strength never replaces the video track.

The router owns cancellation, camera clones, active-engine selection, and clone
release. Engines own generated tracks and processing resources. Original audio
tracks are borrowed and must not be stopped.

Cleanup runs before replacement, when the input ends, on `pagehide`, or through
`destroy()`. It stops generated tracks, terminates the Lite Worker, closes
MediaPipe tasks and owned images, releases WebGL/Canvas resources, cancels
callbacks, and removes hidden videos.

## Validation

Generate `background.js` through Rollup to catch syntax and module-resolution
errors. This repository does not keep a dedicated automated background-effects
test directory.

After latency-sensitive changes, test a real call with fast horizontal movement,
a longer call, tab hide/restore, Eye Gaze plus blur, image replacement, effect
switching, and teardown. Check `window.squidlyBackground.getState()` during
the call to confirm source/mask timestamp pairing, segmentation cadence, late
pair drops, resource level, and the locked engine.

For startup/resumption changes, check these sequences explicitly:

1. Reload and enter a call; verify blur and upload-background-image controls.
2. Change blur to none, wait briefly, then enable blur; repeat after a longer
   pause. The first processed output must use a newly captured source.
3. Upload an image, choose none, then re-enable image mode with the retained image
   through the API; verify the image remains owned and available.
4. Toggle while an inference is in flight. After its result drains, new requests
   must resume without overlapping or leaving the scheduler waiting forever.
5. Inspect workerInfo.warmup and selection.benchmark.winnerWarmupMs. Compare
   steady-state cadence separately from model loading and startup waiting.

## Startup warmup and effect resumption

- Lite Worker runs two synthetic model/mask conversions before sending ready.
  These frames are discarded and excluded from live FPS/latency statistics.
  `workerInfo.warmup` reports `runs`, `durationMs`, and any optional warmup error.
  VIDEO timestamps 0 and 1 are reserved for this work; live frame timestamps
  must be strictly greater. Each synthetic result and converted bitmap is closed.
  Warmup errors do not by themselves mark the engine unavailable. Worker/model
  initialization still uses the existing timeout and compatibility fallback.
- Gregblur yields between shader compilation jobs to give the browser chances
  to handle input and paint; an individual compilation may still block.
- A winner that must restart after its trial gets one second of warmup before
  activation. A retained trial needs no extra warmup. This does not rerank the
  winner, and startup selection remains fixed for the call.
- Re-enabling Lite blur or image invalidates the old pair and scheduling wait.
  A pre-transition in-flight request drains normally, but its source is not
  displayed. The next eligible camera frame can be segmented immediately.
  `discardPairsThroughTimestampMs` is an internal request-identity cutoff, not
  elapsed wall-clock time. The busy flag stays set until the outstanding request
  completes; while waiting for the new pair, the existing raw-video path is used.
- Gregblur resets its cached mask and scheduling clock on resumption, keeping
  the existing model, uploaded background, and output track.

The original startup/toolbar sequence is retained. Loading and measurement still
take time; these changes target concentrated startup work and stale resumption
frames, not total elimination of camera/encoding latency.

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
