/** Firebase keys under share-content/remote-control/ */
export const RC_MOVE_KEY = "move";
export const RC_KEY_KEY = "key";
export const RC_STATE_KEY = "state";

export const FIREBASE_MIN_INTERVAL_MS = 50;
export const HOVER_SUPPRESS_AFTER_DISCRETE_MS = 120;
export const CLICK_SLOP_NORM = 0.04;

export function clamp01(v) {
    return Math.min(1, Math.max(0, v));
}

export function buttonName(button) {
    if (button === 1) return "middle";
    if (button === 2) return "right";
    return "left";
}

export function eventModifiers(ev) {
    const mods = [];
    if (ev.shiftKey) mods.push("shift");
    if (ev.ctrlKey) mods.push("ctrl");
    if (ev.altKey) mods.push("alt");
    if (ev.metaKey) mods.push("meta");
    return mods;
}

export function wheelToLines(delta) {
    if (delta === 0) return 0;
    const lines = Math.max(1, Math.round(Math.abs(delta) / 40));
    return delta > 0 ? -lines : lines;
}

/**
 * @param {number} clientX
 * @param {number} clientY
 * @param {DOMRect} rect
 * @return {{nx: number, ny: number} | null}
 */
export function clientToNorm(clientX, clientY, rect) {
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
        nx: clamp01((clientX - rect.left) / rect.width),
        ny: clamp01((clientY - rect.top) / rect.height),
    };
}

export function parsePipes(value, minParts) {
    if (typeof value !== "string") return null;
    const parts = value.split("|");
    if (parts.length < minParts) return null;
    return parts;
}

function parseModList(raw) {
    if (!raw) return [];
    const allowed = new Set(["shift", "ctrl", "alt", "meta"]);
    const out = [];
    for (const part of String(raw).split("+")) {
        if (allowed.has(part) && !out.includes(part)) out.push(part);
    }
    return out;
}

export function parseKeyPayload(value) {
    const parts = parsePipes(value, 2);
    if (!parts) return null;
    const kind = parts[1];
    if (kind === "kr") return { kind: "kr" };
    if ((kind === "kd" || kind === "ku") && parts.length >= 4) {
        const code = parts[2];
        if (!code) return null;
        return {
            kind,
            code,
            key: parts[3] ?? "",
            modifiers: parseModList(parts[4] ?? ""),
        };
    }
    return null;
}

/**
 * Parse multiplexed move-channel payloads. Coordinates stay normalized.
 * @param {string} value
 * @return {object | null}
 */
export function parseStreamPayload(value) {
    const parts = parsePipes(value, 2);
    if (!parts) return null;
    if (parts.length >= 2 && (parts[1] === "kd" || parts[1] === "ku" || parts[1] === "kr")) {
        return parseKeyPayload(value);
    }
    if (parts.length === 3) {
        const nx = Number(parts[1]);
        const ny = Number(parts[2]);
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
        return { kind: "move", nx: clamp01(nx), ny: clamp01(ny) };
    }
    if (parts.length < 4) return null;
    const kind = parts[1];
    const nx = Number(parts[2]);
    const ny = Number(parts[3]);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
    const mapped = { nx: clamp01(nx), ny: clamp01(ny) };
    if (kind === "move" && parts.length === 4) {
        return { kind: "move", ...mapped };
    }
    if ((kind === "click" || kind === "down" || kind === "up") && parts.length === 5) {
        const button = parts[4];
        if (button !== "left" && button !== "right" && button !== "middle") return null;
        return { kind, button, ...mapped };
    }
    if (kind === "scroll" && parts.length === 6) {
        const dx = Number(parts[4]);
        const dy = Number(parts[5]);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
        return { kind: "scroll", dx: Math.round(dx), dy: Math.round(dy), ...mapped };
    }
    return null;
}

/** Drop the first Firebase snapshot so leftover session values are not replayed. */
export class FirstValueGuard {
    constructor() {
        this.primed = new Set();
    }

    shouldIgnore(key, value) {
        if (!this.primed.has(key)) {
            this.primed.add(key);
            return true;
        }
        return value == null || value === "";
    }

    reset() {
        this.primed.clear();
    }
}

export class RemoteControlPublisher {
    /**
     * @param {(key: string, payload: string) => void} publish
     */
    constructor(publish) {
        this.publish = publish;
        this.moveSeq = 0;
        this.eventSeq = 0;
        this.lastFirebaseAt = 0;
        this.lastMovePayload = "";
        this.suppressHoverUntil = 0;
        this.lastScrollAt = 0;
        this.pressed = false;
        this.sentButtonDown = false;
        this.pendingMove = null;
        this._raf = 0;
    }

    nextEventSeq() {
        this.eventSeq += 1;
        return this.eventSeq;
    }

