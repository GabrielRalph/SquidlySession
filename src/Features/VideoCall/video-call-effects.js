import { relURL } from "../../Utilities/usefull-funcs.js";
import {
    background,
    setBackgroundEffect as applyBackgroundEffect,
    setBeautyStrength as applyBeautyStrength,
} from "./background.js";

// Background/image/beauty controls live here so VideoCall keeps main's call logic.
const MAX_BACKGROUND_IMAGE_BYTES = 20 * 1024 * 1024;

// Keep the old effect visible while a bounded image is prepared. The Worker
// owns decoding/resizing, so a large upload does not compete with live rendering.
function decodeImageInWorker(file, maxDimension) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(relURL("./background-image-worker.js", import.meta));
        const finish = (error, image) => {
            clearTimeout(timeout);
            worker.terminate();
            error ? reject(error) : resolve(image);
        };
        const timeout = setTimeout(() => finish(new Error("Image worker timed out.")), 10000);
        worker.onmessage = ({data}) => finish(data.error ? new Error(data.error) : null, data.image);
        worker.onerror = () => finish(new Error("Image worker unavailable."));
        try { worker.postMessage({file, maxDimension}); }
        catch (error) { finish(error); }
    });
}

async function decodeBackgroundImage(file, maxDimension) {
    if (!(file instanceof File) || !file.type.startsWith("image/")) {
        throw new TypeError("Please select an image file.");
    }
    if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
        throw new RangeError("Background images must be 20 MB or smaller.");
    }

    if (typeof Worker === "function" && typeof createImageBitmap === "function") {
        try { return await decodeImageInWorker(file, maxDimension); }
        catch { /* CSP/older browsers retain the existing main-thread fallback. */ }
    }

    if (typeof createImageBitmap === "function") {
        try {
            return await createImageBitmap(file, { imageOrientation: "from-image" });
        } catch {
            return await createImageBitmap(file);
        }
    }

    const url = URL.createObjectURL(file);
    try {
        const image = new Image();
        image.decoding = "async";
        image.src = url;
        await image.decode();
        return image;
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** Owns effect UI and transitions; does not change call layout or audio tracks. */
export class VideoCallEffects {
    _backgroundEffectAvailable = false;
    _backgroundImageAvailable = false;
    _backgroundEffectMode = "none";
    _backgroundEffectTransition = null;
    _backgroundImageName = null;
    _beautyEffectAvailable = false;
    _beautyStrength = 0;
    _beautyControl = null;

    constructor(videoCall) {
        this.videoCall = videoCall;
    }

    // Resolve lazily: Features owns the session and its initialization lifecycle.
    get session() {
        return this.videoCall.session;
    }

    // Keep startup selection and capability detection in their original order.
    // This stream already contains main's processed audio. The router borrows
    // audio tracks and owns only generated video and its camera clones.
    async initialise(stream) {
        stream = await background(stream);
        const backgroundState = window.squidlyBackground?.getState()?.engineState;
        this._backgroundEffectAvailable =
            typeof backgroundState?.effectMode === "string" ||
            typeof backgroundState?.enabled === "boolean";
        this._backgroundImageAvailable =
            Boolean(backgroundState?.imageSupported);
        this._backgroundEffectMode = backgroundState?.effectMode ??
            (backgroundState?.enabled ? "blur" : "none");
        this._backgroundImageName = backgroundState?.imageName ?? null;
        this._beautyEffectAvailable =
            Boolean(backgroundState?.beautySupported);
        this._beautyStrength =
            Number(backgroundState?.beautyStrength) || 0;
        return stream;
    }

    // Insert between the original video/audio items, retaining indices and callbacks.
    getMenuItems() {
        return [
            {
                name: "beauty",
                symbol: "show-face",
                text: this._beautyStrength > 0
                    ? `beauty: ${this._beautyStrength}%`
                    : "beauty: off",
                hidden: !this._beautyEffectAvailable,
                index: 225,
                onSelect: () => this._toggleBeautyControl(),
            },
            {
                name: "background",
                symbol: this._backgroundEffectMode === "blur"
                    ? "blur"
                    : this._backgroundEffectMode === "image"
                        ? "upload-img"
                        : "blur-off",
                text: this._backgroundEffectAvailable
                    ? `background: ${this._backgroundEffectMode}`
                    : "background effects unavailable",
                index: 270,
                subMenu: [
                    {
                        name: "background-none",
                        symbol: "blur-off",
                        text: "no background effect",
                        index: 0,
                        onSelect: (e) =>
                            e.waitFor(this.setBackgroundEffect("none")),
                    },
                    {
                        name: "background-blur",
                        symbol: "blur",
                        text: "blur background",
                        index: 120,
                        onSelect: (e) =>
                            e.waitFor(this.setBackgroundEffect("blur")),
                    },
                    {
                        name: "background-image",
                        symbol: "upload-img",
                        text: "upload background image",
                        hidden: !this._backgroundImageAvailable,
                        index: 240,
                        onSelect: () => this._selectBackgroundImageFile(),
                    },
                ],
            },
        ];
    }

    _updateBackgroundButton() {
        const symbols = {
            none: "blur-off",
            blur: "blur",
            image: "upload-img",
        };
        const text = !this._backgroundEffectAvailable
            ? "background effects unavailable"
            : this._backgroundEffectMode === "image"
                ? `background: ${this._backgroundImageName ?? "image"}`
                : `background: ${this._backgroundEffectMode}`;
        this.session.toolBar.setMenuItemProperty(
            "control/background/symbol",
            symbols[this._backgroundEffectMode] ?? "blur-off",
        );
        this.session.toolBar.setMenuItemProperty(
            "control/background/text",
            text,
        );
    }

    _updateBeautyButton() {
        this.session.toolBar.setMenuItemProperty(
            "control/beauty/text",
            this._beautyStrength > 0
                ? `beauty: ${this._beautyStrength}%`
                : "beauty: off",
        );
    }

    _createBeautyControl() {
        if (this._beautyControl) return this._beautyControl;

        const panel = document.createElement("div");
        const label = document.createElement("label");
        const slider = document.createElement("input");
        const output = document.createElement("output");
        const close = document.createElement("button");

        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "Beauty level");
        Object.assign(panel.style, {
            position: "fixed",
            left: "50%",
            bottom: "96px",
            transform: "translateX(-50%)",
            zIndex: "10000",
            display: "none",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
            color: "white",
            background: "rgba(30, 30, 30, 0.92)",
            border: "1px solid rgba(255, 255, 255, 0.35)",
            borderRadius: "12px",
            boxShadow: "0 6px 24px rgba(0, 0, 0, 0.35)",
            font: "16px sans-serif",
        });

        label.textContent = "Beauty";
        label.htmlFor = "video-call-beauty-level";
        slider.id = label.htmlFor;
        slider.type = "range";
        slider.min = "0";
        slider.max = "100";
        slider.step = "1";
        slider.value = String(this._beautyStrength);
        slider.setAttribute("aria-label", "Beauty level");
        Object.assign(slider.style, {
            width: "min(42vw, 320px)",
            accentColor: "#7ec8ff",
        });

        output.value = `${this._beautyStrength}%`;
        output.style.minWidth = "3.5em";
        close.type = "button";
        close.textContent = "Done";
        Object.assign(close.style, {
            padding: "6px 10px",
            color: "white",
            background: "rgba(255, 255, 255, 0.14)",
            border: "1px solid rgba(255, 255, 255, 0.35)",
            borderRadius: "8px",
            cursor: "pointer",
        });

        const hide = () => {
            panel.style.display = "none";
        };
        slider.addEventListener("input", () => {
            const result = applyBeautyStrength(Number(slider.value));
            if (result.ok) {
                this._beautyStrength = result.strength;
                output.value = `${this._beautyStrength}%`;
                this._updateBeautyButton();
            }
        });
        close.addEventListener("click", hide);
        panel.addEventListener("keydown", (event) => {
            if (event.key === "Escape") hide();
        });

        panel.append(label, slider, output, close);
        document.body.appendChild(panel);
        this._beautyControl = { panel, slider, output };
        return this._beautyControl;
    }

    _toggleBeautyControl() {
        if (!this._beautyEffectAvailable) {
            this._notifyBackground(
                "Beauty is unavailable with the current video engine.",
                "error",
            );
            return;
        }
        const control = this._createBeautyControl();
        const show = control.panel.style.display === "none";
        control.panel.style.display = show ? "flex" : "none";
        if (show) control.slider.focus();
    }

    _notifyBackground(message, type = "info") {
        if (this.session.notifications?.notify instanceof Function) {
            this.session.notifications.notify(message, type);
        } else {
            console[type === "error" ? "warn" : "info"](`[VideoCall] ${message}`);
        }
    }

    _selectBackgroundImageFile() {
        if (!this._backgroundImageAvailable) {
            this._notifyBackground("Image backgrounds are unavailable.", "error");
            return;
        }

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/jpeg,image/webp,image/gif";
        input.hidden = true;
        document.body.appendChild(input);

        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            input.remove();
        };
        input.addEventListener("change", () => {
            const file = input.files?.[0] ?? null;
            cleanup();
            if (file) void this._applyBackgroundImageFile(file);
        }, { once: true });
        window.addEventListener("focus", () => {
            setTimeout(cleanup, 1000);
        }, { once: true });
        input.click();
    }

    async _applyBackgroundImageFile(file) {
        let image;
        try {
            this._notifyBackground("Loading background image.");
            const state = window.squidlyBackground?.getState()?.engineState;
            const size = state?.processingSize ?? {};
            const maxDimension = Math.max(480, Math.min(2048,
                Math.max(Number(size.width) || 640, Number(size.height) || 480)));
            image = await decodeBackgroundImage(file, maxDimension);
            // Allow input/paint before the engine's one-time Canvas/GPU upload.
            await new Promise(resolve => setTimeout(resolve, 0));
            const result = await this.setBackgroundEffect("image", {
                image,
                imageName: file.name,
            });
            if (!result.ok) {
                image.close?.();
                throw new Error(result.reason ?? "Image background could not be enabled.");
            }
            this._notifyBackground("Background image applied.", "success");
        } catch (error) {
            console.warn("[VideoCall] Background image could not be applied.", error);
            this._notifyBackground(
                error instanceof Error ? error.message : String(error),
                "error",
            );
        }
    }

    // Serialize mode changes, not image decoding. A failed transition must not
    // block later requests; update labels only after the engine accepts a change.
    async setBackgroundEffect(mode, options = {}) {
        const previous = this._backgroundEffectTransition ?? Promise.resolve();
        const transition = previous
            .catch(() => {})
            .then(() => applyBackgroundEffect(mode, options));
        this._backgroundEffectTransition = transition;
        try {
            const result = await transition;
            if (result.ok) {
                this._backgroundEffectAvailable = true;
                this._backgroundImageAvailable =
                    result.imageSupported || this._backgroundImageAvailable;
                this._backgroundEffectMode = result.mode;
                this._backgroundImageName = result.imageName ??
                    (result.mode === "image" ? this._backgroundImageName : null);
                this._updateBackgroundButton();
            } else {
                console.warn(
                    "[VideoCall] Background effect could not be changed.",
                    result.reason,
                );
                this._notifyBackground(
                    result.reason ?? "Background effect could not be changed.",
                    "error",
                );
            }
            return result;
        } finally {
            if (this._backgroundEffectTransition === transition) {
                this._backgroundEffectTransition = null;
            }
        }
    }

    async toggleBackgroundBlur() {
        return await this.setBackgroundEffect(
            this._backgroundEffectMode === "blur" ? "none" : "blur",
        );
    }

}
