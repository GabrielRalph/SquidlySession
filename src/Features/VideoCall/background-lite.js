import {
  classifySessionPerformance,
  getSessionPerformanceState,
  getVisionFileset,
  getVisionModule,
  noteSessionFrame,
  noteVisionTaskRun,
  wasVisionTaskRecentlyActive,
} from "../../Utilities/MediaPipe/vision-runtime.js";
import { relURL } from "../../Utilities/usefull-funcs.js";
import { createLiteBeauty } from "./beauty-lite.js";

/**
 * Lite runtime flow
 * 1. Snapshot the camera once; derive analysis from that exact image.
 * 2. Schedule one inference at a time, independently of camera callbacks.
 * 3. Send at most one frame to the MediaPipe Worker; never queue stale work.
 * 4. Pair each mask with its retained source, then composite immediately.
 * 5. Fall back to the same model on the main thread only if Worker setup fails.
 */

const MODEL_NAME = "selfie-segmenter-landscape-float16";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/" +
  "selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite";
// captureStream ceiling, not a promise of 30 distinct processed frames/second.
const OUTPUT = Object.freeze({ width: 480, height: 270, fps: 30 });
const ANALYSIS = Object.freeze({ width: 256, height: 144 });
const BLUR = Object.freeze({ width: 240, height: 135, pixels: 5 });
const EFFECT_MODES = new Set(["none", "blur", "image"]);
const LEVELS = Object.freeze(["normal", "constrained", "critical", "hidden"]);
const LEVEL_MAX_FPS = Object.freeze({
  normal: 30,
  constrained: 20,
  critical: 6,
  hidden: 1,
});
const MAIN_THREAD_MAX_FPS = Object.freeze({
  normal: 10,
  constrained: 7,
  critical: 4,
  hidden: 1,
});
// Completed output may be held while inference waits; incoming pairs have a
// separate, tighter deadline so a stalled delivery cannot rewind the video.
const MASK_MAX_AGE_MS = 2500;
const PAIR_MAX_LATENCY_MS = 250;
const MASK_RENDER_PADDING = 2;
const SCHEDULE_TOLERANCE_MS = 2;
const ALLOCATION_CHECK_MS = 1000;
const RECOVERY_MS = 8000; // Compatibility main-thread path.
const WORKER_RECOVERY_MS = 3000;
const WORKER_DOWNGRADE_MS = 2000;

let activeState = null;

// -----------------------------------------------------------------------------
// Performance classification
// -----------------------------------------------------------------------------

function classifyWorkerPerformance(performanceState) {
  if (performanceState.visibility === "hidden") {
    return { level: "hidden", reasons: ["Page is hidden"] };
  }
  const hasLateFrames = performanceState.frameSamples >= 10;
  if (
    performanceState.longTaskRatio >= 0.18 ||
    (hasLateFrames && performanceState.slowFrameRatio >= 0.28)
  ) {
    return { level: "critical", reasons: ["Main-thread or video-frame pressure"] };
  }
  // Moderate unrelated main-thread tasks alone do not justify throttling a
  // separate Worker when the delivered camera cadence is still healthy.
  // Severe stalls above retain unconditional protection.
  const frameDeliveryHealthy = hasLateFrames &&
    performanceState.estimatedFrameFps >= 24 &&
    performanceState.slowFrameRatio < 0.10;
  if (
    (performanceState.longTaskRatio >= 0.06 && !frameDeliveryHealthy) ||
    (hasLateFrames && performanceState.slowFrameRatio >= 0.12)
  ) {
    return { level: "constrained", reasons: ["Moderate rendering pressure"] };
  }
  return { level: "normal", reasons: ["Worker and renderer within budget"] };
}

// -----------------------------------------------------------------------------
// Canvas and video setup
// -----------------------------------------------------------------------------