    formatMove(nx, ny) {
        this.moveSeq += 1;
        return `${this.moveSeq}|${nx.toFixed(4)}|${ny.toFixed(4)}`;
    }

    formatTyped(kind, mapped, extra = []) {
        return [this.nextEventSeq(), kind, mapped.nx.toFixed(4), mapped.ny.toFixed(4), ...extra].join("|");
    }

    formatKey(action, code, key, modifiers) {
        if (action === "key.releaseAll") {
            return `${this.nextEventSeq()}|kr`;
        }
        const kind = action === "key.down" ? "kd" : "ku";
        const safeCode = String(code || "").replace(/\|/g, "");
        const safeKey = String(key || "").replace(/\|/g, "");
        const mods = (modifiers || []).join("+");
        return [this.nextEventSeq(), kind, safeCode, safeKey, mods].join("|");
    }

    holdMoveAfterDiscrete() {
        this.pendingMove = null;
        this.lastMovePayload = "";
        this.suppressHoverUntil = performance.now() + HOVER_SUPPRESS_AFTER_DISCRETE_MS;
    }

    emitMove(mapped) {
        if (!mapped) return false;
        if (this.pressed && !this.sentButtonDown) return false;
        const now = performance.now();
        if (now < this.suppressHoverUntil) return false;
        if (now - this.lastFirebaseAt < FIREBASE_MIN_INTERVAL_MS) return false;
        const coordsKey = `${mapped.nx.toFixed(4)}|${mapped.ny.toFixed(4)}`;
        if (coordsKey === this.lastMovePayload) return false;
        this.lastFirebaseAt = now;
        this.lastMovePayload = coordsKey;
        this.publish(RC_MOVE_KEY, this.formatMove(mapped.nx, mapped.ny));
        return true;
    }

    queueMove(mapped) {
        this.pendingMove = mapped;
        if (!this._raf) {
            this._raf = requestAnimationFrame(() => this._tick());
        }
    }

    _tick() {
        this._raf = 0;
        if (this.pendingMove && this.emitMove(this.pendingMove)) {
            this.pendingMove = null;
        }
        if (this.pendingMove) {
            this._raf = requestAnimationFrame(() => this._tick());
        }
    }

    emitButton(mapped, action, button) {
        this.holdMoveAfterDiscrete();
        this.publish(RC_MOVE_KEY, this.formatTyped(action, mapped, [button]));
        return true;
    }

    emitClick(mapped, button) {
        this.holdMoveAfterDiscrete();
        this.publish(RC_MOVE_KEY, this.formatTyped("click", mapped, [button]));
        return true;
    }

    emitScroll(mapped, dx, dy) {
        const now = performance.now();
        if (now - this.lastScrollAt < FIREBASE_MIN_INTERVAL_MS) {
            this.holdMoveAfterDiscrete();
            return false;
        }
        this.lastScrollAt = now;
        this.holdMoveAfterDiscrete();
        this.publish(RC_MOVE_KEY, this.formatTyped("scroll", mapped, [dx, dy]));
        return true;
    }

    emitKey(action, ev) {
        this.publish(RC_KEY_KEY, this.formatKey(action, ev.code, ev.key, eventModifiers(ev)));
        return true;
    }

    emitReleaseAll() {
        this.publish(RC_KEY_KEY, this.formatKey("key.releaseAll"));
    }

    stop() {
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;
        this.pendingMove = null;
        this.pressed = false;
        this.sentButtonDown = false;
    }
}

/**
 * Map a parsed stream/key event to the RemoteAgent JSON shape (Phase 2).
 * Pixel fields stay null until screen bounds are known.
 */
export function toAgentCommand(parsed) {
    if (!parsed) return null;
    if (parsed.kind === "move") return { type: "mouse.move", nx: parsed.nx, ny: parsed.ny };
    if (parsed.kind === "click") return { type: "mouse.click", nx: parsed.nx, ny: parsed.ny, button: parsed.button };
    if (parsed.kind === "down") return { type: "mouse.down", nx: parsed.nx, ny: parsed.ny, button: parsed.button };
    if (parsed.kind === "up") return { type: "mouse.up", nx: parsed.nx, ny: parsed.ny, button: parsed.button };
    if (parsed.kind === "scroll") {
        return { type: "mouse.scroll", nx: parsed.nx, ny: parsed.ny, dx: parsed.dx, dy: parsed.dy };
    }
    if (parsed.kind === "kd") return { type: "key.down", code: parsed.code, key: parsed.key, modifiers: parsed.modifiers };
    if (parsed.kind === "ku") return { type: "key.up", code: parsed.code, key: parsed.key, modifiers: parsed.modifiers };
    if (parsed.kind === "kr") return { type: "key.releaseAll" };
    return null;
}
