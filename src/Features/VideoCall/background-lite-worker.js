/**
 * Dedicated Lite inference backend (one model per Worker).
 * Main -> Worker: init {modelAssetPath}, segment {bitmap, timestampMs}.
 * Worker -> Main: ready, mask {bitmap, width, height, timestampMs, inferenceMs},
 * or error {message, inferenceMs?}. Bitmap ownership transfers with messages;
 * each receiver closes what it consumes. The main thread enforces backpressure.
 */
const MEDIAPIPE_VERSION = "0.10.32";
const VISION_BUNDLE_URL =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/+esm`;
const WASM_BASE_PATH =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

let segmenter = null;
let labels = [];
let maskCanvas = null;
let maskContext = null;
let maskImage = null;

function smoothstep(edge0, edge1, value) {
  const x = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

// Reuse the pixel buffer and canvas; expand foreground by one axial neighbour
// before mapping confidence to alpha. This is spatial edge treatment, not
// temporal smoothing. Keep the main-thread fallback conversion equivalent.
function prepareMask(width, height, values) {
  if (!maskCanvas || maskCanvas.width !== width || maskCanvas.height !== height) {
    maskCanvas = new OffscreenCanvas(width, height);
    maskContext = maskCanvas.getContext("2d");
    if (!maskContext) throw new Error("Worker Canvas 2D is unavailable.");
    maskImage = new ImageData(width, height);
  }

  const pixels = maskImage.data;
  for (let index = 0; index < values.length; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    let confidence = values[index];
    if (x > 0) confidence = Math.max(confidence, values[index - 1]);
    if (x + 1 < width) confidence = Math.max(confidence, values[index + 1]);
    if (y > 0) confidence = Math.max(confidence, values[index - width]);
    if (y + 1 < height) confidence = Math.max(confidence, values[index + width]);
    const alpha = smoothstep(0.2, 0.78, confidence);
    const offset = index * 4;
    pixels[offset] = 255;
    pixels[offset + 1] = 255;
    pixels[offset + 2] = 255;
    pixels[offset + 3] = Math.round(alpha * 255);
  }
  maskContext.putImageData(maskImage, 0, 0);
  return {
    bitmap: maskCanvas.transferToImageBitmap(),
  };
}

async function initialise(modelAssetPath) {
  // A classic Worker keeps MediaPipe 0.10.x compatible with its internal
  // importScripts-based WASM loader while dynamic import provides the ESM API.
  const vision = await import(VISION_BUNDLE_URL);
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE_PATH);
  segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath, delegate: "CPU" },
    runningMode: "VIDEO",
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
  labels = segmenter.getLabels?.() ?? [];
  // Warm the actual model and alpha conversion before announcing readiness.
  // These synthetic frames are never sent to the compositor or measured as
  // live inference. Failure here is diagnostic only; normal startup may proceed.
  const warmupStartedAt = performance.now();
  // Reserve VIDEO timestamps 0/1. background-lite.js starts its live counter
  // after this range, including when optional warmup only partly completes.
  let warmupRuns = 0;
  let warmupError = null;
  try {
    const source = new OffscreenCanvas(256, 144);
    source.getContext("2d").fillRect(0, 0, 256, 144);
    for (let timestamp = 0; timestamp < 2; timestamp++) {
      let result;
      try {
        result = segmenter.segmentForVideo(source, timestamp);
        const masks = result?.confidenceMasks ?? [];
        const mask = masks[masks.length - 1];
        if (mask) {
          // No receiver owns this synthetic bitmap: release it here, not via
          // the normal mask message protocol. The reusable mask canvas remains.
          prepareMask(mask.width, mask.height, mask.getAsFloat32Array()).bitmap.close();
        }
        warmupRuns++;
      } finally {
        result?.close?.();
      }
    }
  } catch (error) {
    warmupError = String(error.message ?? error);
  }
  // Readiness still means the model was created; optional preheating is not
  // an admission benchmark and must not hide blur/image controls on failure.
  self.postMessage({
    type: "ready",
    model: "selfie-segmenter-landscape-float16",
    delegate: "CPU",
    mediaPipeVersion: MEDIAPIPE_VERSION,
    warmup: { runs: warmupRuns, durationMs: Math.round(performance.now() - warmupStartedAt), error: warmupError },
    labels,
  });
}

// Echo timestampMs unchanged so the caller can pair the mask with its source.
// inferenceMs includes model execution and alpha-mask preparation, but excludes
// main-thread capture, message delivery and final compositing.
function segment(bitmap, timestampMs) {
  const startedAt = performance.now();
  let result;
  try {
    result = segmenter.segmentForVideo(bitmap, timestampMs);
    const personIndex = labels.findIndex((label) =>
      String(label).toLowerCase().includes("person")
    );
    const masks = result?.confidenceMasks ?? [];
    const personMask = masks[personIndex >= 0 ? personIndex : masks.length - 1];
    if (!personMask) throw new Error("MediaPipe returned no person mask.");

    const preparedMask = prepareMask(
      personMask.width,
      personMask.height,
      personMask.getAsFloat32Array(),
    );
    const inferenceMs = performance.now() - startedAt;
    self.postMessage(
      {
        type: "mask",
        bitmap: preparedMask.bitmap,
        width: personMask.width,
        height: personMask.height,
        inferenceMs,
        timestampMs,
      },
      [preparedMask.bitmap],
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      inferenceMs: performance.now() - startedAt,
    });
  } finally {
    result?.close?.();
    bitmap.close();
  }
}

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      await initialise(data.modelAssetPath);
    } catch (error) {
      self.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } else if (data.type === "segment") {
    if (!segmenter) {
      data.bitmap.close();
      self.postMessage({ type: "error", message: "Segmenter is not ready." });
      return;
    }
    segment(data.bitmap, data.timestampMs);
  }
};
