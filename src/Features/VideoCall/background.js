/**
 * Squidly background processing.
 * Gregblur owns frame/track lifecycle and GPU compositing; Squidly provides
 * the shared MediaPipe runtime and Eye-gaze-aware segmentation scheduling.
 */

import { createRawBackgroundProcessor } from "./gregblur/raw.js";
import {
  classifySessionPerformance,
  getLatestFaceLandmarks,
  getSessionPerformanceState,
  getSharedFaceLandmarks,
  getVisionFileset,
  getVisionModule,
  getVisionRuntimeState,
  noteVisionTaskRun,
  noteSessionFrame,
  wasVisionTaskRecentlyActive,
} from "../../Utilities/MediaPipe/vision-runtime.js";

// -----------------------------------------------------------------------------
// Engine configuration
// -----------------------------------------------------------------------------

const MULTICLASS_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/" +
  "selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";

const MODELS = Object.freeze({
  high: Object.freeze({
    name: "selfie-multiclass-256",
    url: MULTICLASS_MODEL_URL,
    segmentationFps: 30,
    gazeSegmentationFps: 20,
  }),
  balanced: Object.freeze({
    name: "selfie-multiclass-256",
    url: MULTICLASS_MODEL_URL,
    segmentationFps: 30,
    gazeSegmentationFps: 12,
  }),
});

const BLUR_OPTIONS = Object.freeze({
  blurRadius: 25,
  downsampleFactor: 2,
  temporalBlendFactor: 0.24,
  bilateralSigmaSpace: 4,
  bilateralSigmaColor: 0.1,
});

const WEBGL_OPTIONS = Object.freeze({
  powerPreference: "high-performance",
  failIfMajorPerformanceCaveat: true,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  antialias: false,
  depth: false,
  stencil: false,
});

const SOFTWARE_RENDERERS = [
  "microsoft basic render driver",
  "swiftshader",
  "llvmpipe",
  "software",
];

const RESOURCE_LEVELS = Object.freeze({
  normal: Object.freeze({ rank: 0, multiplier: 1 }),
  constrained: Object.freeze({ rank: 1, multiplier: 0.65 }),
  critical: Object.freeze({ rank: 2, multiplier: 0.4 }),
  hidden: Object.freeze({ rank: 3 }),
});
const RESOURCE_LEVEL_ORDER = Object.freeze([
  "normal",
  "constrained",
  "critical",
  "hidden",
]);
const RESOURCE_CHECK_INTERVAL_MS = 1000;
const RESOURCE_DOWNGRADE_COOLDOWN_MS = 2500;
const RESOURCE_RECOVERY_MS = 10000;
const RESOURCE_WARMUP_MS = 2000;
const RESOURCE_WARMUP_MAX_FPS = 20;

// -----------------------------------------------------------------------------
// Router state
// -----------------------------------------------------------------------------

let activeEngine = null;
let lifecycleCleanupInstalled = false;

// -----------------------------------------------------------------------------
// Hardware and quality profile resolution
// -----------------------------------------------------------------------------

function inspectRenderer() {
  const canvas = document.createElement("canvas");
  let gl = canvas.getContext("webgl2", WEBGL_OPTIONS);
  if (!gl) {
    gl = canvas.getContext("webgl2", {
      ...WEBGL_OPTIONS,
      failIfMajorPerformanceCaveat: false,
    });
  }
  if (!gl) {
    return {
      supported: false,
      renderer: "WebGL2 unavailable",
      vendor: "unavailable",
      softwareRenderer: true,
    };
  }

  const extension = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(
    extension
      ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER),
  );
  const vendor = String(
    extension
      ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)
      : gl.getParameter(gl.VENDOR),
  );
  const lowerRenderer = renderer.toLowerCase();
  const softwareRenderer = SOFTWARE_RENDERERS.some((token) =>
    lowerRenderer.includes(token),
  );
  try {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // The diagnostic context is short-lived even when explicit loss fails.
  }
  return { supported: true, renderer, vendor, softwareRenderer };
}

