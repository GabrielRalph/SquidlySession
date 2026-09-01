/*
 * Derived from gregblur 0.1.3 by Gregory D. Ceccarelli.
 * Squidly modification: the final GPU composite can use either Gregblur's
 * blurred texture or an uploaded image texture without reading the mask back
 * to the CPU. Licensed under Apache-2.0; see ./LICENSE.
 */

import {
  BEAUTY_SHADER,
  BILATERAL_FILTER_SHADER,
  COMPOSITE_SHADER,
  COPY_SHADER,
  MASKED_DOWNSAMPLE_SHADER,
  MASK_WEIGHTED_BLUR_SHADER,
  TEMPORAL_BLEND_SHADER,
  VERTEX_SHADER,
  VERTEX_SHADER_NO_FLIP,
} from "./shaders.js";
import {
  createFboWithTexture,
  createFullscreenQuad,
  createProgram,
} from "./webgl-utils.js";

const EFFECT_MODES = new Set(["none", "blur", "image"]);

function sanitisePositiveNumber(value, fallback, minimum) {
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

function sanitiseInteger(value, fallback, minimum) {
  const normalised = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(minimum, normalised);
}

function sanitiseUnitInterval(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function sourceDimensions(source) {
  return {
    width: Number(
      source?.videoWidth || source?.displayWidth || source?.naturalWidth || source?.width,
    ) || 0,
    height: Number(
      source?.videoHeight || source?.displayHeight || source?.naturalHeight || source?.height,
    ) || 0,
  };
}

function createStagingCanvas(width, height) {
  let canvas;
  if (typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
  } else if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(width, height);
  } else {
    throw new Error("No canvas is available for the background image.");
  }
  const context = canvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
  });
  if (!context) throw new Error("Background image Canvas 2D is unavailable.");
  return { canvas, context };
}

function drawCover(context, source, sourceSize, width, height) {
  const scale = Math.max(
    width / sourceSize.width,
    height / sourceSize.height,
  );
  const drawWidth = sourceSize.width * scale;
  const drawHeight = sourceSize.height * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  context.drawImage(source, x, y, drawWidth, drawHeight);
}

