// Opportunistically use camera-rate masks only with measured session headroom.
// Leave room below the allocator's 0.52 constrained-load threshold.
export function getHeadroomSegmentationFps(baseFps, state, eligible) {
  const task = state.tasks?.['background-segmenter'];
  const ms = task?.averageDurationMs;
  if (!eligible || !task?.active || !(ms > 0) || ms > 12 ||
      !(state.longTaskRatio < 0.03) || !(state.slowFrameRatio < 0.06)) return baseFps;
  const otherLoad = Math.max(0, state.estimatedVisionLoad - task.estimatedLoad);
  return otherLoad + ms * 30 / 1000 <= 0.42 ? Math.max(baseFps, 30) : baseFps;
}

// History decays with elapsed source time, not the number of model updates.
// A stale or rewound timeline must not carry an old silhouette into a new one.
export function getMaskHistoryWeight(baseWeight, timestampMs, previousMs) {
  const elapsed = timestampMs - previousMs;
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed >= 250) return 0;
  return Math.pow(baseWeight, Math.max(1, elapsed / (1000 / 30)));
}

// A moving edge may use a slightly larger budget than the steady-state boost.
// Keep the projected load below the allocator's constrained threshold (0.52).
export function getMotionSegmentationFps(baseFps, state, eligible) {
  const task = state.tasks?.['background-segmenter'];
  const ms = task?.averageDurationMs;
  if (!eligible || !task?.active || !(ms > 0) || ms > 16 ||
      !(state.longTaskRatio < 0.03) || !(state.slowFrameRatio < 0.06)) return baseFps;
  const otherLoad = Math.max(0, state.estimatedVisionLoad - task.estimatedLoad);
  return otherLoad + ms * 30 / 1000 <= 0.48 ? Math.max(baseFps, 30) : baseFps;
}
