import assert from "node:assert/strict";
import test from "node:test";

import {
	DENOISER_MODES,
	getDenoiserMode,
	installDenoiserControls,
	setDenoiserMode,
	subscribeDenoiserMode,
} from "../src/Features/VideoCall/AudioUtils/Denoise/denoiser-mode.js";

test("denoiser mode controls expose the three modes and current state", async () => {
	const controls = {};
	installDenoiserControls(controls);

	assert.deepEqual(DENOISER_MODES, {
		OFF: "off",
		RNNOISE: "rnnoise",
		DEEPFILTERNET: "deepfilternet",
		FASTENHANCER_SMALL: "fastenhancer-small",
	});
	assert.equal(controls.getDenoiserMode(), "fastenhancer-small");

	const messages = [];
	const originalLog = console.log;
	console.log = (message) => messages.push(message);
	try {
		await controls.setDenoiserMode("rnnoise");
		assert.equal(controls.getDenoiserMode(), "rnnoise");
		assert.deepEqual(messages, ["switched to rnnoise"]);

		await controls.setDenoiserMode("rnnoise");
		assert.equal(controls.getDenoiserMode(), "rnnoise");
		assert.deepEqual(messages, ["switched to rnnoise", "already set the mode"]);
	} finally {
		console.log = originalLog;
	}

	await setDenoiserMode("deepfilternet");
});

test("denoiser mode controls reject unknown modes without changing state", async () => {
	await setDenoiserMode("off");

	await assert.rejects(
		() => setDenoiserMode("not-a-denoiser"),
		/denoiser mode must be one of: off, rnnoise, deepfilternet, fastenhancer-small/i,
	);
	assert.equal(getDenoiserMode(), "off");

	await setDenoiserMode("deepfilternet");
});

test("mode changes wait for the active call before committing the getter", async () => {
	await setDenoiserMode("off");
	const transitions = [];
	const unsubscribe = subscribeDenoiserMode(async (nextMode, previousMode) => {
		transitions.push([previousMode, nextMode]);
		assert.equal(getDenoiserMode(), "off");
		await Promise.resolve();
	});

	try {
		await setDenoiserMode("rnnoise");
		assert.deepEqual(transitions, [["off", "rnnoise"]]);
		assert.equal(getDenoiserMode(), "rnnoise");
	} finally {
		unsubscribe();
		await setDenoiserMode("deepfilternet");
	}
});
