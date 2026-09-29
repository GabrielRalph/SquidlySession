// Compare the current camera image with the image that produced the last mask.
// A tiny CPU surface avoids full-resolution readback and never queues frames.
export function hasSignificantMotion(current, reference) {
  if (!reference || current.length !== reference.length || !current.length) return false;
  let exposureShift = 0;
  for (let i = 0; i < current.length; i++) exposureShift += current[i] - reference[i];
  exposureShift /= current.length;
  let changed = 0, total = 0;
  for (let i = 0; i < current.length; i++) {
    const delta = Math.abs(current[i] - reference[i] - exposureShift);
    total += delta;
    if (delta >= 18) changed++;
  }
  // Reject sensor noise and uniform exposure changes, retaining local motion.
  return changed / current.length >= 0.035 && total / current.length >= 2.5;
}

export function createMaskMotionDetector() {
  const width = 32, height = 24;
  let canvas = null, context = null, reference = null, current = null;
  let disabledReason = null;
  return {
    sample(source) {
      if (disabledReason) return false;
      try {
        if (!context) {
          canvas = typeof OffscreenCanvas === 'function'
            ? new OffscreenCanvas(width, height) : document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
          if (!context) throw new Error('Motion Canvas 2D unavailable');
          current = new Float32Array(width * height);
        }
        context.drawImage(source, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        for (let i = 0; i < current.length; i++) {
          const p = i * 4;
          current[i] = pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114;
        }
        return hasSignificantMotion(current, reference);
      } catch (error) {
        disabledReason = error instanceof Error ? error.message : String(error);
        current = null;
        return false;
      }
    },
    commit() {
      if (!current) return;
      reference ??= new Float32Array(current.length);
      reference.set(current);
    },
    reset() {
      canvas = context = reference = current = null;
      disabledReason = null;
    },
    getState() { return { size: { width, height }, disabledReason }; },
  };
}
