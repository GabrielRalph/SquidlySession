/**
 * Opt-in RVM implementation backed by TensorFlow.js.
 *
 * The official RVM TFJS model is GPL-3.0. It is loaded only when the router
 * requests RVM, so Gregblur users do not download TensorFlow.js or the model.
 */

const DEFAULT_TFJS_URL =
  "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.7.0/dist/tf.min.js";
const DEFAULT_MODEL_URL =
  "https://cdn.jsdelivr.net/gh/PeterL1n/RobustVideoMatting@" +
  "72ed518756950796f10eea6eb6b301df97cef277/model/model.json";
// The compositor uses the camera frame as foreground, so only alpha and the
// four recurrent outputs are requested. The unused `fgr` output is omitted.
const MODEL_OUTPUTS = Object.freeze(["pha", "r1o", "r2o", "r3o", "r4o"]);
const STATE_COUNT = 4;
const DEFAULT_BENCHMARK_FRAMES = 30;
const IGNORED_BENCHMARK_FRAMES = 5;
const MAX_TIMING_SAMPLES = 90;

let tensorflowPromise = null;

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, number))
    : fallback;
}

function loadTensorflow(url) {
  if (globalThis.tf?.loadGraphModel) return Promise.resolve(globalThis.tf);
  if (tensorflowPromise) return tensorflowPromise;

  tensorflowPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-squidly-tfjs="rvm"]');
    const script = existing ?? document.createElement("script");
    const handleLoad = () => {
      if (globalThis.tf?.loadGraphModel) {
        resolve(globalThis.tf);
      } else {
        script.remove();
        reject(new Error("TensorFlow.js loaded without the GraphModel API."));
      }
    };
    const handleError = () => {
      script.remove();
      reject(new Error("TensorFlow.js could not be loaded."));
    };

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    if (!existing) {
      script.dataset.squidlyTfjs = "rvm";
      script.async = true;
      script.crossOrigin = "anonymous";
      script.src = url;
      document.head.append(script);
    }
  }).catch((error) => {
    tensorflowPromise = null;
    throw error;
  });
  return tensorflowPromise;
}

async function createInputVideo(inputTrack) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = new MediaStream([inputTrack]);
  try {
    await video.play();
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise((resolve, reject) => {
        let timeoutId;
        const finish = (error) => {
          clearTimeout(timeoutId);
          video.removeEventListener("loadeddata", handleReady);
          inputTrack.removeEventListener("ended", handleEnded);
          error ? reject(error) : resolve();
        };
        const handleReady = () => finish();
        const handleEnded = () => finish(new Error("The RVM input track ended."));
        timeoutId = setTimeout(
          () => finish(new Error("Timed out waiting for the RVM input video.")),
          10_000,
        );
        video.addEventListener("loadeddata", handleReady, { once: true });
        inputTrack.addEventListener("ended", handleEnded, { once: true });
      });
    }
    return video;
  } catch (error) {
    releaseInputVideo(video);
    throw error;
  }
}

function releaseInputVideo(video) {
  video.pause();
  video.srcObject = null;
}

function fitWithin(width, height, maximumWidth, maximumHeight) {
  const sourceWidth = Math.max(1, Number(width) || 640);
  const sourceHeight = Math.max(1, Number(height) || 480);
  const scale = Math.min(1, maximumWidth / sourceWidth, maximumHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function analysisSizeFor(width, height, requestedLongEdge) {
  const longEdge = Math.round(clamp(requestedLongEdge, 320, 640, 512) / 32) * 32;
  const landscape = width >= height;
  const ratio = Math.max(0.25, Math.min(4, width / height));
  return {
    width: Math.max(160, Math.round((landscape ? longEdge : longEdge * ratio) / 32) * 32),
    height: Math.max(160, Math.round((landscape ? longEdge / ratio : longEdge) / 32) * 32),
  };
}

function createSurface({ width, height }, alpha) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha });
  if (!context) throw new Error("RVM could not create a Canvas 2D context.");
  return { canvas, context };
}