function drawCover(context, source, width, height, overscan = 0) {
  const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
  const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.max(
    (width + overscan * 2) / sourceWidth,
    (height + overscan * 2) / sourceHeight,
  );
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(
    source,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function createCanvas(width, height, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", options);
  if (!context) throw new Error("Canvas 2D is unavailable.");
  return { canvas, context };
}

function createAnalysisCanvas() {
  // Worker path can transfer its analysis image synchronously. This avoids
  // waiting for createImageBitmap after the main-thread blur render finishes.
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(ANALYSIS.width, ANALYSIS.height);
    const context = canvas.getContext("2d", {alpha:false, desynchronized:true});
    if (context && typeof canvas.transferToImageBitmap === "function") {
      return {canvas, context};
    }
  }
  return createCanvas(ANALYSIS.width, ANALYSIS.height, {alpha:false, desynchronized:true});
}

function createHiddenVideo(track) {
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  Object.assign(video.style, {
    position: "fixed",
    width: "1px",
    height: "1px",
    left: "-10000px",
    top: "-10000px",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(video);
  return video;
}

async function waitForVideo(video) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise((resolve, reject) => {
      const done = (error) => {
        clearTimeout(timeout);
        video.removeEventListener("loadeddata", ready);
        video.removeEventListener("error", failed);
        error ? reject(error) : resolve();
      };
      const ready = () => done();
      const failed = () => done(video.error ?? new Error("Camera video failed."));
      const timeout = setTimeout(
        () => done(new Error("Camera video timed out.")),
        5000,
      );
      video.addEventListener("loadeddata", ready, { once: true });
      video.addEventListener("error", failed, { once: true });
    });
  }
  await video.play();
}

// -----------------------------------------------------------------------------
// Adaptive, phase-locked segmentation scheduling
// -----------------------------------------------------------------------------

// A single delayed message must not turn a fast Worker into a 2 FPS loop.
// Use recent median delivery cost; repeated slow deliveries still lower the cap.
function getSchedulingLatencyMs(state) {
  if (state.maskLatencySamples.length < 3) return state.averageInferenceMs;
  const sorted = [...state.maskLatencySamples].sort((a, b) => a - b);
  return Math.max(state.averageInferenceMs, sorted[Math.floor(sorted.length / 2)]);
}

/**
 * Returns a cached allocation snapshot, reevaluated at most once per second.
 * Worker pressure uses camera cadence; inference completion cadence must not
 * feed it, otherwise reducing segmentation could trigger further reductions.
 * Only work rate changes here: the router keeps the chosen engine locked.
 */
function createScheduler(state) {
  let level = "normal";
  let lastCheckAt = -Infinity;
  let recoveryStartedAt = null;
  let downgradeStartedAt = null;
  let allocation = null;

  return () => {
    const now = performance.now();
    if (allocation && now - lastCheckAt < ALLOCATION_CHECK_MS) return allocation;
    lastCheckAt = now;

    const sessionPerformance = getSessionPerformanceState();
    const desired = state.executionMode === "worker"
      ? classifyWorkerPerformance(sessionPerformance)
      : classifySessionPerformance(sessionPerformance);
    const currentRank = LEVELS.indexOf(level);
    const desiredRank = LEVELS.indexOf(desired.level);
    const previousLevel = level;

    const worker = state.executionMode === "worker";
    const recoveryMs = worker ? WORKER_RECOVERY_MS : RECOVERY_MS;
    if (worker && level === "hidden" && desired.level !== "hidden") {
      // Visibility throttling is not evidence of inadequate hardware. Do not
      // keep a foreground call at 1 FPS for multiple recovery stages.
      level = desired.level;
      recoveryStartedAt = downgradeStartedAt = null;
    } else if (desiredRank > currentRank) {
      recoveryStartedAt = null;
      if (worker && desired.level === "constrained") {
        downgradeStartedAt ??= now;
        if (now - downgradeStartedAt >= WORKER_DOWNGRADE_MS) {
          level = desired.level;
          downgradeStartedAt = null;
        }
      } else {
        // Severe pressure and hidden tabs still react immediately.
        level = desired.level;
        downgradeStartedAt = null;
      }
    } else if (desiredRank < currentRank) {
      downgradeStartedAt = null;
      recoveryStartedAt ??= now;
      if (now - recoveryStartedAt >= recoveryMs) {
        level = LEVELS[Math.max(desiredRank, currentRank - 1)];
        recoveryStartedAt = null;
      }
    } else {
      recoveryStartedAt = downgradeStartedAt = null;
    }

    if (previousLevel !== level) {
      console.info(
        `[Squidly Resources] Lite ${previousLevel} -> ${level}`,
        desired.reasons.join("; "),
      );
    }

    const eyeGazeActive = wasVisionTaskRecentlyActive("face-landmarker");
    let maximumFps = state.executionMode === "main-thread"
      ? MAIN_THREAD_MAX_FPS[level]
      : LEVEL_MAX_FPS[level];
    if (state.executionMode === "worker" && eyeGazeActive) {
      maximumFps = Math.min(maximumFps, 15);
    }
    // Include bitmap preparation, worker transport and mask delivery in the
    // budget, not just model inference. Start conservatively until measured.
    const processingMs = getSchedulingLatencyMs(state);
    const sustainableFps = processingMs
      ? Math.max(1, Math.floor(900 / processingMs))
      : Math.min(20, maximumFps);
    allocation = {
      policy: state.executionMode === "worker"
        ? "lite-worker-stable-budget-v10"
        : "lite-main-thread-stall-resilient-v7",
      level,
      desiredLevel: desired.level,
      reasons: desired.reasons,
      eyeGazeActive,
      targetFps: Math.min(maximumFps, sustainableFps),
      schedulingLatencyMs: Number(processingMs.toFixed(1)),
      downgradeInMs: downgradeStartedAt === null ? 0
        : Math.max(0, WORKER_DOWNGRADE_MS - (now - downgradeStartedAt)),
      recoveryInMs: recoveryStartedAt === null ? 0
        : Math.max(0, recoveryMs - (now - recoveryStartedAt)),
      outputFps: OUTPUT.fps,
      sessionPerformance,
    };
    return allocation;
  };
}

function claimSegmentationSlot(state, now, targetFps) {
  const intervalMs = 1000 / targetFps;
  if (
    state.scheduledTargetFps !== targetFps ||
    !Number.isFinite(state.nextSegmentationAt)
  ) {
    state.scheduledTargetFps = targetFps;
    state.nextSegmentationAt = now;
  }
  if (now + SCHEDULE_TOLERANCE_MS < state.nextSegmentationAt) return false;

  // Advance the ideal deadline rather than restarting from `now`; this keeps
  // a 20 FPS request rate accurate when camera callbacks arrive at 30 FPS.
  const intervalWasMissed = now - state.nextSegmentationAt > intervalMs * 2;
  if (intervalWasMissed) {
    state.nextSegmentationAt = now + intervalMs;
  } else {
    do {
      state.nextSegmentationAt += intervalMs;
    } while (state.nextSegmentationAt <= now + SCHEDULE_TOLERANCE_MS);
  }
  return true;
}

/*
 * Independent segmentation pump.
 *
 * The compositor no longer decides when MediaPipe runs. This timer wakes at the
 * scheduler's exact deadline, while `segmentationBusy` guarantees that only one
 * frame can be in flight. Worker completion schedules the next wake-up, so no
 * stale frames are queued and no deadline waits for the next render callback.
 * Camera callbacks wake the pump when a genuinely new frame becomes available;
 * completed results publish their matched image through commitPairedFrame.
 */
function cancelSegmentationTimer(state) {
  if (state.segmentationTimerId === null) return;
  clearTimeout(state.segmentationTimerId);
  state.segmentationTimerId = null;
}

function scheduleSegmentation(state) {
  cancelSegmentationTimer(state);
  if (
    !state.running ||
    state.effectMode === "none" ||
    state.waitingForCameraFrame ||
    state.segmentationBusy ||
    state.fallbackPromise ||
    state.workerFailed
  ) {
    return;
  }

  const now = performance.now();
  const nextDeadline = Number.isFinite(state.nextSegmentationAt)
    ? state.nextSegmentationAt
    : now;
  const wakeAt = Math.max(now, state.retrySegmentationAt, nextDeadline);
  state.segmentationTimerId = setTimeout(() => {
    state.segmentationTimerId = null;
    void runSegmentationTick(state);
  }, Math.max(0, wakeAt - now));
}

// -----------------------------------------------------------------------------
// Mask conversion and timing
// -----------------------------------------------------------------------------

function recordSegmentation(state, inferenceMs) {
  state.segmentationBusy = false;
  state.consecutiveErrors = 0;
  state.segmentationRuns += 1;
  state.averageInferenceMs = state.averageInferenceMs
    ? state.averageInferenceMs * 0.8 + inferenceMs * 0.2
    : inferenceMs;
  noteVisionTaskRun("background-segmenter", inferenceMs);
}

/**
 * Record processing/delivery timing before the pair acceptance check. A late
 * result still informs scheduling even when commitPairedFrame discards it.
 * timestampMs is echoed from the main thread, not the Worker clock origin.
 */
function recordMaskFrame(state, timestampMs) {
  const sourceTimestamp = Number.isFinite(timestampMs)
    ? timestampMs
    : performance.now();
  state.lastMaskLatencyMs = Math.max(0, performance.now() - sourceTimestamp);
  state.averageMaskLatencyMs = state.averageMaskLatencyMs
    ? state.averageMaskLatencyMs * 0.8 + state.lastMaskLatencyMs * 0.2
    : state.lastMaskLatencyMs;
  state.maskLatencySamples.push(state.lastMaskLatencyMs);
  if (state.maskLatencySamples.length > 5) state.maskLatencySamples.shift();
  const completedAt = performance.now();
  state.maskCompletedTimes.push(completedAt);
  state.maskCompletedTimes = state.maskCompletedTimes.filter(at => completedAt - at < 1000);
  if (state.lastMaskLatencyMs > Math.max(250, state.averageInferenceMs * 5)) {
    state.deliveryStalls += 1;
    // The old deadline belongs to the paused timeline. Request a fresh frame
    // immediately after this result, retaining the single-in-flight guard.
    state.nextSegmentationAt = -Infinity;
  }
  const maskIntervalMs = sourceTimestamp - state.maskSourceTimestampMs;
  if (maskIntervalMs > 0 && maskIntervalMs < 2000) {
    state.averageMaskIntervalMs = state.averageMaskIntervalMs
      ? state.averageMaskIntervalMs * 0.8 + maskIntervalMs * 0.2
      : maskIntervalMs;
  }
  state.maskSourceTimestampMs = sourceTimestamp;
  state.hasMask = true;
}

// Validate identity before releasing the busy flag: an old Worker result must
// not unlock or replace the source image of the current request.
function acceptWorkerMask(state, data) {
  if (!state.running || data.timestampMs !== state.pendingFrameTimestampMs) {
    data.bitmap.close();
    return;
  }
  recordSegmentation(state, data.inferenceMs);
  if (
    state.mask.canvas.width !== data.width ||
    state.mask.canvas.height !== data.height
  ) {
    state.mask.canvas.width = data.width;
    state.mask.canvas.height = data.height;
  }
  state.mask.context.clearRect(0, 0, data.width, data.height);
  state.mask.context.drawImage(data.bitmap, 0, 0);
  data.bitmap.close();
  recordMaskFrame(state, data.timestampMs);
  commitPairedFrame(state, data.timestampMs);
  scheduleSegmentation(state);
}

// Keep this alpha conversion consistent with prepareMask in the Worker:
// four-neighbour expansion plus smoothstep maps confidence to foreground alpha.
function acceptMainThreadMask(state, mask, timestampMs) {
  if (
    !state.mask.image ||
    state.mask.canvas.width !== mask.width ||
    state.mask.canvas.height !== mask.height
  ) {
    state.mask.canvas.width = mask.width;
    state.mask.canvas.height = mask.height;
    state.mask.image = state.mask.context.createImageData(mask.width, mask.height);
  }
  const pixels = state.mask.image.data;
  const values = mask.values;
  for (let index = 0; index < values.length; index += 1) {
    const x = index % mask.width;
    const y = Math.floor(index / mask.width);
    let confidence = values[index];
    if (x > 0) confidence = Math.max(confidence, values[index - 1]);
    if (x + 1 < mask.width) confidence = Math.max(confidence, values[index + 1]);
    if (y > 0) confidence = Math.max(confidence, values[index - mask.width]);
    if (y + 1 < mask.height) {
      confidence = Math.max(confidence, values[index + mask.width]);
    }
    const value = Math.min(1, Math.max(0, (confidence - 0.2) / 0.58));
    const alpha = value * value * (3 - 2 * value);
    const offset = index * 4;
    pixels[offset] = 255;
    pixels[offset + 1] = 255;
    pixels[offset + 2] = 255;
    pixels[offset + 3] = Math.round(alpha * 255);
  }
  state.mask.context.putImageData(state.mask.image, 0, 0);
  recordMaskFrame(state, timestampMs);
  commitPairedFrame(state, timestampMs);
}

// Exactly two reusable source surfaces: one in flight and one completed.
// The analysis bitmap and foreground always originate from the same snapshot.
function commitPairedFrame(state, timestampMs) {
  if (!state.running || timestampMs !== state.pendingFrameTimestampMs) return;
  // Drain a request from before re-enabling without publishing its old image.
  // recordSegmentation has released backpressure; the caller schedules next work.
  if (timestampMs <= state.discardPairsThroughTimestampMs) {
    // This is expected cancellation of old visual output, not an inference
    // error or late-pair failure. Do not trigger model fallback for it.
    state.pendingFrameTimestampMs = null;
    state.hasMask = false;
    state.nextSegmentationAt = -Infinity;
    return;
  }
  // Never publish an old camera snapshot after a long delivery stall. Keep
  // the existing raw-video fallback until a fresh pair becomes available.
  if (performance.now() - timestampMs > PAIR_MAX_LATENCY_MS) {
    state.pendingFrameTimestampMs = null;
    state.hasMask = false;
    state.droppedLatePairs += 1;
    state.nextSegmentationAt = -Infinity;
    renderFrame(state, performance.now());
    return;
  }
  [state.pairedFrame, state.pendingFrame] = [state.pendingFrame, state.pairedFrame];
  state.pendingFrameTimestampMs = null;
  state.pairedFrameTimestampMs = timestampMs;
  state.pairNeedsRender = true;
  renderFrame(state, performance.now());
}

function recordSegmentationError(state, message, inferenceMs = 0) {
  state.pendingFrameTimestampMs = null;
  state.segmentationBusy = false;
  state.segmentationErrors += 1;
  state.consecutiveErrors += 1;
  state.lastSegmentationError = message;
  if (inferenceMs) noteVisionTaskRun("background-segmenter", inferenceMs);
  if (state.consecutiveErrors < 3) return;

  state.consecutiveErrors = 0;
  if (state.executionMode === "worker") {
    void enableMainThreadFallback(state, message).catch(() => {});
  } else {
    state.retrySegmentationAt = performance.now() + 2000;
  }
}

// -----------------------------------------------------------------------------
// Worker startup and same-model main-thread fallback
// -----------------------------------------------------------------------------

function releaseWorkerObjectUrl(state) {
  if (!state.workerObjectUrl) return;
  URL.revokeObjectURL(state.workerObjectUrl);
  state.workerObjectUrl = null;
}

async function constructSegmenterWorker(state) {
  const scriptUrl = relURL("./background-lite-worker.js", import.meta);
  try {
    return { worker: new Worker(scriptUrl), loader: "direct", scriptUrl };
  } catch {
    // Development hosts may serve Squidly and its emitted assets on different
    // ports. Worker() rejects that URL even when normal module fetches allow it.
    const response = await fetch(scriptUrl);
    if (!response.ok) {
      throw new Error(`Worker script request failed with HTTP ${response.status}.`);
    }
    const source = await response.text();
    const objectUrl = URL.createObjectURL(
      new Blob([source], { type: "text/javascript" }),
    );
    state.workerObjectUrl = objectUrl;
    try {
      return {
        worker: new Worker(objectUrl),
        loader: "local-blob-copy",
        scriptUrl,
      };
    } catch (blobError) {
      releaseWorkerObjectUrl(state);
      throw blobError;
    }
  }
}

async function createMainThreadSegmenter(state, workerReason) {
  state.worker?.terminate();
  state.worker = null;
  state.pendingFrameTimestampMs = null;
  releaseWorkerObjectUrl(state);
  state.segmentationBusy = false;
  const [vision, fileset] = await Promise.all([
    getVisionModule(),
    getVisionFileset(),
  ]);
  state.segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
    runningMode: "VIDEO",
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
  state.executionMode = "main-thread";
  state.workerFallbackReason = workerReason;
  state.workerInfo = {
    model: MODEL_NAME,
    delegate: "CPU",
    executionMode: "main-thread",
    fallbackReason: workerReason,
  };
}

// Compatibility recovery within Lite, not a router switch to another engine.
// One shared promise prevents concurrent failures from creating extra models.
function enableMainThreadFallback(state, reason) {
  if (state.executionMode === "main-thread") return Promise.resolve();
  if (state.fallbackPromise) return state.fallbackPromise;
  state.fallbackPromise = createMainThreadSegmenter(state, reason)
    .catch((error) => {
      state.workerFailed = true;
      state.lastSegmentationError =
        error instanceof Error ? error.message : String(error);
      throw error;
    })
    .finally(() => {
      state.fallbackPromise = null;
      if (!state.workerFailed) scheduleSegmentation(state);
    });
  return state.fallbackPromise;
}

async function createSegmenterWorker(state) {
  if (
    typeof Worker !== "function" ||
    typeof OffscreenCanvas !== "function" ||
    typeof createImageBitmap !== "function"
  ) {
    return Promise.reject(
      new Error("Worker segmentation APIs are unavailable."),
    );
  }

  const { worker, loader, scriptUrl } = await constructSegmenterWorker(state);
  state.worker = worker;

  return new Promise((resolve, reject) => {
    let initialising = true;
    const timeout = setTimeout(() => {
      initialising = false;
      reject(new Error("MediaPipe worker initialisation timed out."));
    }, 8000);

    worker.onmessage = ({ data }) => {
      if (!state.running || state.worker !== worker) {
        data.bitmap?.close?.();
        return;
      }
      if (data.type === "ready") {
        clearTimeout(timeout);
        initialising = false;
        state.workerInfo = {
          ...data,
          loader,
          scriptUrl,
        };
        releaseWorkerObjectUrl(state);
        resolve();
      } else if (data.type === "mask") {
        acceptWorkerMask(state, data);
      } else if (data.type === "error") {
        if (initialising) {
          clearTimeout(timeout);
          initialising = false;
          reject(new Error(data.message));
        } else {
          recordSegmentationError(state, data.message, data.inferenceMs);
          scheduleSegmentation(state);
        }
      }
    };
    worker.onerror = (event) => {
      const message = event.message || "MediaPipe worker failed.";
      if (initialising) {
        clearTimeout(timeout);
        initialising = false;
        reject(new Error(message));
      } else {
        recordSegmentationError(state, message);
        void enableMainThreadFallback(state, message).catch(() => {});
      }
    };
    worker.postMessage({ type: "init", modelAssetPath: MODEL_URL });
  });
}

async function startSegmentationBackend(state) {
  const videoReady = waitForVideo(state.video);
  try {
    await Promise.all([videoReady, createSegmenterWorker(state)]);
  } catch (workerError) {
    await videoReady;
    await createMainThreadSegmenter(
      state,
      workerError instanceof Error ? workerError.message : String(workerError),
    );
  }
}

function runMainThreadSegmentation(state, timestampMs) {
  const startedAt = performance.now();
  let result;
  try {
    result = state.segmenter.segmentForVideo(state.analysis.canvas, timestampMs);
    const personMask = result?.confidenceMasks?.[0];
    if (!personMask) throw new Error("MediaPipe returned no person mask.");
    acceptMainThreadMask(
      state,
      {
        width: personMask.width,
        height: personMask.height,
        values: personMask.getAsFloat32Array(),
      },
      timestampMs,
    );
    recordSegmentation(state, performance.now() - startedAt);
  } catch (error) {
    recordSegmentationError(
      state,
      error instanceof Error ? error.message : String(error),
      performance.now() - startedAt,
    );
  } finally {
    result?.close?.();
  }
}

/**
 * Capture only after both the scheduling slot and single-in-flight guard pass.
 * The output-size snapshot is the sole camera read; the model input is scaled
 * from it. pendingFrame stays untouched until completion or failure.
 */
async function runSegmentationTick(state) {
  const now = performance.now();
  if (
    !state.running ||
    state.effectMode === "none" ||
    state.segmentationBusy ||
    state.fallbackPromise ||
    state.workerFailed ||
    now < state.retrySegmentationAt
  ) {
    return;
  }
  const allocation = state.getAllocation();
  const targetFps = state.executionMode === "main-thread"
    ? Math.min(allocation.targetFps, MAIN_THREAD_MAX_FPS[allocation.level])
    : allocation.targetFps;
  // A duplicate camera frame must not consume a scheduled inference slot.
  // Wait for a decoded frame instead of repeatedly scheduling an overdue timer.
  if (state.video.currentTime === state.lastSegmentedVideoTime) {
    state.waitingForCameraFrame = true;
    cancelSegmentationTimer(state);
    return;
  }
  state.waitingForCameraFrame = false;
  if (!claimSegmentationSlot(state, now, targetFps)) {
    scheduleSegmentation(state);
    return;
  }
  state.lastSegmentedVideoTime = state.video.currentTime;

  state.segmentationBusy = true;
  try {
    drawCover(state.pendingFrame.context, state.video, OUTPUT.width, OUTPUT.height);
    state.analysis.context.clearRect(0, 0, ANALYSIS.width, ANALYSIS.height);
    drawCover(
      state.analysis.context,
      state.pendingFrame.canvas,
      ANALYSIS.width,
      ANALYSIS.height,
    );
    // Strictly increasing MediaPipe VIDEO time also identifies the retained frame.
    state.lastMediaPipeTimestamp = Math.max(
      Math.floor(now),
      state.lastMediaPipeTimestamp + 1,
    );
    state.pendingFrameTimestampMs = state.lastMediaPipeTimestamp;
    if (state.executionMode === "main-thread") {
      runMainThreadSegmentation(state, state.lastMediaPipeTimestamp);
      scheduleSegmentation(state);
      return;
    }

    const bitmap = typeof state.analysis.canvas.transferToImageBitmap === "function"
      ? state.analysis.canvas.transferToImageBitmap()
      : await createImageBitmap(state.analysis.canvas);
    if (!state.running) {
      bitmap.close();
      return;
    }
    state.worker.postMessage(
      {
        type: "segment",
        bitmap,
        timestampMs: state.lastMediaPipeTimestamp,
      },
      [bitmap],
    );
  } catch (error) {
    recordSegmentationError(
      state,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!state.segmentationBusy) scheduleSegmentation(state);
}

// -----------------------------------------------------------------------------
// Completed-pair composition; camera callbacks only drive raw mode and telemetry
// -----------------------------------------------------------------------------

function drawDirectVideo(state) {
  state.output.context.clearRect(0, 0, OUTPUT.width, OUTPUT.height);
  drawCover(state.output.context, applyLiteBeauty(state, state.video), OUTPUT.width, OUTPUT.height);
}

// An optional beauty failure must never disable blur or image replacement.
function applyLiteBeauty(state, source) {
  try { return state.beauty.process(source); }
  catch (error) {
    state.lastBeautyError = String(error.message ?? error);
    state.beauty.setStrength(0);
    return source;
  }
}

function drawBlurBackground(state, source) {
  state.blur.context.save();
  state.blur.context.clearRect(0, 0, BLUR.width, BLUR.height);
  state.blur.context.filter = `blur(${BLUR.pixels}px)`;
  drawCover(
    state.blur.context,
    source,
    BLUR.width,
    BLUR.height,
    BLUR.pixels * 2,
  );
  state.blur.context.restore();
  state.output.context.clearRect(0, 0, OUTPUT.width, OUTPUT.height);
  state.output.context.drawImage(
    state.blur.canvas,
    0,
    0,
    OUTPUT.width,
    OUTPUT.height,
  );
}

function drawForeground(state, source) {
  source = applyLiteBeauty(state, source);
  state.foreground.context.save();
  state.foreground.context.clearRect(0, 0, OUTPUT.width, OUTPUT.height);
  state.foreground.context.globalCompositeOperation = "source-over";
  state.foreground.context.filter = "none";
  drawCover(
    state.foreground.context,
    source,
    OUTPUT.width,
    OUTPUT.height,
  );
  state.foreground.context.globalCompositeOperation = "destination-in";
  state.foreground.context.filter = "blur(0.8px)";
  state.foreground.context.drawImage(
    state.mask.canvas,
    -MASK_RENDER_PADDING,
    -MASK_RENDER_PADDING,
    OUTPUT.width + MASK_RENDER_PADDING * 2,
    OUTPUT.height + MASK_RENDER_PADDING * 2,
  );
  state.foreground.context.restore();
  state.output.context.drawImage(state.foreground.canvas, 0, 0);
}

/**
 * Publish a new completed pair, redraw it after an effect change, or draw raw
 * video when no usable pair exists. Do not combine live video with a cached
 * mask. Canvas capture/encoding/display add latency beyond this function.
 */
function renderFrame(state, now) {
  if (!state.running) return;
  const ready =
    state.inputTrack.enabled &&
    !state.inputTrack.muted &&
    state.inputTrack.readyState === "live" &&
    state.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  state.output.track.enabled = state.inputTrack.enabled;
  if (!ready) return;

  const maskIsFresh = state.hasMask &&
    state.pairedFrameTimestampMs === state.maskSourceTimestampMs &&
    now - state.maskSourceTimestampMs <= MASK_MAX_AGE_MS;
  // Leave the completed output untouched while another camera frame is being
  // segmented. Redrawing the live video here would reintroduce contour lag.
  if (state.effectMode !== "none" && maskIsFresh && !state.pairNeedsRender) return;
  try {
    if (state.effectMode === "none" || !maskIsFresh) {
      drawDirectVideo(state);
    } else {
      if (state.effectMode === "image") {
        state.output.context.clearRect(0, 0, OUTPUT.width, OUTPUT.height);
        state.output.context.drawImage(state.background.canvas, 0, 0);
      } else {
        drawBlurBackground(state, state.pairedFrame.canvas);
      }
      drawForeground(state, state.pairedFrame.canvas);
      state.lastCompositeLatencyMs = performance.now() - state.pairedFrameTimestampMs;
      state.pairedFrames += 1;
    }
  } catch (error) {
    state.lastRenderError = error instanceof Error ? error.message : String(error);
    drawDirectVideo(state);
  }

  state.pairNeedsRender = false;
  state.renderedFrames += 1;
  const elapsed = now - state.renderWindowStartedAt;
  if (elapsed >= 1000) {
    state.measuredRenderFps = Number(
      ((state.renderedFrames * 1000) / elapsed).toFixed(1),
    );
    state.renderedFrames = 0;
    state.renderWindowStartedAt = now;
  }
}

// -----------------------------------------------------------------------------
function resumeSegmentationOnCameraFrame(state) {
  const wasWaiting = state.waitingForCameraFrame;
  state.waitingForCameraFrame = false;
  // Send an eligible new frame to the Worker before spending time compositing.
  // Main-thread inference retains its timer so it does not block this callback.
  const now = performance.now();
  if (state.executionMode === "worker" && state.running &&
      state.effectMode !== "none" && !state.segmentationBusy &&
      (wasWaiting || now + SCHEDULE_TOLERANCE_MS >= state.nextSegmentationAt)) {
    cancelSegmentationTimer(state);
    return runSegmentationTick(state);
  }
  if (wasWaiting) scheduleSegmentation(state);
}

// Camera callbacks measure delivery pressure and resume waiting inference.
// In active effects, renderFrame normally leaves the previous paired output
// untouched; Worker completion is what publishes the next processed image.
function scheduleFrame(state) {
  if (!state.running) return;
  if (typeof state.video.requestVideoFrameCallback === "function") {
    state.videoFrameCallbackId = state.video.requestVideoFrameCallback(
      (now) => {
        noteSessionFrame(1000 / OUTPUT.fps);
        resumeSegmentationOnCameraFrame(state);
        renderFrame(state, now);
        scheduleFrame(state);
      },
    );
  } else {
    state.animationFrameId = requestAnimationFrame((now) => {
      if (state.video.currentTime !== state.lastRenderedVideoTime) {
        state.lastRenderedVideoTime = state.video.currentTime;
        noteSessionFrame(1000 / OUTPUT.fps);
        resumeSegmentationOnCameraFrame(state);
        renderFrame(state, now);
      }
      scheduleFrame(state);
    });
  }
}

// -----------------------------------------------------------------------------
// Effects, diagnostics, and public lifecycle
// -----------------------------------------------------------------------------

function setEffect(state, options = {}) {
  if (!EFFECT_MODES.has(options.mode)) {
    throw new RangeError('Lite mode must be "none", "blur", or "image".');
  }
  if (options.mode === "image") {
    const image = options.image ?? state.background.image;
    if (!(image?.naturalWidth || image?.width)) {
      throw new TypeError("Image mode requires a decoded image.");
    }
    if (image !== state.background.image) {
      const previousImage = state.background.image;
      state.background.context.fillStyle = "#202020";
      state.background.context.fillRect(0, 0, OUTPUT.width, OUTPUT.height);
      drawCover(state.background.context, image, OUTPUT.width, OUTPUT.height);
      state.background.image = image;
      state.background.name = options.imageName ?? "uploaded image";
      previousImage?.close?.();
    }
  }
  const previousMode = state.effectMode;
  state.effectMode = options.mode;
  state.pairNeedsRender = true;
  if (options.mode === "none") {
    cancelSegmentationTimer(state);
  } else if (previousMode === "none") {
    // Use request identity rather than wall-clock comparisons. Do not clear the
    // busy flag: a pending Worker result must drain before we reuse its buffer.
    state.discardPairsThroughTimestampMs = state.lastMediaPipeTimestamp;
    state.hasMask = false;
    state.pairedFrameTimestampMs = null;
    state.waitingForCameraFrame = false;
    state.nextSegmentationAt = -Infinity;
    scheduleSegmentation(state);
  }
}

function getState(state) {
  const allocator = state.getAllocation();
  const maskProvider = {
    type: `mediapipe-${state.executionMode}-confidence-mask`,
    model: MODEL_NAME,
    modelAssetPath: MODEL_URL,
    delegate: "CPU",
    worker: state.executionMode === "worker",
    residentModelInstances: 1,
    eyeGazeActive: allocator.eyeGazeActive,
    segmentationRuns: state.segmentationRuns,
    segmentationErrors: state.segmentationErrors,
    averageInferenceMs: Number(state.averageInferenceMs.toFixed(1)),
    averageMaskLatencyMs: Number(state.averageMaskLatencyMs.toFixed(1)),
    lastMaskLatencyMs: Number(state.lastMaskLatencyMs.toFixed(1)),
    waitingForCameraFrame: state.waitingForCameraFrame,
    measuredSegmentationFps: state.maskCompletedTimes.filter(at => performance.now() - at < 1000).length,
    deliveryStalls: state.deliveryStalls,
    schedulingLatencyMs: Number(getSchedulingLatencyMs(state).toFixed(1)),
    averageMaskIntervalMs: Number(state.averageMaskIntervalMs.toFixed(1)),
    maskAgeMs: state.hasMask
      ? Math.round(performance.now() - state.maskSourceTimestampMs)
      : null,
  };
  return {
    engine: "lite-cpu",
    beautySupported: true,
    beautyStrength: state.beauty.getState().strength,
    beauty: state.beauty.getState(),
    lastBeautyError: state.lastBeautyError,
    mode: state.executionMode,
    compositionMode: "same-source-frame",
    framePairing: {
      sourceBuffers: 2,
      pendingFrames: state.pendingFrameTimestampMs === null ? 0 : 1,
      completedFrames: state.pairedFrames,
      droppedLatePairs: state.droppedLatePairs,
      maxPairLatencyMs: PAIR_MAX_LATENCY_MS,
      lastCompositeLatencyMs: Number(state.lastCompositeLatencyMs.toFixed(1)),
      sourceTimestampMs: state.pairedFrameTimestampMs,
      maskTimestampMs: state.hasMask ? state.maskSourceTimestampMs : null,
    },
    running: state.running,
    enabled: state.effectMode === "blur",
    effectMode: state.effectMode,
    imageSupported: true,
    imageName: state.background.name,
    model: MODEL_NAME,
    modelAssetPath: MODEL_URL,
    delegate: `CPU ${state.executionMode}`,
    processingSize: OUTPUT,
    analysisSize: ANALYSIS,
    analysisTransfer: typeof state.analysis.canvas.transferToImageBitmap === "function"
      ? "synchronous-offscreen" : "async-image-bitmap",
    measuredRenderFps: state.measuredRenderFps,
    hasMask: state.hasMask,
    allocator,
    maskProvider,
    workerInfo: state.workerInfo,
    workerFallbackReason: state.workerFallbackReason,
    lastSegmentationError: state.lastSegmentationError,
    lastRenderError: state.lastRenderError,
    inputTrackState: state.inputTrack.readyState,
    outputTrackState: state.output.track.readyState,
  };
}

/**
 * Lifetime-owned surfaces and scheduler state for one Lite instance. The two
 * source buffers exchange roles; they are not a growing frame queue. Timing
 * fields ending in Ms use the main-thread monotonic clock unless noted.
 */
function createRuntimeState(inputTrack, video, outputTrack, surfaces) {
  const state = {
    running: true,
    effectMode: "blur",
    beauty: createLiteBeauty(OUTPUT.width, OUTPUT.height),
    lastBeautyError: null,
    inputTrack,
    video,
    output: { ...surfaces.output, track: outputTrack },
    analysis: surfaces.analysis,
    pendingFrame: surfaces.pendingFrame,
    pairedFrame: surfaces.pairedFrame,
    pendingFrameTimestampMs: null,
    pairedFrameTimestampMs: null,
    discardPairsThroughTimestampMs: -Infinity,
    // The source buffers and uploaded image outlive effect toggles. Only their
    // accepted-pair identity changes; destruction owns resource release.
    pairNeedsRender: false,
    pairedFrames: 0,
    droppedLatePairs: 0,
    lastCompositeLatencyMs: 0,
    mask: { ...surfaces.mask, image: null },
    foreground: surfaces.foreground,
    blur: surfaces.blur,
    background: { ...surfaces.background, image: null, name: null },
    worker: null,
    workerObjectUrl: null,
    segmenter: null,
    executionMode: "worker",
    workerInfo: null,
    workerFallbackReason: null,
    fallbackPromise: null,
    segmentationBusy: false,
    waitingForCameraFrame: false,
    workerFailed: false,
    hasMask: false,
    maskSourceTimestampMs: -Infinity,
    averageMaskIntervalMs: 0,
    averageMaskLatencyMs: 0,
    maskLatencySamples: [],
    maskCompletedTimes: [],
    deliveryStalls: 0,
    lastMaskLatencyMs: 0,
    nextSegmentationAt: -Infinity,
    scheduledTargetFps: 0,
    // Worker warmup reserves VIDEO timestamps 0 and 1; live frames follow them.
    lastMediaPipeTimestamp: 1,
    lastSegmentedVideoTime: -1,
    lastRenderedVideoTime: -1,
    videoFrameCallbackId: null,
    animationFrameId: null,
    segmentationTimerId: null,
    segmentationRuns: 0,
    segmentationErrors: 0,
    consecutiveErrors: 0,
    retrySegmentationAt: -Infinity,
    averageInferenceMs: 0,
    lastSegmentationError: null,
    lastRenderError: null,
    renderedFrames: 0,
    measuredRenderFps: 0,
    renderWindowStartedAt: performance.now(),
    getAllocation: null,
  };
  state.getAllocation = createScheduler(state);
  return state;
}

// Stop callbacks and owned output resources; the router owns the camera clone
// and releases it separately. Shared microphone tracks must never be stopped.
export async function destroyLiteBackground() {
  const state = activeState;
  activeState = null;
  if (!state) return;
  state.running = false;
  state.pendingFrameTimestampMs = null;
  cancelSegmentationTimer(state);
  if (
    state.videoFrameCallbackId !== null &&
    typeof state.video.cancelVideoFrameCallback === "function"
  ) {
    state.video.cancelVideoFrameCallback(state.videoFrameCallbackId);
  }
  if (state.animationFrameId !== null) {
    cancelAnimationFrame(state.animationFrameId);
  }
  state.worker?.terminate();
  releaseWorkerObjectUrl(state);
  state.segmenter?.close?.();
  state.background.image?.close?.();
  state.beauty.destroy();
  state.output.track?.stop?.();
  state.video.pause();
  state.video.srcObject = null;
  state.video.remove();
}

export async function backgroundLite(stream) {
  if (!(stream instanceof MediaStream)) {
    return { ok: false, stream, reason: "Invalid MediaStream" };
  }
  const inputVideoTrack = stream.getVideoTracks()[0];
  if (!inputVideoTrack) return { ok: false, stream, reason: "No video track" };
  if (typeof HTMLCanvasElement.prototype.captureStream !== "function") {
    return { ok: false, stream, reason: "Canvas captureStream is unavailable" };
  }
  await destroyLiteBackground();
  let state;
  try {
    // 1. Keep camera and output sizes predictable for both rendering paths.
    try {
      await inputVideoTrack.applyConstraints({
        width: { ideal: 640, max: 640 },
        height: { ideal: 480, max: 480 },
        frameRate: { ideal: OUTPUT.fps, max: OUTPUT.fps },
      });
    } catch {
      // The renderer still works with the camera's current constraints.
    }

    // 2. Create the fixed canvases once; no canvas is allocated per frame.
    const video = createHiddenVideo(inputVideoTrack);
    const output = createCanvas(OUTPUT.width, OUTPUT.height, {
      alpha: false,
      desynchronized: true,
    });
    const analysis = createAnalysisCanvas();
    const pendingFrame = createCanvas(OUTPUT.width, OUTPUT.height, { alpha: false });
    const pairedFrame = createCanvas(OUTPUT.width, OUTPUT.height, { alpha: false });
    const mask = createCanvas(ANALYSIS.width, ANALYSIS.height, { alpha: true });
    const foreground = createCanvas(OUTPUT.width, OUTPUT.height, {
      alpha: true,
      desynchronized: true,
    });
    const blur = createCanvas(BLUR.width, BLUR.height, {
      alpha: false,
      desynchronized: true,
    });
    const background = createCanvas(OUTPUT.width, OUTPUT.height, { alpha: false });
    const outputTrack = output.canvas
      .captureStream(OUTPUT.fps)
      .getVideoTracks()[0];
    if (!outputTrack) throw new Error("Canvas capture produced no video track.");

    state = createRuntimeState(inputVideoTrack, video, outputTrack, {
      output,
      analysis,
      pendingFrame,
      pairedFrame,
      mask,
      foreground,
      blur,
      background,
    });

    // 3. Prefer Worker inference; transparently retain the same-model fallback.
    await startSegmentationBackend(state);

    // 4. Camera ticks schedule work; completed masks publish matched frames.
    activeState = state;
    scheduleSegmentation(state);
    scheduleFrame(state);

    const processedStream = new MediaStream([outputTrack]);
    stream.getAudioTracks().forEach((track) => processedStream.addTrack(track));
    inputVideoTrack.addEventListener(
      "ended",
      () => {
        if (activeState === state) void destroyLiteBackground();
      },
      { once: true },
    );

    return {
      ok: true,
      stream: processedStream,
      mode: "lite-cpu",
      reason: state.executionMode === "worker"
        ? "MediaPipe CPU worker started"
        : "MediaPipe CPU main-thread fallback started",
      nativeEffects: true,
      imageSupported: true,
      setEffect: (options) => setEffect(state, options),
      beautySupported: true,
      setBeautyStrength: (value) => {
        if (!state.running) throw new Error("Lite is no longer running");
        state.beauty.setStrength(value);
        state.lastBeautyError = null;
        state.pairNeedsRender = true;
      },
      getState: () => getState(state),
      destroy: destroyLiteBackground,
    };
  } catch (error) {
    if (state) {
      activeState = state;
      await destroyLiteBackground();
    }
    return {
      ok: false,
      stream,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