function chooseProfile(requestedQuality) {
  if (requestedQuality === "high" || requestedQuality === "balanced") {
    return requestedQuality;
  }
  // Start safely on every device. Fast machines can opt into `high`, while
  // `balanced` lets the measured allocator decide how much GPU work is safe.
  return "balanced";
}

// -----------------------------------------------------------------------------
// Camera setup and shared MediaPipe segmentation provider
// -----------------------------------------------------------------------------

async function applyCameraConstraints(track) {
  try {
    await track.applyConstraints({
      width: { ideal: 640, max: 640 },
      height: { ideal: 480, max: 480 },
      frameRate: { ideal: 30, max: 30 },
    });
  } catch (error) {
    console.warn("[Background] Camera constraints were not applied.", error);
  }
  return track.getSettings?.() ?? {};
}

function createAdaptiveResourceAllocator(profile) {
  const startedAt = performance.now();
  let level = "normal";
  let lastEvaluationAt = -Infinity;
  let lastTransitionAt = -Infinity;
  let recoveryStartedAt = null;
  let transitions = 0;
  let snapshot = null;

  const classify = (performanceState, eyeGazeActive) => {
    const faceTask = performanceState.tasks["face-landmarker"];
    const backgroundTask = performanceState.tasks["background-segmenter"];
    const sessionPressure = classifySessionPerformance(performanceState);
    if (sessionPressure.level === "hidden") return sessionPressure;
    const criticalReasons = sessionPressure.level === "critical"
      ? [...sessionPressure.reasons]
      : [];
    const constrainedReasons = sessionPressure.level === "constrained"
      ? [...sessionPressure.reasons]
      : [];
    if (eyeGazeActive && (faceTask?.averageDurationMs ?? 0) >= 35) {
      criticalReasons.push("EyeGaze inference >= 35 ms");
    } else if (eyeGazeActive && (faceTask?.averageDurationMs ?? 0) >= 22) {
      constrainedReasons.push("EyeGaze inference >= 22 ms");
    }
    if ((backgroundTask?.averageDurationMs ?? 0) >= 45) {
      criticalReasons.push("background inference >= 45 ms");
    } else if ((backgroundTask?.averageDurationMs ?? 0) >= 28) {
      constrainedReasons.push("background inference >= 28 ms");
    }

    if (criticalReasons.length) {
      return { level: "critical", reasons: criticalReasons };
    }
    if (constrainedReasons.length) {
      return { level: "constrained", reasons: constrainedReasons };
    }
    return {
      level: "normal",
      reasons: [eyeGazeActive ? "EyeGaze active; reserved base budget" : "Session within budget"],
    };
  };

  const evaluate = () => {
    const now = performance.now();
    if (snapshot && now - lastEvaluationAt < RESOURCE_CHECK_INTERVAL_MS) {
      return snapshot;
    }
    lastEvaluationAt = now;
    const performanceState = getSessionPerformanceState();
    const eyeGazeActive = wasVisionTaskRecentlyActive("face-landmarker");
    const measuredPressure = classify(performanceState, eyeGazeActive);
    const warmingUp = now - startedAt < RESOURCE_WARMUP_MS;
    const desired = warmingUp && measuredPressure.level !== "hidden"
      ? { level: "normal", reasons: ["Resource allocator is warming up"] }
      : measuredPressure;
    const currentRank = RESOURCE_LEVELS[level].rank;
    const desiredRank = RESOURCE_LEVELS[desired.level].rank;
    let nextLevel = level;

    if (desired.level === "hidden") {
      nextLevel = "hidden";
      recoveryStartedAt = null;
    } else if (
      desiredRank > currentRank &&
      now - lastTransitionAt >= RESOURCE_DOWNGRADE_COOLDOWN_MS
    ) {
      nextLevel = desired.level;
      recoveryStartedAt = null;
    } else if (desiredRank < currentRank) {
      recoveryStartedAt ??= now;
      if (now - recoveryStartedAt >= RESOURCE_RECOVERY_MS) {
        nextLevel = RESOURCE_LEVEL_ORDER[
          Math.max(desiredRank, currentRank - 1)
        ];
        recoveryStartedAt = null;
      }
    } else {
      recoveryStartedAt = null;
    }

    if (nextLevel !== level) {
      const previousLevel = level;
      level = nextLevel;
      lastTransitionAt = now;
      transitions += 1;
      console.info(
        `[Squidly Resources] ${previousLevel} -> ${level}`,
        desired.reasons.join("; "),
      );
    }

    const baseFps = eyeGazeActive
      ? profile.gazeSegmentationFps
      : profile.segmentationFps;
    const levelFps = level === "hidden"
      ? 1
      : Math.max(3, Math.round(baseFps * RESOURCE_LEVELS[level].multiplier));
    const backgroundInferenceMs =
      performanceState.tasks["background-segmenter"]?.averageDurationMs ?? 0;
    const sustainableFps = backgroundInferenceMs > 0
      ? Math.max(2, Math.floor(700 / backgroundInferenceMs))
      : baseFps;
    // Shader/model startup still gets a short safety window, but capable GPUs
    // no longer spend five seconds reusing a 12 FPS mask.
    const startupFps = warmingUp
      ? Math.min(RESOURCE_WARMUP_MAX_FPS, baseFps)
      : baseFps;
    const targetFps = Math.min(levelFps, sustainableFps, startupFps);
    snapshot = {
      policy: "adaptive-session-budget-v2",
      level,
      desiredLevel: desired.level,
      reasons: desired.reasons,
      eyeGazeActive,
      baseFps,
      targetFps,
      sustainableFps,
      backgroundInferenceMs: Number(backgroundInferenceMs.toFixed(1)),
      transitions,
      warmupInMs: warmingUp
        ? Math.max(0, Math.round(RESOURCE_WARMUP_MS - (now - startedAt)))
        : 0,
      recoveryInMs: recoveryStartedAt === null
        ? 0
        : Math.max(0, Math.round(RESOURCE_RECOVERY_MS - (now - recoveryStartedAt))),
      sessionPerformance: performanceState,
    };
    return snapshot;
  };

  return {
    noteFrame() {
      noteSessionFrame(1000 / 30);
    },
    getTargetFps() {
      return evaluate().targetFps;
    },
    getState: evaluate,
  };
}