function createSurfaces(analysisSize, outputSize) {
  return {
    source: createSurface(analysisSize, false),
    mask: createSurface(analysisSize, true),
    frame: createSurface(outputSize, false),
    publishedFrame: createSurface(outputSize, false),
    foreground: createSurface(outputSize, true),
    output: createSurface(outputSize, false),
  };
}

const mean = (values) => values.length
  ? values.reduce((total, value) => total + value, 0) / values.length
  : 0;

function percentile(values, fraction) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

const rounded = (value) => Number((Number(value) || 0).toFixed(1));

function timingStats(inferenceTimes, frameTimes, targetFps) {
  const averageFrameMs = mean(frameTimes);
  return {
    measuredFps: rounded(averageFrameMs > 0
      ? Math.min(targetFps, 1000 / averageFrameMs)
      : 0),
    averageInferenceMs: rounded(mean(inferenceTimes)),
    p95InferenceMs: rounded(percentile(inferenceTimes, 0.95)),
    averageFrameMs: rounded(averageFrameMs),
    p95FrameMs: rounded(percentile(frameTimes, 0.95)),
  };
}

function passesRealtimeGate(stats, gate) {
  return stats.measuredFps >= gate.minimumFps &&
    stats.averageInferenceMs <= gate.maximumAverageInferenceMs &&
    stats.p95InferenceMs <= gate.maximumP95InferenceMs;
}

const initialiseStates = (tf) =>
  Array.from({ length: STATE_COUNT }, () => tf.scalar(0));
const disposeTensors = (tensors) =>
  tensors?.forEach((tensor) => tensor?.dispose?.());

function createMaskWriter(context, width, height) {
  const image = context.createImageData(width, height);
  const pixels = image.data;
  return (alpha) => {
    for (let index = 0, pixel = 0; index < alpha.length; index += 1, pixel += 4) {
      pixels[pixel] = 255;
      pixels[pixel + 1] = 255;
      pixels[pixel + 2] = 255;
      pixels[pixel + 3] = Math.round(Math.min(1, Math.max(0, alpha[index])) * 255);
    }
    context.putImageData(image, 0, 0);
  };
}

function composeFrame(video, surfaces, { blurRadius, edgeSoftness }) {
  const { mask, foreground, output } = surfaces;
  const foregroundContext = foreground.context;
  const outputContext = output.context;
  const { width, height } = output.canvas;
  const overscan = Math.ceil(blurRadius * 1.5);

  outputContext.save();
  outputContext.globalCompositeOperation = "copy";
  outputContext.filter = `blur(${blurRadius}px)`;
  outputContext.drawImage(
    video,
    -overscan,
    -overscan,
    width + overscan * 2,
    height + overscan * 2,
  );
  outputContext.restore();

  foregroundContext.save();
  foregroundContext.globalCompositeOperation = "copy";
  foregroundContext.filter = "none";
  foregroundContext.drawImage(video, 0, 0, width, height);
  foregroundContext.globalCompositeOperation = "destination-in";
  foregroundContext.filter = edgeSoftness > 0 ? `blur(${edgeSoftness}px)` : "none";
  foregroundContext.drawImage(mask.canvas, 0, 0, width, height);
  foregroundContext.restore();

  outputContext.save();
  outputContext.globalCompositeOperation = "source-over";
  outputContext.filter = "none";
  outputContext.drawImage(foreground.canvas, 0, 0);
  outputContext.restore();
}

function drawDirectFrame(video, surfaces) {
  const { context, canvas } = surfaces.output;
  context.save();
  context.globalCompositeOperation = "copy";
  context.filter = "none";
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  context.restore();
}

async function loadRvmModel(options) {
  const tf = await loadTensorflow(options.tfjsUrl);
  if (!await tf.setBackend("webgl")) {
    throw new Error("RVM could not start the TensorFlow.js WebGL backend.");
  }
  await tf.ready();
  return { tf, model: await tf.loadGraphModel(options.modelUrl) };
}

