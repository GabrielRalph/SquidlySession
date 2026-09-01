/**
 * Shared MediaPipe Tasks Vision loader.
 *
 * Eye gaze and background segmentation need different task models, but they
 * can still share one ESM module, one version, and one resolved WASM fileset.
 * Keeping this in a small neutral module also prevents the two features from
 * silently drifting to incompatible MediaPipe/WASM versions again.
 */

import * as vision from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/+esm";

export const MEDIAPIPE_VERSION = "0.10.32";
export const VISION_BUNDLE_URL =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/+esm`;
export const WASM_BASE_PATH =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

let filesetPromise = null;
const taskActivity = new Map();
const instrumentedFaceLandmarkers = new WeakSet();
const PERFORMANCE_WINDOW_MS = 5000;
const longTaskSamples = [];
const frameSamples = [];
let performanceObserver = null;
let lastSessionFrameAt = -Infinity;
let sharedFaceLandmarker = null;
let faceLandmarkerInfo = {
  model: "face_landmarker.task",
  delegate: "unknown",
};
let lastFaceTimestamp = -1;
let faceDetectionRuns = 0;
let faceDetectionReuses = 0;
let latestFaceDetection = {
  detectedAt: -Infinity,
  landmarks: null,
  result: null,
};

function trimSamples(samples, now, getTime = (sample) => sample.at) {
  const cutoff = now - PERFORMANCE_WINDOW_MS;
  while (samples.length && getTime(samples[0]) < cutoff) samples.shift();
}

function ensurePerformanceObserver() {
  if (performanceObserver || typeof globalThis.PerformanceObserver !== "function") {
    return;
  }
  const supported = globalThis.PerformanceObserver.supportedEntryTypes ?? [];
  if (!supported.includes("longtask")) return;
  try {
    performanceObserver = new globalThis.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskSamples.push({ at: entry.startTime, duration: entry.duration });
      }
      trimSamples(longTaskSamples, performance.now());
    });
    performanceObserver.observe({ type: "longtask", buffered: true });
  } catch {
    performanceObserver = null;
  }
}

function getTaskState(now) {
  return Object.fromEntries(
    [...taskActivity.entries()].map(([name, activity]) => {
      activity.recentRuns = activity.recentRuns.filter(
        (timestamp) => timestamp >= now - PERFORMANCE_WINDOW_MS,
      );
      const observedMs = Math.max(
        1000,
        Math.min(PERFORMANCE_WINDOW_MS, now - activity.firstRunAt),
      );
      const runsPerSecond = activity.recentRuns.length * 1000 / observedMs;
      return [name, {
        active: now - activity.lastRunAt <= 500,
        lastRunAgoMs: Math.round(now - activity.lastRunAt),
        lastDurationMs: Number(activity.durationMs.toFixed(1)),
        averageDurationMs: Number(activity.averageDurationMs.toFixed(1)),
        runsPerSecond: Number(runsPerSecond.toFixed(1)),
        estimatedLoad: Number(
          ((activity.averageDurationMs * runsPerSecond) / 1000).toFixed(2),
        ),
      }];
    }),
  );
}

function nextFaceTimestamp(timestamp) {
  const value = Number.isFinite(timestamp) ? Math.max(0, timestamp) : 0;
  lastFaceTimestamp = Math.max(value, lastFaceTimestamp + 1);
  return lastFaceTimestamp;
}

export function getVisionModule() {
  return vision;
}

export function getVisionFileset() {
  if (!filesetPromise) {
    filesetPromise = vision.FilesetResolver
      .forVisionTasks(WASM_BASE_PATH)
      .catch((error) => {
        // Allow a later retry after a transient CDN or WASM initialisation error.
        filesetPromise = null;
        throw error;
      });
  }

  return filesetPromise;
}

function instrumentFaceLandmarker(landmarker) {
  if (
    !landmarker ||
    instrumentedFaceLandmarkers.has(landmarker) ||
    typeof landmarker.detectForVideo !== "function"
  ) {
    return landmarker;
  }

  const detectForVideo = landmarker.detectForVideo;
  Object.defineProperty(landmarker, "detectForVideo", {
    configurable: true,
    writable: true,
    value(source, timestamp, ...args) {
      const now = performance.now();
      if (now - latestFaceDetection.detectedAt <= 34) {
        faceDetectionReuses += 1;
        return latestFaceDetection.result;
      }

      const startedAt = performance.now();
      try {
        const result = detectForVideo.call(
          this,
          source,
          nextFaceTimestamp(timestamp),
          ...args,
        );
        latestFaceDetection = {
          detectedAt: now,
          landmarks: result.faceLandmarks?.[0] ?? null,
          result,
        };
        faceDetectionRuns += 1;
        return result;
      } finally {
        noteVisionTaskRun("face-landmarker", performance.now() - startedAt);
      }
    },
  });
  instrumentedFaceLandmarkers.add(landmarker);
  return landmarker;
}

// Compatibility facade for the original face-mesh.js. It lets that module
// change only its import while this runtime owns Fileset sharing and timing.
export const FilesetResolver = Object.freeze({
  forVisionTasks() {
    return getVisionFileset();
  },
});

export const FaceLandmarker = Object.freeze({
  async createFromOptions(...args) {
    const landmarker = await vision.FaceLandmarker.createFromOptions(...args);
    const options = args[1] ?? {};
    const modelAssetPath = String(options.baseOptions?.modelAssetPath ?? "");
    faceLandmarkerInfo = {
      model: modelAssetPath.split(/[\\/]/).pop() || "face_landmarker.task",
      modelAssetPath,
      delegate: options.baseOptions?.delegate ?? "CPU",
    };
    console.info(
      `[Squidly Models] EyeGaze FaceLandmarker: ${faceLandmarkerInfo.model} ` +
      `(${faceLandmarkerInfo.delegate}). ` +
      "Run window.squidlyBackground.report() for the full model/resource report.",
    );
    sharedFaceLandmarker = instrumentFaceLandmarker(landmarker);
    latestFaceDetection = {
      detectedAt: -Infinity,
      landmarks: null,
      result: null,
    };
    lastFaceTimestamp = -1;
    return sharedFaceLandmarker;
  },
});

/**
 * Returns the singleton FaceLandmarker result used by EyeGaze. A recent
 * EyeGaze/beauty result is reused; otherwise this call performs one inference.
 */
export function getSharedFaceLandmarks(source, maxAgeMs = 50) {
  const cacheAge = Math.max(0, Number(maxAgeMs) || 0);
  if (performance.now() - latestFaceDetection.detectedAt <= cacheAge) {
    faceDetectionReuses += 1;
    return latestFaceDetection.landmarks;
  }
  if (!sharedFaceLandmarker) return null;
  return sharedFaceLandmarker.detectForVideo(
    source,
    performance.now(),
  )?.faceLandmarks?.[0] ?? null;
}

export function getLatestFaceLandmarks(maxAgeMs = 150) {
  return performance.now() - latestFaceDetection.detectedAt <= maxAgeMs
    ? latestFaceDetection.landmarks
    : null;
}

/** Records delivered video cadence against its expected interval, without logging. */
export function noteSessionFrame(expectedIntervalMs = 1000 / 30) {
  const now = performance.now();
  if (Number.isFinite(lastSessionFrameAt)) {
    frameSamples.push({
      at: now,
      interval: now - lastSessionFrameAt,
      expectedInterval: Math.max(1, Number(expectedIntervalMs) || 1000 / 30),
    });
    trimSamples(frameSamples, now);
  }
  lastSessionFrameAt = now;
}

/** Returns rolling whole-session pressure signals used by video schedulers. */
export function getSessionPerformanceState() {
  ensurePerformanceObserver();
  const now = performance.now();
  trimSamples(longTaskSamples, now);
  trimSamples(frameSamples, now);
  const longTaskTimeMs = longTaskSamples.reduce(
    (total, sample) => total + sample.duration,
    0,
  );
  const averageFrameIntervalMs = frameSamples.length
    ? frameSamples.reduce((total, sample) => total + sample.interval, 0) /
      frameSamples.length
    : 0;
  const slowFrames = frameSamples.filter(
    (sample) => sample.interval > Math.max(50, sample.expectedInterval * 1.5),
  ).length;
  const tasks = getTaskState(now);
  const estimatedVisionLoad = Object.values(tasks).reduce(
    (total, task) => total + task.estimatedLoad,
    0,
  );
  return {
    windowMs: PERFORMANCE_WINDOW_MS,
    visibility: typeof document === "undefined" ? "unknown" : document.visibilityState,
    longTaskApiSupported: Boolean(performanceObserver),
    longTaskCount: longTaskSamples.length,
    longTaskTimeMs: Math.round(longTaskTimeMs),
    longTaskRatio: Number(
      Math.min(1, longTaskTimeMs / PERFORMANCE_WINDOW_MS).toFixed(2),
    ),
    frameSamples: frameSamples.length,
    averageFrameIntervalMs: Number(averageFrameIntervalMs.toFixed(1)),
    estimatedFrameFps: averageFrameIntervalMs
      ? Number((1000 / averageFrameIntervalMs).toFixed(1))
      : 0,
    slowFrameRatio: frameSamples.length
      ? Number((slowFrames / frameSamples.length).toFixed(2))
      : 0,
    estimatedVisionLoad: Number(estimatedVisionLoad.toFixed(2)),
    tasks,
  };
}

/** Converts rolling session telemetry into one shared pressure classification. */
export function classifySessionPerformance(
  performanceState = getSessionPerformanceState(),
) {
  if (performanceState.visibility === "hidden") {
    return { level: "hidden", reasons: ["Page is hidden"] };
  }

  const criticalReasons = [];
  const constrainedReasons = [];
  if (performanceState.longTaskRatio >= 0.18) {
    criticalReasons.push("main-thread long tasks >= 18%");
  } else if (performanceState.longTaskRatio >= 0.06) {
    constrainedReasons.push("main-thread long tasks >= 6%");
  }
  if (performanceState.frameSamples >= 10) {
    if (performanceState.slowFrameRatio >= 0.28) {
      criticalReasons.push("late video frames >= 28%");
    } else if (performanceState.slowFrameRatio >= 0.12) {
      constrainedReasons.push("late video frames >= 12%");
    }
  }
  if (performanceState.estimatedVisionLoad >= 0.78) {
    criticalReasons.push("estimated vision load >= 78%");
  } else if (performanceState.estimatedVisionLoad >= 0.52) {
    constrainedReasons.push("estimated vision load >= 52%");
  }

  if (criticalReasons.length) {
    return { level: "critical", reasons: criticalReasons };
  }
  if (constrainedReasons.length) {
    return { level: "constrained", reasons: constrainedReasons };
  }
  return { level: "normal", reasons: ["Session within budget"] };
}

export function noteVisionTaskRun(taskName, durationMs = 0) {
  const now = performance.now();
  const duration = Number.isFinite(durationMs) ? durationMs : 0;
  const previous = taskActivity.get(taskName);
  const recentRuns = previous?.recentRuns ?? [];
  recentRuns.push(now);
  trimSamples(recentRuns, now, (timestamp) => timestamp);
  taskActivity.set(taskName, {
    firstRunAt: previous?.firstRunAt ?? now,
    lastRunAt: now,
    durationMs: duration,
    averageDurationMs: previous
      ? previous.averageDurationMs * 0.8 + duration * 0.2
      : duration,
    recentRuns,
  });
}

export function wasVisionTaskRecentlyActive(taskName, withinMs = 500) {
  const activity = taskActivity.get(taskName);
  return Boolean(activity) && performance.now() - activity.lastRunAt <= withinMs;
}

export function getVisionRuntimeState() {
  const now = performance.now();
  const sessionPerformance = getSessionPerformanceState();
  return {
    version: MEDIAPIPE_VERSION,
    sharedModule: true,
    sharedWasmFileset: Boolean(filesetPromise),
    faceLandmarker: {
      ...faceLandmarkerInfo,
      sharedInstances: sharedFaceLandmarker ? 1 : 0,
      detectionRuns: faceDetectionRuns,
      reusedResults: faceDetectionReuses,
      resultAgeMs: Number.isFinite(latestFaceDetection.detectedAt)
        ? Math.round(now - latestFaceDetection.detectedAt)
        : null,
    },
    tasks: sessionPerformance.tasks,
    sessionPerformance,
  };
}
