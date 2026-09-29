const REALTIME_GATE = Object.freeze({
  minimumWarmupFrames: 30,
  minimumFps: 24,
  maximumAverageInferenceMs: 28,
  maximumP95InferenceMs: 42,
});

function inspectHardware(rendererInfo) {
  const logicalProcessors = Number(navigator.hardwareConcurrency) || 0;
  const deviceMemoryGb = Number(navigator.deviceMemory) || null;
  return {
    qualified:
      rendererInfo.supported &&
      !rendererInfo.softwareRenderer &&
      (!logicalProcessors || logicalProcessors >= 8) &&
      (deviceMemoryGb === null || deviceMemoryGb >= 8),
    logicalProcessors,
    deviceMemoryGb,
    hasWebGpu: Boolean(navigator.gpu),
    renderer: rendererInfo.renderer,
  };
}

function isRealtime(benchmark) {
  return Boolean(benchmark) &&
    Number(benchmark.warmupFrames) >= REALTIME_GATE.minimumWarmupFrames &&
    Number(benchmark.measuredFps) >= REALTIME_GATE.minimumFps &&
    Number(benchmark.averageInferenceMs) <=
      REALTIME_GATE.maximumAverageInferenceMs &&
    Number(benchmark.p95InferenceMs) <= REALTIME_GATE.maximumP95InferenceMs;
}

/**
 * Starts an RVM-class adapter. Automatic mode requires premium hardware and
 * a passing warm benchmark; forced mode keeps the benchmark for diagnostics
 * but does not reject a usable RVM stream because of performance thresholds.
 */
export async function tryPremiumEngine(
  stream,
  rendererInfo,
  adapter,
  options = {},
) {
  const forced = options.force === true;
  const hardware = inspectHardware(rendererInfo);
  if (!hardware.qualified && !forced) {
    return {
      ok: false,
      skipped: true,
      reason: "Hardware did not meet the premium-engine admission gate",
      forced,
      hardware,
    };
  }
  if (!adapter) {
    return {
      ok: false,
      skipped: true,
      reason: "No RVM-class adapter is registered",
      forced,
      hardware,
    };
  }

  const context = {
    stream,
    rendererInfo,
    hardware,
    forced,
    realtimeGate: REALTIME_GATE,
    targetFps: 30,
    maximumWidth: 1280,
    maximumHeight: 720,
  };
  if (adapter.isSupported && !await adapter.isSupported(context)) {
    return {
      ok: false,
      skipped: true,
      reason: "The RVM-class adapter is not supported in this browser",
      forced,
      hardware,
    };
  }

  let result;
  try {
    result = await adapter.start(context);
    const usableStream =
      result?.stream instanceof MediaStream &&
      result.stream.getVideoTracks().length > 0;
    const benchmarkPassed = isRealtime(result?.benchmark);
    if (!result?.ok || !usableStream || (!forced && !benchmarkPassed)) {
      await result?.destroy?.();
      return {
        ok: false,
        reason: !result?.ok
          ? result?.reason ?? "RVM-class adapter failed to start"
          : usableStream
            ? "RVM-class benchmark did not meet the realtime gate"
            : "RVM-class adapter did not return a usable stream",
        benchmark: result?.benchmark ?? null,
        benchmarkPassed,
        forced,
        hardware,
      };
    }

    return {
      ...result,
      ok: true,
      mode: "rvm",
      reason: forced && !benchmarkPassed
        ? "RVM forced on despite missing the realtime benchmark gate"
        : result.reason ?? "RVM-class engine passed its realtime gate",
      benchmarkPassed,
      forced,
      hardware,
    };
  } catch (error) {
    try {
      await result?.destroy?.();
    } catch {
      // Preserve the startup error.
    }
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      forced,
      hardware,
    };
  }
}