async function runStartupBenchmark(processFrame, frameCount, targetFps) {
  const samples = [];
  for (let index = 0; index < frameCount; index += 1) {
    samples.push(await processFrame());
  }
  const measured = samples.slice(Math.min(IGNORED_BENCHMARK_FRAMES, samples.length - 1));
  const inferenceTimes = measured.map((sample) => sample.inferenceMs);
  const frameTimes = measured.map((sample) => sample.frameMs);
  return {
    benchmark: {
      warmupFrames: samples.length,
      measuredFrames: measured.length,
      ...timingStats(inferenceTimes, frameTimes, targetFps),
    },
    inferenceTimes,
    frameTimes,
  };
}

function createOutputStream(canvas, targetFps, inputTrack, inputStream) {
  const canvasStream = canvas.captureStream(targetFps);
  const outputTrack = canvasStream.getVideoTracks()[0];
  if (!outputTrack) {
    canvasStream.getTracks().forEach((track) => track.stop());
    throw new Error("RVM could not capture its output canvas.");
  }
  try {
    outputTrack.contentHint = inputTrack.contentHint || "motion";
  } catch {
    // Some browsers expose contentHint as read-only.
  }
  const stream = new MediaStream([outputTrack]);
  inputStream.getAudioTracks().forEach((track) => stream.addTrack(track));
  return { stream, canvasStream, outputTrack };
}

function startFrameLoop(video, processFrame, onError) {
  const usesVideoCallback = typeof video.requestVideoFrameCallback === "function";
  let callbackId = null;
  let inFlight = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    callbackId = usesVideoCallback
      ? video.requestVideoFrameCallback(run)
      : requestAnimationFrame(run);
  };
  async function run() {
    if (stopped) return;
    try {
      inFlight = processFrame();
      await inFlight;
    } catch (error) {
      onError(error);
    } finally {
      inFlight = null;
      schedule();
    }
  }

  schedule();
  return async () => {
    if (stopped) return;
    stopped = true;
    if (callbackId !== null) {
      if (usesVideoCallback) video.cancelVideoFrameCallback(callbackId);
      else cancelAnimationFrame(callbackId);
    }
    try {
      await inFlight;
    } catch {
      // The running frame has already been sent to onError.
    }
  };
}

function createRuntimeOptions(options = {}) {
  return {
    tfjsUrl: options.tfjsUrl || DEFAULT_TFJS_URL,
    modelUrl: options.modelUrl || DEFAULT_MODEL_URL,
    analysisLongEdge: clamp(options.analysisLongEdge, 320, 640, 512),
    downsampleRatio: clamp(options.downsampleRatio, 0.25, 1, 0.5),
    blurRadius: clamp(options.blurRadius, 8, 40, 24),
    edgeSoftness: clamp(options.edgeSoftness, 0, 3, 0.75),
    benchmarkFrames: Math.round(clamp(
      options.benchmarkFrames, DEFAULT_BENCHMARK_FRAMES, 60, DEFAULT_BENCHMARK_FRAMES,
    )),
  };
}

