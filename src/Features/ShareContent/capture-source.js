/** Capture identity deliberately excludes size: resizing is not a new source. */
export function captureSourceIdentity(track) {
    if (!track) return null;
    const settings = track.getSettings?.() || {};
    const handle = track.getCaptureHandle?.() || {};
    return JSON.stringify([track.id || "", track.label || "", settings.deviceId || "", settings.displaySurface || "",
        handle.origin || "", handle.handle || ""]);
}

export class CaptureSourceGuard {
    constructor(track) {
        this.track = track;
        this.identity = captureSourceIdentity(track);
    }

    changed(track) {
        return track !== this.track || captureSourceIdentity(track) !== this.identity;
    }
}

/** Input from a previous authorization must never control newly shared content. */
export function controlInputEnvelope(controlId, payload) {
    return { controlId, payload };
}

export function authorizedControlPayload(value, controlId) {
    return controlId && value && typeof value === "object"
        && value.controlId === controlId && typeof value.payload === "string"
        ? value.payload : null;
}
