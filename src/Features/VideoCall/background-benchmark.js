// Local startup comparison. Mask age observed during output playback is a
// tracking-latency proxy, not camera-to-remote-display or network latency.
/**
 * Rank usable local measurements by mask age plus cadence penalties (ms).
 * Output stalls count even when average FPS is good; slow mask updates have
 * their own penalty. This does not score segmentation accuracy or hair detail.
 */
export function rankCandidates(results) {
  return results.filter(r => r.ok && Number.isFinite(r.outputFps) && r.outputFps >= 5 &&
    Number.isFinite(r.segmentationFps) && r.segmentationFps >= 1 &&
    Number.isFinite(r.maskAgeP95Ms) && r.maskAgeP95Ms >= 0).map(r => ({
      ...r,
      scoreMs: r.maskAgeP95Ms + 2 * Math.max(0,
        1000 / r.outputFps - 1000 / 30,
        (r.frameIntervalP95Ms ?? 1000 / r.outputFps) - 1000 / 30) +
        2 * Math.max(0, 1000 / r.segmentationFps - 1000 / 30),
    })).sort((a, b) => a.scoreMs - b.scoreMs || b.outputFps - a.outputFps ||
      a.engine.localeCompare(b.engine));
}

/**
 * Sequential startup-only trials. This function owns each trial until it is
 * destroyed or returned to the router. Only the last valid trial may remain
 * alive for reuse; a different winner must restart after that trial is freed.
 * Abort signals unwind ownership through finally, including pending probes.
 */
export async function chooseStartupEngine(candidates, measure, signal, report) {
  const check = () => signal.throwIfAborted();
  let retained = null;
  try {
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      check();
      let engine;
      try {
        engine = await candidate.start();
        check();
        if (!engine?.ok) throw new Error(engine?.reason ?? 'Engine failed to start');
        const metrics = await measure(engine, signal);
        check();
        const result = { engine: candidate.name, ok: true, ...metrics };
        report.results.push(result);
        // Keep only the final trial alive, so probes never compete for resources.
        if (index === candidates.length - 1 && rankCandidates([result]).length) {
          retained = {name:candidate.name, engine};
          engine = null;
        }
      } catch (error) {
        check();
        report.results.push({ engine: candidate.name, ok: false, reason: String(error.message ?? error) });
      } finally {
        await engine?.destroy?.();
      }
    }
    report.ranking = rankCandidates(report.results);
    for (const result of report.ranking) {
      check();
      let engine;
      try {
        if (retained?.name === result.engine) {
          engine = retained.engine;
          retained = null;
          report.reusedTrial = true;
        } else {
          await retained?.engine.destroy();
          retained = null;
          engine = await candidates.find(c => c.name === result.engine).start();
          report.reusedTrial = false;
        }
        check();
        if (!engine?.ok) throw new Error(engine?.reason ?? 'Winner failed to restart');
        report.winner = result.engine;
        report.locked = true;
        return engine;
      } catch (error) {
        await engine?.destroy?.();
        check();
        report.restartFailures.push({engine: result.engine, reason: String(error.message ?? error)});
      }
    }
    return null;
  } finally {
    await retained?.engine.destroy();
  }
}

function pause(ms, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => {signal.removeEventListener('abort', abort); resolve();}, ms);
    signal.addEventListener('abort', abort, {once:true});
  });
}

/**
 * Observe generated-video delivery after 1 s warmup, then sample state 20 times
 * at 100 ms intervals. Timer delays can make the nominal 2 s window longer.
 * Output FPS comes from playback, mask age from diagnostics, and segmentation
 * FPS from the completion counter; these are distinct measurements.
 */
export async function measureStartupEngine(engine, signal) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = engine.stream;
  Object.assign(video.style, {position:'fixed',left:'-10000px',width:'2px',height:'2px',opacity:'0'});
  document.body.appendChild(video);
  let callback = null, frames = 0, observing = true;
  let sampling = false, previousFrameAt = null;
  const intervals = [];
  const hasCallback = typeof video.requestVideoFrameCallback === 'function';
  const watch = () => {
    if (!observing) return;
    callback = video.requestVideoFrameCallback((now) => {
      frames++;
      if (sampling && previousFrameAt !== null) intervals.push(now - previousFrameAt);
      previousFrameAt = now;
      watch();
    });
  };
  const count = () => hasCallback ? frames : video.getVideoPlaybackQuality?.().totalVideoFrames;
  try {
    if (!hasCallback && typeof video.getVideoPlaybackQuality !== 'function') {
      throw new Error('Output frame measurement unavailable');
    }
    let playError = null;
    void video.play().catch(error => {playError = error;});
    if (hasCallback) watch();
    // A bounded startup sample, not a steady-state benchmark. Do not extend
    // the test into the call or keep testing after selection.
    await pause(1000, signal);
    if (playError) throw playError;
    if (document.visibilityState === 'hidden') throw new Error('Keep the tab visible during startup measurement');
    const initialState = engine.getState();
    const initialMasks = (initialState.maskProvider ?? initialState.segmentationScheduler)?.segmentationRuns ?? 0;
    const startFrames = count(), startedAt = performance.now(), ages = [];
    sampling = true;
    previousFrameAt = null;
    for (let i = 0; i < 20; i++) {
      await pause(100, signal);
      if (document.visibilityState === 'hidden') throw new Error('Startup measurement interrupted by hidden tab');
      const state = engine.getState();
      if (state.outputTrackState !== 'live') throw new Error('Output track ended during measurement');
      const age = (state.maskProvider ?? state.segmentationScheduler)?.maskAgeMs;
      if (Number.isFinite(age)) ages.push(age);
    }
    const elapsed = performance.now() - startedAt;
    const final = engine.getState();
    const masks = (final.maskProvider ?? final.segmentationScheduler)?.segmentationRuns ?? 0;
    ages.sort((a,b)=>a-b);
    if (ages.length < 15) throw new Error('Insufficient valid mask samples');
    intervals.sort((a,b)=>a-b);
    return {
      frameIntervalP95Ms: intervals.length
        ? Number(intervals[Math.ceil(intervals.length*0.95)-1].toFixed(1)) : null,
      outputFps: Number(((count()-startFrames)*1000/elapsed).toFixed(1)),
      segmentationFps: Number(((masks-initialMasks)*1000/elapsed).toFixed(1)),
      maskAgeP95Ms: ages[Math.ceil(ages.length*0.95)-1],
      measuredMs: Math.round(elapsed), sampleCount: ages.length,
    };
  } finally {
    observing = false;
    if (callback !== null) video.cancelVideoFrameCallback?.(callback);
    video.pause();
    video.srcObject = null;
    video.remove();
  }
}