export function createRvmTfjsAdapter(requestedOptions = {}) {
  const options = createRuntimeOptions(requestedOptions);

  return {
    isSupported({ rendererInfo }) {
      return Boolean(
        rendererInfo.supported &&
        !rendererInfo.softwareRenderer &&
        HTMLCanvasElement.prototype.captureStream &&
        globalThis.WebGL2RenderingContext,
      );
    },

    async start(context) {
      const inputTrack = context.stream.getVideoTracks()[0];
      if (!inputTrack) throw new Error("RVM requires a live video track.");

      const video = await createInputVideo(inputTrack);
      const settings = inputTrack.getSettings?.() ?? {};
      const outputSize = fitWithin(
        Number(settings.width) || video.videoWidth || 640,
        Number(settings.height) || video.videoHeight || 480,
        context.maximumWidth, context.maximumHeight,
      );
      const analysisSize = analysisSizeFor(
        outputSize.width, outputSize.height, options.analysisLongEdge,
      );

      let surfaces;
      let tf;
      let model;
      try {
        surfaces = createSurfaces(analysisSize, outputSize);
        ({ tf, model } = await loadRvmModel(options));
      } catch (error) {
        releaseInputVideo(video);
        throw error;
      }

      let recurrentStates = initialiseStates(tf);
      const downsampleRatio = tf.scalar(options.downsampleRatio);
      const writeMask = createMaskWriter(
        surfaces.mask.context, analysisSize.width, analysisSize.height,
      );
      let modelResourcesReleased = false;
      const releaseModelResources = () => {
        if (modelResourcesReleased) return;
        modelResourcesReleased = true;
        disposeTensors(recurrentStates);
        recurrentStates = [];
        downsampleRatio.dispose();
        model.dispose();
        releaseInputVideo(video);
      };

      const recentInferenceTimes = [];
      const recentFrameTimes = [];
      let processedFrames = 0;
      let processingErrors = 0;
      let lastError = null;
      let running = true;
      let blurEnabled = true;
      let maskConsumerActive = false;
      let maskSequence = 0;
      let lastMaskUpdatedAt = 0;
      let resetRecurrentStates = false;
      let bypassedFrames = 0;

      const processFrame = async () => {
        const frameStartedAt = performance.now();
        if (!blurEnabled && !maskConsumerActive) {
          drawDirectFrame(video, surfaces);
          processedFrames += 1;
          bypassedFrames += 1;
          return { inferenceMs: 0, frameMs: performance.now() - frameStartedAt };
        }

        if (resetRecurrentStates) {
          disposeTensors(recurrentStates);
          recurrentStates = initialiseStates(tf);
          resetRecurrentStates = false;
        }

        surfaces.frame.context.drawImage(
          video,
          0,
          0,
          outputSize.width,
          outputSize.height,
        );
        surfaces.source.context.drawImage(
          surfaces.frame.canvas,
          0,
          0,
          analysisSize.width,
          analysisSize.height,
        );
        const source = tf.tidy(() => tf.browser
          .fromPixels(surfaces.source.canvas, 3)
          .toFloat()
          .div(255)
          .expandDims(0));
        let outputs;
        try {
          outputs = await model.executeAsync({
            src: source,
            r1i: recurrentStates[0],
            r2i: recurrentStates[1],
            r3i: recurrentStates[2],
            r4i: recurrentStates[3],
            downsample_ratio: downsampleRatio,
          }, MODEL_OUTPUTS);
        } finally {
          source.dispose();
        }

        const alphaTensor = outputs[0];
        const nextStates = outputs.slice(1, STATE_COUNT + 1);
        let inferenceMs;
        try {
          const alpha = await alphaTensor.data();
          inferenceMs = performance.now() - frameStartedAt;
          writeMask(alpha);
          surfaces.publishedFrame.context.drawImage(
            surfaces.frame.canvas,
            0,
            0,
          );
          maskSequence += 1;
          lastMaskUpdatedAt = performance.now();
          if (blurEnabled) {
            composeFrame(surfaces.frame.canvas, surfaces, options);
          } else {
            drawDirectFrame(surfaces.frame.canvas, surfaces);
          }
        } catch (error) {
          disposeTensors(nextStates);
          throw error;
        } finally {
          alphaTensor?.dispose?.();
        }

        disposeTensors(recurrentStates);
        recurrentStates = nextStates;
        const frameMs = performance.now() - frameStartedAt;
        recentInferenceTimes.push(inferenceMs);
        recentFrameTimes.push(frameMs);
        if (recentInferenceTimes.length > MAX_TIMING_SAMPLES) recentInferenceTimes.shift();
        if (recentFrameTimes.length > MAX_TIMING_SAMPLES) recentFrameTimes.shift();
        processedFrames += 1;
        return { inferenceMs, frameMs };
      };

      let startup;
      try {
        startup = await runStartupBenchmark(
          processFrame, options.benchmarkFrames, context.targetFps,
        );
      } catch (error) {
        running = false;
        releaseModelResources();
        throw error;
      }
      recentInferenceTimes.splice(0, recentInferenceTimes.length, ...startup.inferenceTimes);
      recentFrameTimes.splice(0, recentFrameTimes.length, ...startup.frameTimes);

      let output;
      try {
        output = createOutputStream(
          surfaces.output.canvas, context.targetFps, inputTrack, context.stream,
        );
      } catch (error) {
        running = false;
        releaseModelResources();
        throw error;
      }

      const handleFrameError = (error) => {
        processingErrors += 1;
        lastError = error instanceof Error ? error.message : String(error);
        if (processingErrors === 1) {
          console.warn("[RVM Background] Frame processing failed.", error);
        }
      };
      const stopFrameLoop = startFrameLoop(video, processFrame, handleFrameError);
      const destroy = async () => {
        if (!running) return;
        running = false;
        inputTrack.removeEventListener("ended", handleInputEnded);
        await stopFrameLoop();
        output.canvasStream.getTracks().forEach((track) => track.stop());
        releaseModelResources();
      };
      const handleInputEnded = () => void destroy();
      inputTrack.addEventListener("ended", handleInputEnded, { once: true });

      const setEnabled = (enabled) => {
        const nextEnabled = Boolean(enabled);
        const wasInferenceActive = blurEnabled || maskConsumerActive;
        blurEnabled = nextEnabled;
        if (!wasInferenceActive && (blurEnabled || maskConsumerActive)) {
          resetRecurrentStates = true;
        }
      };
      const maskProvider = {
        type: "rvm-alpha",
        delegate: tf.getBackend(),
        setActive(active) {
          const wasInferenceActive = blurEnabled || maskConsumerActive;
          maskConsumerActive = Boolean(active);
          if (!wasInferenceActive && (blurEnabled || maskConsumerActive)) {
            resetRecurrentStates = true;
          }
        },
        getPersonMask() {
          if (!maskSequence) return null;
          return {
            width: analysisSize.width,
            height: analysisSize.height,
            canvas: surfaces.mask.canvas,
            frame: surfaces.publishedFrame.canvas,
            sequence: maskSequence,
            updatedAt: lastMaskUpdatedAt,
            source: "rvm-alpha",
          };
        },
        getState() {
          return {
            type: "rvm-alpha",
            delegate: tf.getBackend(),
            sharedBetweenEffects: true,
            residentModelInstances: 1,
            consumerMode: maskConsumerActive ? "image" : "blur",
            active: blurEnabled || maskConsumerActive,
            maskSequence,
            maskAgeMs: maskSequence
              ? Math.round(performance.now() - lastMaskUpdatedAt)
              : null,
            imageSegmentationFps: context.targetFps,
          };
        },
      };

      return {
        ok: true,
        stream: output.stream,
        benchmark: startup.benchmark,
        reason: "RVM TFJS startup benchmark completed",
        setEnabled,
        maskProvider,
        destroy,
        getState: () => {
          const runtime = timingStats(
            recentInferenceTimes, recentFrameTimes, context.targetFps,
          );
          return {
            engine: "rvm-tfjs",
            running,
            enabled: blurEnabled,
            backend: tf.getBackend(),
            modelUrl: options.modelUrl,
            inputTrackState: inputTrack.readyState,
            outputTrackState: output.outputTrack.readyState,
            analysisSize,
            outputSize,
            downsampleRatio: options.downsampleRatio,
            processedFrames,
            bypassedFrames,
            maskProvider: maskProvider.getState(),
            processingErrors,
            lastError,
            runtime: {
              realtimeQualified: passesRealtimeGate(runtime, context.realtimeGate),
              ...runtime,
            },
          };
        },
      };
    },
  };
}
