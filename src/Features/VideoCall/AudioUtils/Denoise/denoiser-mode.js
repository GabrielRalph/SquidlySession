export const DENOISER_MODES = Object.freeze({
	OFF: "off",
	RNNOISE: "rnnoise",
	DEEPFILTERNET: "deepfilternet",
	FASTENHANCER_TINY: "fastenhancer-tiny",
});

const VALID_MODES = new Set(Object.values(DENOISER_MODES));
const DEFAULT_MODE = DENOISER_MODES.FASTENHANCER_TINY;

let currentMode = DEFAULT_MODE;
const listeners = new Set();
let pendingTransition = Promise.resolve();

function assertDenoiserMode(mode) {
	if (!VALID_MODES.has(mode)) {
		throw new TypeError(
			`Denoiser mode must be one of: ${[...VALID_MODES].join(", ")}.`,
		);
	}
}

/** Returns the mode currently selected for the denoise pipeline. */
export function getDenoiserMode() {
	return currentMode;
}

/**
 * Subscribes to mode changes. A listener may return a promise while an active
 * call rebuilds its audio graph. The mode is committed only after listeners
 * have completed successfully.
 */
export function subscribeDenoiserMode(listener) {
	if (typeof listener !== "function") {
		throw new TypeError("Denoiser mode listener must be a function.");
	}
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * Selects the realtime denoiser mode. The returned promise resolves once any
 * active call has switched its published track.
 */
export async function setDenoiserMode(mode) {
	assertDenoiserMode(mode);

	const transition = async () => {
		if (mode === currentMode) {
			console.log("already set the mode");
			return currentMode;
		}

		const previousMode = currentMode;
		for (const listener of [...listeners]) {
			await listener(mode, previousMode);
		}

		currentMode = mode;
		console.log(`switched to ${mode}`);
		return currentMode;
	};

	const result = pendingTransition.then(transition, transition);
	const handledResult = result.catch((error) => {
		console.error(`Could not switch denoiser mode to ${mode}.`, error);
		return currentMode;
	});
	pendingTransition = handledResult;
	return handledResult;
}

/** Installs the public console/browser controls on a target object. */
export function installDenoiserControls(target = globalThis) {
	if (!target) return target;
	target.setDenoiserMode = setDenoiserMode;
	target.getDenoiserMode = getDenoiserMode;
	return target;
}

if (typeof window !== "undefined") {
	installDenoiserControls(window);
}
