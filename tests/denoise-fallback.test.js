import assert from "node:assert/strict";
import test from "node:test";

import { DENOISER_MODES } from "../src/Features/VideoCall/AudioUtils/Denoise/denoiser-mode.js";
import {
	buildDenoiserFallbackOrder,
	createAdapterWithFallback,
} from "../src/Features/VideoCall/AudioUtils/Denoise/denoise-controller.js";

test("automatic fallback order is FastEnhancer Tiny then RNNoise then off", () => {
	assert.deepEqual(buildDenoiserFallbackOrder(DENOISER_MODES.FASTENHANCER_TINY), [
		DENOISER_MODES.FASTENHANCER_TINY,
		DENOISER_MODES.RNNOISE,
		DENOISER_MODES.OFF,
	]);
	assert.ok(
		!buildDenoiserFallbackOrder(DENOISER_MODES.FASTENHANCER_TINY).includes(
			DENOISER_MODES.DEEPFILTERNET,
		),
	);
});

test("manual DeepFilterNet is tried first but still falls back to RNNoise then off", () => {
	assert.deepEqual(buildDenoiserFallbackOrder(DENOISER_MODES.DEEPFILTERNET), [
		DENOISER_MODES.DEEPFILTERNET,
		DENOISER_MODES.RNNOISE,
		DENOISER_MODES.OFF,
	]);
});

test("createAdapterWithFallback retries RNNoise then off when preferred init fails", async () => {
	const attempted = [];
	const denoisers = { fake: true };
	const onError = () => {};
	const controller = { stream: { id: "rnnoise-ok" } };

	const result = await createAdapterWithFallback(
		{ id: "raw" },
		{
			preferredMode: DENOISER_MODES.FASTENHANCER_TINY,
			denoisers,
			onError,
			createController: async (rawStream, options) => {
				attempted.push(options.mode);
				assert.equal(rawStream.id, "raw");
				assert.equal(options.denoisers, denoisers);
				assert.equal(options.onError, onError);
				if (options.mode === DENOISER_MODES.FASTENHANCER_TINY) {
					throw new Error("tiny failed");
				}
				if (options.mode === DENOISER_MODES.RNNOISE) {
					return controller;
				}
				throw new Error(`unexpected mode ${options.mode}`);
			},
		},
	);

	assert.equal(result, controller);
	assert.deepEqual(attempted, [
		DENOISER_MODES.FASTENHANCER_TINY,
		DENOISER_MODES.RNNOISE,
	]);
});

test("createAdapterWithFallback uses off/raw when RNNoise also fails", async () => {
	const attempted = [];
	const offController = { stream: { id: "raw-mic" } };

	const result = await createAdapterWithFallback(
		{ id: "raw" },
		{
			preferredMode: DENOISER_MODES.FASTENHANCER_TINY,
			createController: async (_rawStream, options) => {
				attempted.push(options.mode);
				if (options.mode === DENOISER_MODES.OFF) return offController;
				throw new Error(`${options.mode} failed`);
			},
		},
	);

	assert.equal(result, offController);
	assert.deepEqual(attempted, [
		DENOISER_MODES.FASTENHANCER_TINY,
		DENOISER_MODES.RNNOISE,
		DENOISER_MODES.OFF,
	]);
});