function createSharedSegmentationProvider(profile) {
  const allocator = createAdaptiveResourceAllocator(profile);
  let segmenter = null;
  let cachedResult = null;
  let lastTimestamp = -1;
  let lastSegmentationAt = -Infinity;
  let lastMaskUpdatedAt = 0;
  let segmentationRuns = 0;
  let reusedMasks = 0;
  let inferenceTimeTotal = 0;
  const frameResult = {
    confidenceTexture: null,
    updated: false,
    close() {},
  };

  const nextTimestamp = (value) => {
    const normalised = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    lastTimestamp = Math.max(normalised, lastTimestamp + 1);
    return lastTimestamp;
  };
  const closeCachedResult = () => {
    cachedResult?.close?.();
    cachedResult = null;
    frameResult.confidenceTexture = null;
  };
  const targetFps = () => {
    return allocator.getTargetFps();
  };

  const runSegmentation = (source, timestampMs) => {
    if (!segmenter) return false;
    allocator.noteFrame();
    const mayReuse =
      frameResult.confidenceTexture &&
      timestampMs - lastSegmentationAt < 1000 / targetFps();
    if (mayReuse) {
      reusedMasks += 1;
      frameResult.updated = false;
      return true;
    }

    closeCachedResult();
    const startedAt = performance.now();
    let result;
    try {
      result = segmenter.segmentForVideo(source, nextTimestamp(timestampMs));
    } finally {
      const duration = performance.now() - startedAt;
      inferenceTimeTotal += duration;
      noteVisionTaskRun("background-segmenter", duration);
    }

    const backgroundMask = result?.confidenceMasks?.[0];
    if (!backgroundMask) {
      result?.close?.();
      return false;
    }
    try {
      frameResult.confidenceTexture = backgroundMask.getAsWebGLTexture();
      frameResult.updated = true;
      cachedResult = result;
    } catch (error) {
      result.close?.();
      throw error;
    }
    lastSegmentationAt = timestampMs;
    lastMaskUpdatedAt = performance.now();
    segmentationRuns += 1;
    return true;
  };

  return {
    async init(canvas) {
      closeCachedResult();
      segmenter?.close?.();
      lastTimestamp = -1;
      lastSegmentationAt = -Infinity;
      const fileset = await getVisionFileset();
      segmenter = await getVisionModule().ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: profile.url, delegate: "GPU" },
        runningMode: "VIDEO",
        outputCategoryMask: false,
        outputConfidenceMasks: true,
        canvas,
      });
    },

    segment(source, timestampMs) {
      if (!runSegmentation(source, timestampMs)) return null;
      return frameResult;
    },

    getState() {
      const allocation = allocator.getState();
      return {
        type: "mediapipe-multiclass",
        model: profile.name,
        modelAssetPath: profile.url,
        delegate: "GPU",
        sharedBetweenEffects: true,
        residentModelInstances: 1,
        eyeGazeActive: allocation.eyeGazeActive,
        segmentationRuns,
        reusedMasks,
        maskAgeMs: segmentationRuns
          ? Math.round(performance.now() - lastMaskUpdatedAt)
          : null,
        activeSegmentationFps: targetFps(),
        allocator: allocation,
        averageInferenceMs: segmentationRuns
          ? Number((inferenceTimeTotal / segmentationRuns).toFixed(1))
          : 0,
      };
    },

    destroy() {
      closeCachedResult();
      segmenter?.close?.();
      segmenter = null;
    },
  };
}