export function createGregblurBackgroundPipeline(provider, options = {}) {
  const faceLandmarksProvider = options.faceLandmarksProvider ?? null;
  const blurRadius = sanitisePositiveNumber(options.blurRadius, 25, 1);
  const sigmaSpace = sanitisePositiveNumber(
    options.bilateralSigmaSpace,
    4,
    0.001,
  );
  const sigmaColor = sanitisePositiveNumber(
    options.bilateralSigmaColor,
    0.1,
    0.001,
  );
  const downsampleFactor = sanitiseInteger(options.downsampleFactor, 2, 1);
  const temporalBlendFactor = sanitiseUnitInterval(
    options.temporalBlendFactor,
    0.24,
  );

  let canvas = null;
  let gl = null;
  let quad = null;
  let bilateralProgram = null;
  let temporalBlendProgram = null;
  let beautyProgram = null;
  let copyProgram = null;
  let maskedDownsampleProgram = null;
  let maskWeightedBlurProgram = null;
  let compositeProgram = null;

  let frameTexture = null;
  let backgroundTexture = null;
  let frameOrientedFbo = null;
  let bilateralFbo = null;
  let temporalFbo = null;
  let previousMaskFbo = null;
  let backgroundDownsampleFbo = null;
  let backgroundBlurPingFbo = null;
  let backgroundBlurPongFbo = null;
  let hasPreviousMask = false;

  let width = 0;
  let height = 0;
  let backgroundWidth = 0;
  let backgroundHeight = 0;
  let effectMode = "blur";
  let backgroundSource = null;
  let backgroundUploaded = false;
  let backgroundStaging = null;
  let beautyStrength = 0;
  let beautyGeometry = null;

  const averagePoint = (landmarks, indices) => {
    const sum = indices.reduce(
      (value, index) => ({
        x: value.x + landmarks[index].x,
        y: value.y + landmarks[index].y,
      }),
      { x: 0, y: 0 },
    );
    return [sum.x / indices.length, sum.y / indices.length];
  };

  function updateBeautyGeometry(source, timestampMs) {
    if (beautyStrength <= 0 || !faceLandmarksProvider) return null;

    const landmarks = faceLandmarksProvider.getLandmarks(source, timestampMs);
    if (!landmarks || landmarks.length <= 454) {
      beautyGeometry = null;
      return null;
    }

    const left = landmarks[234];
    const right = landmarks[454];
    const top = landmarks[10];
    const chin = landmarks[152];
    const next = {
      center: [(left.x + right.x) / 2, (top.y + chin.y) / 2],
      radii: [
        Math.max(0.001, Math.abs(right.x - left.x) * 0.54),
        Math.max(0.001, Math.abs(chin.y - top.y) * 0.56),
      ],
      leftEye: averagePoint(landmarks, [33, 133]),
      rightEye: averagePoint(landmarks, [362, 263]),
      mouth: averagePoint(landmarks, [13, 14]),
    };

    if (!beautyGeometry) {
      beautyGeometry = next;
    } else {
      for (const key of Object.keys(next)) {
        beautyGeometry[key] = beautyGeometry[key].map(
          (value, index) => beautyGeometry[key][index] * 0.65 + value * 0.35,
        );
      }
    }
    return beautyGeometry;
  }

  function deleteFrameResources() {
    if (!gl) return;
    const framebuffers = [
      frameOrientedFbo,
      bilateralFbo,
      temporalFbo,
      previousMaskFbo,
      backgroundDownsampleFbo,
      backgroundBlurPingFbo,
      backgroundBlurPongFbo,
    ];
    for (const resource of framebuffers) {
      if (!resource) continue;
      gl.deleteFramebuffer(resource.fbo);
      gl.deleteTexture(resource.texture);
    }
    if (frameTexture) gl.deleteTexture(frameTexture);
    frameTexture = null;
    frameOrientedFbo = null;
    bilateralFbo = null;
    temporalFbo = null;
    previousMaskFbo = null;
    backgroundDownsampleFbo = null;
    backgroundBlurPingFbo = null;
    backgroundBlurPongFbo = null;
    hasPreviousMask = false;
  }

  function initialiseFrameResources(nextWidth, nextHeight) {
    if (!gl) return;
    width = nextWidth;
    height = nextHeight;
    backgroundWidth = Math.max(1, Math.floor(width / downsampleFactor));
    backgroundHeight = Math.max(1, Math.floor(height / downsampleFactor));
    deleteFrameResources();

    if (canvas) {
      canvas.width = width;
      canvas.height = height;
    }

    frameTexture = gl.createTexture();
    if (!frameTexture) throw new Error("Failed to create the camera texture.");
    gl.bindTexture(gl.TEXTURE_2D, frameTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    frameOrientedFbo = createFboWithTexture(gl, width, height);
    bilateralFbo = createFboWithTexture(gl, width, height);
    temporalFbo = createFboWithTexture(gl, width, height);
    previousMaskFbo = createFboWithTexture(gl, width, height);
    backgroundDownsampleFbo = createFboWithTexture(
      gl,
      backgroundWidth,
      backgroundHeight,
    );
    backgroundBlurPingFbo = createFboWithTexture(
      gl,
      backgroundWidth,
      backgroundHeight,
    );
    backgroundBlurPongFbo = createFboWithTexture(
      gl,
      backgroundWidth,
      backgroundHeight,
    );
    backgroundUploaded = false;
  }

  function drawQuad() {
    if (!gl || !quad) return;
    gl.bindVertexArray(quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  function renderOrientedFrame() {
    if (!gl || !copyProgram || !frameOrientedFbo) return;
    gl.useProgram(copyProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, frameOrientedFbo.texture);
    gl.uniform1i(gl.getUniformLocation(copyProgram, "u_texture"), 0);
    drawQuad();
  }

  function ensureBackgroundTexture() {
    if (!gl || !backgroundSource || !width || !height) return null;
    if (backgroundTexture && backgroundUploaded) {
      return backgroundTexture;
    }

    const dimensions = sourceDimensions(backgroundSource);
    if (!dimensions.width || !dimensions.height) {
      throw new Error("The decoded background image has no dimensions.");
    }
    if (!backgroundStaging) {
      backgroundStaging = createStagingCanvas(width, height);
    }
    if (
      backgroundStaging.canvas.width !== width ||
      backgroundStaging.canvas.height !== height
    ) {
      backgroundStaging.canvas.width = width;
      backgroundStaging.canvas.height = height;
    }

    const context = backgroundStaging.context;
    context.fillStyle = "#202020";
    context.fillRect(0, 0, width, height);
    drawCover(context, backgroundSource, dimensions, width, height);

    if (!backgroundTexture) {
      backgroundTexture = gl.createTexture();
      if (!backgroundTexture) {
        throw new Error("Failed to create the background image texture.");
      }
      gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        backgroundStaging.canvas,
      );
    } finally {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }
    backgroundUploaded = true;
    return backgroundTexture;
  }

  function renderBlurredBackground(finalMaskTexture) {
    if (
      !gl ||
      !maskedDownsampleProgram ||
      !maskWeightedBlurProgram ||
      !frameOrientedFbo ||
      !backgroundDownsampleFbo ||
      !backgroundBlurPingFbo ||
      !backgroundBlurPongFbo
    ) {
      return null;
    }

    gl.useProgram(maskedDownsampleProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, backgroundDownsampleFbo.fbo);
    gl.viewport(0, 0, backgroundWidth, backgroundHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, frameOrientedFbo.texture);
    gl.uniform1i(
      gl.getUniformLocation(maskedDownsampleProgram, "u_texture"),
      0,
    );
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, finalMaskTexture);
    gl.uniform1i(
      gl.getUniformLocation(maskedDownsampleProgram, "u_mask"),
      4,
    );
    gl.uniform2f(
      gl.getUniformLocation(maskedDownsampleProgram, "u_sourceTexelSize"),
      1 / width,
      1 / height,
    );
    drawQuad();

    gl.useProgram(maskWeightedBlurProgram);
    const textureUniform = gl.getUniformLocation(
      maskWeightedBlurProgram,
      "u_texture",
    );
    const maskUniform = gl.getUniformLocation(maskWeightedBlurProgram, "u_mask");
    const texelUniform = gl.getUniformLocation(
      maskWeightedBlurProgram,
      "u_texelSize",
    );
    const directionUniform = gl.getUniformLocation(
      maskWeightedBlurProgram,
      "u_direction",
    );
    const radiusUniform = gl.getUniformLocation(
      maskWeightedBlurProgram,
      "u_radius",
    );
    const effectiveRadius = Math.max(1, blurRadius / downsampleFactor);

    gl.bindFramebuffer(gl.FRAMEBUFFER, backgroundBlurPingFbo.fbo);
    gl.viewport(0, 0, backgroundWidth, backgroundHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, backgroundDownsampleFbo.texture);
    gl.uniform1i(textureUniform, 0);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, finalMaskTexture);
    gl.uniform1i(maskUniform, 4);
    gl.uniform2f(texelUniform, 1 / backgroundWidth, 1 / backgroundHeight);
    gl.uniform2f(directionUniform, 1, 0);
    gl.uniform1f(radiusUniform, effectiveRadius);
    drawQuad();

    gl.bindFramebuffer(gl.FRAMEBUFFER, backgroundBlurPongFbo.fbo);
    gl.viewport(0, 0, backgroundWidth, backgroundHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, backgroundBlurPingFbo.texture);
    gl.uniform1i(textureUniform, 0);
    gl.uniform2f(directionUniform, 0, 1);
    drawQuad();
    return backgroundBlurPongFbo.texture;
  }

  function renderComposite(background, finalMaskTexture) {
    if (!gl || !compositeProgram || !frameOrientedFbo) return;
    gl.useProgram(compositeProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, background);
    gl.uniform1i(gl.getUniformLocation(compositeProgram, "background"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, frameOrientedFbo.texture);
    gl.uniform1i(gl.getUniformLocation(compositeProgram, "frame"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, finalMaskTexture);
    gl.uniform1i(gl.getUniformLocation(compositeProgram, "mask"), 2);
    drawQuad();
  }

  function destroyInternal() {
    try {
      provider.destroy();
    } catch {
      // Cleanup should continue even if the provider has already closed.
    }
    if (gl) {
      deleteFrameResources();
      if (backgroundTexture) gl.deleteTexture(backgroundTexture);
      if (bilateralProgram) gl.deleteProgram(bilateralProgram);
      if (temporalBlendProgram) gl.deleteProgram(temporalBlendProgram);
      if (beautyProgram) gl.deleteProgram(beautyProgram);
      if (copyProgram) gl.deleteProgram(copyProgram);
      if (maskedDownsampleProgram) gl.deleteProgram(maskedDownsampleProgram);
      if (maskWeightedBlurProgram) gl.deleteProgram(maskWeightedBlurProgram);
      if (compositeProgram) gl.deleteProgram(compositeProgram);
      if (quad) gl.deleteVertexArray(quad);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }

    backgroundTexture = null;
    bilateralProgram = null;
    temporalBlendProgram = null;
    beautyProgram = null;
    copyProgram = null;
    maskedDownsampleProgram = null;
    maskWeightedBlurProgram = null;
    compositeProgram = null;
    quad = null;
    gl = null;
    if (
      typeof HTMLCanvasElement !== "undefined" &&
      canvas instanceof HTMLCanvasElement &&
      canvas.dataset.gregblurFallback === "true"
    ) {
      canvas.remove();
    }
    canvas = null;
    backgroundStaging = null;
    width = 0;
    height = 0;
    backgroundWidth = 0;
    backgroundHeight = 0;
    hasPreviousMask = false;
    backgroundUploaded = false;
  }

  function processFrameInternal(source, timestampMs) {
    if (
      !gl ||
      !frameTexture ||
      !frameOrientedFbo ||
      !bilateralFbo ||
      !temporalFbo ||
      !previousMaskFbo ||
      !bilateralProgram ||
      !temporalBlendProgram ||
      !beautyProgram ||
      !copyProgram
    ) {
      return;
    }

    const dimensions = sourceDimensions(source);
    if (
      dimensions.width > 0 &&
      dimensions.height > 0 &&
      (dimensions.width !== width || dimensions.height !== height)
    ) {
      initialiseFrameResources(dimensions.width, dimensions.height);
    }

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, frameTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source,
    );

    const geometry = updateBeautyGeometry(source, timestampMs);
    gl.useProgram(beautyProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameOrientedFbo.fbo);
    gl.viewport(0, 0, width, height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, frameTexture);
    gl.uniform1i(gl.getUniformLocation(beautyProgram, "u_texture"), 0);
    gl.uniform2f(
      gl.getUniformLocation(beautyProgram, "u_texelSize"),
      1 / width,
      1 / height,
    );
    gl.uniform1f(
      gl.getUniformLocation(beautyProgram, "u_strength"),
      beautyStrength,
    );
    gl.uniform1f(
      gl.getUniformLocation(beautyProgram, "u_hasFace"),
      geometry ? 1 : 0,
    );
    if (geometry) {
      for (const [name, value] of Object.entries({
        u_faceCenter: geometry.center,
        u_faceRadii: geometry.radii,
        u_leftEye: geometry.leftEye,
        u_rightEye: geometry.rightEye,
        u_mouth: geometry.mouth,
      })) {
        gl.uniform2f(gl.getUniformLocation(beautyProgram, name), ...value);
      }
    }
    drawQuad();

    if (effectMode === "none") {
      renderOrientedFrame();
      return;
    }

    let segmentResult = null;
    try {
      segmentResult = provider.segment(source, timestampMs);
      if (!segmentResult) {
        renderOrientedFrame();
        return;
      }
      const backgroundConfidenceTexture = segmentResult.confidenceTexture;

      // The confidence texture is reused between MediaPipe runs. Its expensive
      // 11x11 bilateral pass only needs to run when that texture changes.
      if (segmentResult.updated !== false || !hasPreviousMask) {
        gl.useProgram(bilateralProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, bilateralFbo.fbo);
        gl.viewport(0, 0, width, height);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, backgroundConfidenceTexture);
        gl.uniform1i(gl.getUniformLocation(bilateralProgram, "u_mask"), 2);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, frameTexture);
        gl.uniform1i(
          gl.getUniformLocation(bilateralProgram, "u_guideFrame"),
          1,
        );
        gl.uniform2f(
          gl.getUniformLocation(bilateralProgram, "u_texelSize"),
          1 / width,
          1 / height,
        );
        gl.uniform1f(
          gl.getUniformLocation(bilateralProgram, "u_sigmaSpace"),
          sigmaSpace,
        );
        gl.uniform1f(
          gl.getUniformLocation(bilateralProgram, "u_sigmaColor"),
          sigmaColor,
        );
        drawQuad();
      }

      let finalMaskTexture;
      if (hasPreviousMask) {
        gl.useProgram(temporalBlendProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, temporalFbo.fbo);
        gl.viewport(0, 0, width, height);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, bilateralFbo.texture);
        gl.uniform1i(
          gl.getUniformLocation(temporalBlendProgram, "u_currentMask"),
          0,
        );
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, previousMaskFbo.texture);
        gl.uniform1i(
          gl.getUniformLocation(temporalBlendProgram, "u_previousMask"),
          3,
        );
        gl.uniform1f(
          gl.getUniformLocation(temporalBlendProgram, "u_blendFactor"),
          temporalBlendFactor,
        );
        drawQuad();
        finalMaskTexture = temporalFbo.texture;
      } else {
        finalMaskTexture = bilateralFbo.texture;
      }

      gl.useProgram(copyProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousMaskFbo.fbo);
      gl.viewport(0, 0, width, height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, finalMaskTexture);
      gl.uniform1i(gl.getUniformLocation(copyProgram, "u_texture"), 0);
      drawQuad();
      hasPreviousMask = true;
      finalMaskTexture = previousMaskFbo.texture;

      const background = effectMode === "image"
        ? ensureBackgroundTexture()
        : renderBlurredBackground(finalMaskTexture);
      if (!background) {
        renderOrientedFrame();
        return;
      }
      renderComposite(background, finalMaskTexture);
    } catch (error) {
      console.warn("[Gregblur Image] Frame processing failed.", error);
      renderOrientedFrame();
    } finally {
      try {
        segmentResult?.close?.();
      } catch (error) {
        console.warn("[Gregblur Image] Mask release failed.", error);
      }
    }
  }

  return {
    async init(initialWidth, initialHeight) {
      if (canvas || gl) destroyInternal();
      const insertableStreamsAvailable =
        typeof globalThis.MediaStreamTrackProcessor === "function" &&
        typeof globalThis.MediaStreamTrackGenerator === "function";
      const canUseOffscreenCanvas =
        typeof OffscreenCanvas !== "undefined" &&
        (insertableStreamsAvailable || typeof document === "undefined");
      if (canUseOffscreenCanvas) {
        canvas = new OffscreenCanvas(initialWidth, initialHeight);
      } else {
        if (typeof document === "undefined") {
          throw new Error("Gregblur requires a canvas-capable environment.");
        }
        canvas = document.createElement("canvas");
        canvas.width = initialWidth;
        canvas.height = initialHeight;
      }

      gl = canvas.getContext("webgl2", {
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        antialias: false,
        desynchronized: true,
      });
      if (!gl) throw new Error("Gregblur requires WebGL2.");

      try {
        bilateralProgram = createProgram(
          gl,
          VERTEX_SHADER,
          BILATERAL_FILTER_SHADER,
        );
        temporalBlendProgram = createProgram(
          gl,
          VERTEX_SHADER_NO_FLIP,
          TEMPORAL_BLEND_SHADER,
        );
        beautyProgram = createProgram(gl, VERTEX_SHADER, BEAUTY_SHADER);
        copyProgram = createProgram(gl, VERTEX_SHADER_NO_FLIP, COPY_SHADER);
        maskedDownsampleProgram = createProgram(
          gl,
          VERTEX_SHADER_NO_FLIP,
          MASKED_DOWNSAMPLE_SHADER,
        );
        maskWeightedBlurProgram = createProgram(
          gl,
          VERTEX_SHADER_NO_FLIP,
          MASK_WEIGHTED_BLUR_SHADER,
        );
        compositeProgram = createProgram(
          gl,
          VERTEX_SHADER_NO_FLIP,
          COMPOSITE_SHADER,
        );
        quad = createFullscreenQuad(gl);
        initialiseFrameResources(initialWidth, initialHeight);
        await provider.init(canvas);
        if (backgroundSource) ensureBackgroundTexture();
      } catch (error) {
        destroyInternal();
        throw error;
      }
    },

    processFrame(source, timestampMs) {
      processFrameInternal(source, timestampMs);
    },

    getCanvas() {
      if (!canvas) throw new Error("Gregblur has not been initialised.");
      return canvas;
    },

    setEffect(options = {}) {
      const mode = options.mode;
      if (!EFFECT_MODES.has(mode)) {
        throw new RangeError('Gregblur mode must be "none", "blur", or "image".');
      }

      if (mode === "image") {
        const candidate = options.image ?? backgroundSource;
        const dimensions = sourceDimensions(candidate);
        if (!candidate || !dimensions.width || !dimensions.height) {
          throw new TypeError("Image mode requires a decoded background image.");
        }
        if (candidate !== backgroundSource) {
          const previousSource = backgroundSource;
          backgroundSource = candidate;
          backgroundUploaded = false;
          try {
            if (gl) ensureBackgroundTexture();
          } catch (error) {
            backgroundSource = previousSource;
            backgroundUploaded = false;
            try {
              if (gl && previousSource) ensureBackgroundTexture();
            } catch {
              // The original upload error is more useful to the caller.
            }
            throw error;
          }
        }
      }

      const wasProcessing = effectMode !== "none";
      const willProcess = mode !== "none";
      if (wasProcessing !== willProcess) hasPreviousMask = false;
      effectMode = mode;
    },

    setBeautyStrength(value) {
      beautyStrength = sanitiseUnitInterval(value, 0);
      if (beautyStrength === 0) beautyGeometry = null;
    },

    isProcessing() {
      return effectMode !== "none" || beautyStrength > 0;
    },

    getState() {
      return {
        effectMode,
        enabled: effectMode === "blur",
        processing: effectMode !== "none",
        hasBackgroundImage: Boolean(backgroundSource),
        backgroundUploaded: Boolean(backgroundTexture) && backgroundUploaded,
        beautySupported: Boolean(faceLandmarksProvider),
        beautyStrength: Math.round(beautyStrength * 100),
        outputSize: { width, height },
        composite: "gregblur-shared-gpu-matte",
      };
    },

    destroy() {
      destroyInternal();
    },
  };
}
