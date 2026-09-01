/*
 * Derived from gregblur 0.1.3 by Gregory D. Ceccarelli.
 * Modified for Squidly's blur/image/none GPU effect modes.
 * Licensed under Apache-2.0; see ./LICENSE.
 */

import { createGregblurBackgroundPipeline } from "./pipeline.js";

function supportsInsertableStreams() {
  return (
    typeof globalThis.MediaStreamTrackProcessor === "function" &&
    typeof globalThis.MediaStreamTrackGenerator === "function"
  );
}

function isAbortError(error) {
  return error instanceof DOMException && error.name === "AbortError";
}

function startInsertableStreamsPipeline(sourceTrack, signal, pipeline) {
  const processor = new globalThis.MediaStreamTrackProcessor({
    track: sourceTrack,
    maxBufferSize: 1,
  });
  const generator = new globalThis.MediaStreamTrackGenerator({ kind: "video" });
  const outputCanvas = pipeline.getCanvas();
  const transformer = new TransformStream({
    transform(frame, controller) {
      let forwardedInput = false;
      try {
        if (signal.aborted) {
          frame.close();
          return;
        }
        if (!pipeline.isProcessing()) {
          controller.enqueue(frame);
          forwardedInput = true;
          return;
        }
        pipeline.processFrame(
          frame,
          frame.timestamp !== null
            ? frame.timestamp / 1000
            : performance.now(),
        );
        controller.enqueue(
          new VideoFrame(outputCanvas, { timestamp: frame.timestamp ?? 0 }),
        );
      } catch (error) {
        console.warn("[Gregblur Image] Frame transform failed.", error);
      } finally {
        if (!forwardedInput) frame.close();
      }
    },
  });

  processor.readable
    .pipeThrough(transformer)
    .pipeTo(generator.writable)
    .catch((error) => {
      if (!isAbortError(error)) {
        console.warn("[Gregblur Image] Track pipeline failed.", error);
      }
    });
  return generator;
}

function startRafPipeline(sourceTrack, signal, pipeline) {
  if (typeof document === "undefined") {
    throw new Error("Gregblur's fallback requires document support.");
  }

  let animationFrameId = null;
  let videoFrameCallbackId = null;
  const video = document.createElement("video");
  video.srcObject = new MediaStream([sourceTrack]);
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.play().catch(() => {});

  const outputCanvas = pipeline.getCanvas();
  if (!(outputCanvas instanceof HTMLCanvasElement)) {
    throw new Error("Gregblur's fallback requires an HTML canvas.");
  }
  if (!outputCanvas.isConnected) {
    outputCanvas.dataset.gregblurFallback = "true";
    outputCanvas.style.display = "none";
    document.body.appendChild(outputCanvas);
  }
  if (typeof outputCanvas.captureStream !== "function") {
    throw new Error("Canvas captureStream is unavailable.");
  }
  const stream = outputCanvas.captureStream(30);
  const outputTrack = stream.getVideoTracks()[0];
  if (!outputTrack) throw new Error("Gregblur produced no output track.");

  const scheduleNext = () => {
    if (signal.aborted) return;
    if (typeof video.requestVideoFrameCallback === "function") {
      videoFrameCallbackId = video.requestVideoFrameCallback((_now, metadata) => {
        if (!signal.aborted && video.readyState >= video.HAVE_CURRENT_DATA) {
          try {
            pipeline.processFrame(video, metadata.mediaTime * 1000);
          } catch (error) {
            console.warn("[Gregblur Image] Fallback frame failed.", error);
          }
        }
        scheduleNext();
      });
    } else {
      animationFrameId = requestAnimationFrame(tick);
    }
  };
  const tick = () => {
    if (signal.aborted) return;
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      try {
        pipeline.processFrame(video, performance.now());
      } catch (error) {
        console.warn("[Gregblur Image] Fallback frame failed.", error);
      }
    }
    scheduleNext();
  };
  scheduleNext();

  return {
    outputTrack,
    cleanup() {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      if (
        videoFrameCallbackId !== null &&
        typeof video.cancelVideoFrameCallback === "function"
      ) {
        video.cancelVideoFrameCallback(videoFrameCallbackId);
        videoFrameCallbackId = null;
      }
      video.pause();
      video.srcObject = null;
    },
  };
}

export function createRawBackgroundProcessor(options = {}) {
  if (!options.segmentationProvider) {
    throw new TypeError("A Gregblur segmentation provider is required.");
  }
  const pipeline = createGregblurBackgroundPipeline(
    options.segmentationProvider,
    options,
  );
  let abortController = null;
  let outputTrack = null;
  let fallbackCleanup = null;

  function cleanupActiveRun() {
    abortController?.abort();
    abortController = null;
    fallbackCleanup?.();
    fallbackCleanup = null;
    outputTrack?.stop?.();
    outputTrack = null;
    pipeline.destroy();
  }

  return {
    async start(inputTrack) {
      if (abortController) cleanupActiveRun();
      const controller = new AbortController();
      abortController = controller;
      try {
        const settings = inputTrack.getSettings();
        await pipeline.init(
          Number(settings.width) || 640,
          Number(settings.height) || 480,
        );
        if (supportsInsertableStreams()) {
          outputTrack = startInsertableStreamsPipeline(
            inputTrack,
            controller.signal,
            pipeline,
          );
        } else {
          const fallback = startRafPipeline(
            inputTrack,
            controller.signal,
            pipeline,
          );
          outputTrack = fallback.outputTrack;
          fallbackCleanup = fallback.cleanup;
        }
        return outputTrack;
      } catch (error) {
        if (abortController === controller) cleanupActiveRun();
        throw error;
      }
    },

    setEffect(effectOptions) {
      pipeline.setEffect(effectOptions);
    },

    setBeautyStrength(strength) {
      pipeline.setBeautyStrength(strength);
    },

    getState() {
      return pipeline.getState();
    },

    destroy() {
      cleanupActiveRun();
    },
  };
}