function createSharedFaceLandmarksProvider() {
  let requests = 0;
  let errors = 0;
  let lastError = null;

  return {
    getLandmarks(source) {
      requests += 1;
      try {
        return getSharedFaceLandmarks(source, 50);
      } catch (error) {
        errors += 1;
        lastError = error instanceof Error ? error.message : String(error);
        return getLatestFaceLandmarks(150);
      }
    },
    getState() {
      return {
        type: "shared-face-landmarker",
        requests,
        errors,
        lastError,
      };
    },
  };
}

// -----------------------------------------------------------------------------
// Gregblur engine
// -----------------------------------------------------------------------------

async function startGregblur(stream, rendererInfo, requestedQuality) {
  const inputTrack = stream.getVideoTracks()[0];
  if (!inputTrack) return { ok: false, stream, reason: "No video track" };

  const profileName = chooseProfile(requestedQuality);
  const profile = MODELS[profileName];
  const settings = await applyCameraConstraints(inputTrack);
  const provider = createSharedSegmentationProvider(profile);
  const faceProvider = createSharedFaceLandmarksProvider();
  const processor = createRawBackgroundProcessor({
    segmentationProvider: provider,
    faceLandmarksProvider: faceProvider,
    ...BLUR_OPTIONS,
  });

  let outputTrack;
  let backgroundImage = null;
  let imageName = null;
  try {
    outputTrack = await processor.start(inputTrack);
    if (!(outputTrack instanceof MediaStreamTrack)) {
      throw new Error("Gregblur did not return a usable output track.");
    }
    try {
      outputTrack.contentHint = inputTrack.contentHint || "motion";
    } catch {
      // Some browsers expose contentHint as read-only.
    }

    const processedStream = new MediaStream([outputTrack]);
    stream.getAudioTracks().forEach((track) => processedStream.addTrack(track));
    let running = true;
    const setEffect = async (options = {}) => {
      if (!running) throw new Error("Gregblur is no longer running.");
      const mode = options.mode;

      if (mode === "image") {
        const previousImage = backgroundImage;
        processor.setEffect({ mode, image: options.image });
        backgroundImage = options.image;
        imageName = options.imageName ?? "uploaded image";
        if (
          previousImage &&
          previousImage !== backgroundImage &&
          typeof previousImage.close === "function"
        ) {
          previousImage.close();
        }
      } else {
        processor.setEffect({ mode });
      }
    };
    const setBeautyStrength = (strength) => {
      if (!running) throw new Error("Gregblur is no longer running.");
      const percent = Math.min(100, Math.max(0, Number(strength) || 0));
      processor.setBeautyStrength(percent / 100);
    };
    const destroy = async () => {
      if (!running) return;
      running = false;
      await processor.destroy();
      if (typeof backgroundImage?.close === "function") {
        backgroundImage.close();
      }
      backgroundImage = null;
    };
    inputTrack.addEventListener("ended", () => void destroy(), { once: true });

    return {
      ok: true,
      stream: processedStream,
      mode: "gregblur",
      reason: "Gregblur GPU blur/image processor started",
      nativeEffects: true,
      imageSupported: true,
      beautySupported: true,
      setEffect,
      setBeautyStrength,
      destroy,
      getState: () => {
        const processorState = processor.getState();
        return {
          engine: "gregblur",
          running,
          enabled: processorState.effectMode === "blur",
          effectMode: processorState.effectMode,
          imageSupported: true,
          imageName,
          beautySupported: true,
          beautyStrength: processorState.beautyStrength,
          nativeEffects: true,
          profile: profileName,
          model: profile.name,
          modelAssetPath: profile.url,
          processingSize: {
            width: Number(settings.width) || 640,
            height: Number(settings.height) || 480,
          },
          inputTrackState: inputTrack.readyState,
          outputTrackState: outputTrack.readyState,
          renderer: rendererInfo.renderer,
          vendor: rendererInfo.vendor,
          mediaPipeRuntime: getVisionRuntimeState(),
          segmentationScheduler: provider.getState(),
          faceLandmarks: faceProvider.getState(),
          gpuComposite: processorState,
        };
      },
    };
  } catch (error) {
    try {
      await processor.destroy();
    } catch {
      // Preserve the startup failure so the router can choose the Lite engine.
    }
    return {
      ok: false,
      stream,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

// -----------------------------------------------------------------------------
// Engine registration, lifecycle, and diagnostics
// -----------------------------------------------------------------------------

async function destroyActiveEngine() {
  const engine = activeEngine;
  activeEngine = null;
  if (!engine) return;
  try {
    await engine.destroy?.();
  } catch (error) {
    console.warn("[Background Router] Engine cleanup failed.", error);
  }
}

export async function setBackgroundBlurEnabled(enabled) {
  return await setBackgroundEffect(enabled ? "blur" : "none");
}

export async function setBackgroundEffect(mode, options = {}) {
  if (!["none", "blur", "image"].includes(mode)) {
    return {
      ok: false,
      mode: activeEngine?.getState?.()?.effectMode ?? null,
      reason: 'Background effect must be "none", "blur", or "image"',
    };
  }
  if (!activeEngine) {
    return {
      ok: false,
      enabled: false,
      mode: null,
      reason: "No background engine is active",
    };
  }

  try {
    if (typeof activeEngine.setEffect === "function") {
      await activeEngine.setEffect({ ...options, mode });
    } else if (mode !== "image" && typeof activeEngine.setEnabled === "function") {
      await activeEngine.setEnabled(mode === "blur");
    } else {
      return {
        ok: false,
        enabled: Boolean(activeEngine.getState?.()?.enabled),
        mode: activeEngine.getState?.()?.effectMode ?? null,
        reason: mode === "image"
          ? "The active background engine does not support image backgrounds"
          : "The active background engine cannot be toggled",
      };
    }

    const engineState = activeEngine.getState?.() ?? null;
    const resolvedMode = engineState?.effectMode ??
      (engineState?.enabled ? "blur" : "none");
    return {
      ok: true,
      enabled: resolvedMode === "blur",
      mode: resolvedMode,
      imageName: engineState?.imageName ?? null,
      imageSupported: Boolean(engineState?.imageSupported),
      engine: engineState?.engine ?? activeEngine.mode ?? null,
    };
  } catch (error) {
    const engineState = activeEngine.getState?.() ?? null;
    return {
      ok: false,
      enabled: Boolean(engineState?.enabled),
      mode: engineState?.effectMode ?? null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function setBeautyStrength(strength) {
  const percent = Math.min(100, Math.max(0, Number(strength) || 0));
  if (!activeEngine || typeof activeEngine.setBeautyStrength !== "function") {
    return {
      ok: false,
      strength: 0,
      reason: "The active video engine does not support GPU beauty effects",
    };
  }

  try {
    activeEngine.setBeautyStrength(percent);
    return {
      ok: true,
      strength: activeEngine.getState?.()?.beautyStrength ?? percent,
      engine: activeEngine.getState?.()?.engine ?? activeEngine.mode ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      strength: activeEngine.getState?.()?.beautyStrength ?? 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function installLifecycleCleanup() {
  if (lifecycleCleanupInstalled) return;
  lifecycleCleanupInstalled = true;
  window.addEventListener("pagehide", () => void destroyActiveEngine());
}

function reportDiagnostics(selection) {
  const engineState = activeEngine?.getState?.() ?? null;
  const runtime = engineState?.mediaPipeRuntime ?? getVisionRuntimeState();
  const scheduler = engineState?.segmentationScheduler ?? null;
  const allocator = scheduler?.allocator ?? engineState?.allocator ?? null;
  const maskProvider = engineState?.maskProvider ?? null;
  const sessionPerformance = allocator?.sessionPerformance ??
    runtime.sessionPerformance ?? getSessionPerformanceState();
  const backgroundModel = engineState?.model ?? maskProvider?.model ?? "none";
  const backgroundDelegate = scheduler?.delegate ?? maskProvider?.delegate ??
    engineState?.delegate ?? "none";

  console.groupCollapsed(
    `[Squidly Diagnostics] ${engineState?.engine ?? selection.engine}`,
  );
  console.table([
    {
      role: "EyeGaze / beauty",
      model: runtime.faceLandmarker.model,
      delegate: runtime.faceLandmarker.delegate,
      instances: runtime.faceLandmarker.sharedInstances,
    },
    {
      role: "Background",
      model: backgroundModel,
      delegate: backgroundDelegate,
      instances: scheduler?.residentModelInstances ??
        maskProvider?.residentModelInstances ?? 0,
    },
  ]);
  console.table({
    resourceLevel: allocator?.level ?? engineState?.mode ?? "unavailable",
    desiredLevel: allocator?.desiredLevel ?? "unavailable",
    backgroundTargetFps: allocator?.targetFps ??
      scheduler?.activeSegmentationFps ?? "unavailable",
    eyeGazeActive: allocator?.eyeGazeActive ??
      scheduler?.eyeGazeActive ?? maskProvider?.eyeGazeActive ?? false,
    reason: allocator?.reasons?.join("; ") ?? "Lite engine policy",
    longTaskRatio: sessionPerformance.longTaskRatio,
    slowFrameRatio: sessionPerformance.slowFrameRatio,
    estimatedVisionLoad: sessionPerformance.estimatedVisionLoad,
    estimatedFrameFps: sessionPerformance.estimatedFrameFps,
  });
  console.table(
    Object.entries(sessionPerformance.tasks).map(([task, state]) => ({
      task,
      active: state.active,
      averageMs: state.averageDurationMs,
      runsPerSecond: state.runsPerSecond,
      estimatedLoad: state.estimatedLoad,
    })),
  );
  console.log("Full state", { selection, engineState });
  console.groupEnd();
  return { selection, engineState };
}

function installDiagnostics(selection) {
  window.squidlyBackground = {
    getState: () => ({
      selection,
      engineState: activeEngine?.getState?.() ?? null,
    }),
    setEnabled: setBackgroundBlurEnabled,
    setEffect: setBackgroundEffect,
    setBeautyStrength,
    report: () => reportDiagnostics(selection),
    destroy: destroyActiveEngine,
  };
}

function activateEngine(engine, selection) {
  activeEngine = engine;
  selection.effects = {
    available: typeof engine.setEffect === "function",
    imageSupported: Boolean(engine.imageSupported),
    beautySupported: Boolean(engine.beautySupported),
    native: true,
    reason: `${engine.mode} native background effects started`,
  };
  const state = engine.getState?.() ?? {};
  const scheduler = state.segmentationScheduler ?? state.maskProvider ?? {};
  console.info(
    `[Squidly Models] ${engine.mode}: ` +
    `${state.model ?? scheduler.model ?? "no background model"} ` +
    `(${scheduler.delegate ?? state.delegate ?? "unknown delegate"}). ` +
    "Run window.squidlyBackground.report() for the full model/resource report.",
  );
  return engine.stream;
}

function recordAttempt(selection, engine, result) {
  selection.attempts.push({
    engine,
    ok: Boolean(result?.ok),
    skipped: Boolean(result?.skipped),
    reason: result?.reason,
  });
}

// -----------------------------------------------------------------------------
// Public routing pipeline: Gregblur -> Lite -> original stream
// -----------------------------------------------------------------------------

export async function background(stream, requestedOptions = {}) {
  if (!(stream instanceof MediaStream)) {
    console.warn("[Background Router] Invalid MediaStream; using original value.");
    return stream;
  }

  installLifecycleCleanup();
  await destroyActiveEngine();
  const rendererInfo = inspectRenderer();
  const options = {
    ...(globalThis.squidlyBackgroundOptions ?? {}),
    ...requestedOptions,
  };
  const selection = {
    engine: "pending",
    policy: "automatic-webgl2-gregblur-lite-fallback",
    reason: "Selecting a background engine",
    rendererInfo,
    mediaPipeRuntime: getVisionRuntimeState(),
    attempts: [],
  };
  installDiagnostics(selection);

  // Stage 1: normal hardware path using Gregblur + shared MediaPipe.
  if (rendererInfo.supported && !rendererInfo.softwareRenderer) {
    try {
      const result = await startGregblur(stream, rendererInfo, options.quality);
      recordAttempt(selection, "gregblur", result);
      if (result.ok) {
        selection.engine = "gregblur";
        selection.reason = result.reason;
        return activateEngine(result, selection);
      }
    } catch (error) {
      recordAttempt(selection, "gregblur", {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    recordAttempt(selection, "gregblur", {
      ok: false,
      skipped: true,
      reason: "Hardware WebGL2 is unavailable or software-rendered",
    });
  }

  // Stage 2: lazy CPU fallback for devices without a usable GPU path.
  try {
    const { backgroundLite } = await import("./background-lite.js");
    const result = await backgroundLite(stream, { rendererInfo });
    recordAttempt(selection, "lite-cpu", result);
    if (result.ok) {
      selection.engine = "lite-cpu";
      selection.reason = result.reason;
      return activateEngine(result, selection);
    }
    selection.engine = "original";
    selection.reason = result.reason ?? "Lightweight blur was unavailable";
  } catch (error) {
    selection.engine = "original";
    selection.reason = error instanceof Error ? error.message : String(error);
    recordAttempt(selection, "lite-cpu", { ok: false, reason: selection.reason });
  }

  // Stage 3: preserve the call by returning the unprocessed input stream.
  console.warn("[Background Router] Using original video.", selection);
  return stream;
}
