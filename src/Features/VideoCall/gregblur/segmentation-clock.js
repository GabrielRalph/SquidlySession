// Keep fractional frame intervals instead of rounding every deadline up to
// the next camera frame (which turns 20 Hz into 15 Hz on a 30 Hz camera).
export function createSegmentationClock() {
  let deadline = -Infinity;
  let previousTime = -Infinity;
  let previousInterval = 0;
  return {
    reset() {
      deadline = -Infinity;
      previousTime = -Infinity;
      previousInterval = 0;
    },
    shouldRun(timestampMs, fps, hasMask) {
      const interval = 1000 / Math.max(1, fps);
      if (timestampMs < previousTime || interval !== previousInterval) {
        deadline = -Infinity;
      }
      previousTime = timestampMs;
      previousInterval = interval;
      if (hasMask && timestampMs + 0.5 < deadline) return false;
      // Skip missed slots after a stall; never enqueue catch-up inference.
      deadline = Number.isFinite(deadline)
        ? deadline + Math.max(1, Math.floor((timestampMs + 0.5 - deadline) / interval) + 1) * interval
        : timestampMs + interval;
      return true;
    },
  };
}
