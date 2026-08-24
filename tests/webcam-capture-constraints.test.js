import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("webcam camParams2 disables cascaded browser suppressors", async () => {
	const source = await readFile("src/Utilities/webcam.js", "utf8");

	assert.match(source, /const camParams2 = \{[\s\S]*audio: \{[\s\S]*channelCount: 1/);
	assert.match(source, /const camParams2 = \{[\s\S]*audio: \{[\s\S]*sampleRate: 48000/);
	assert.match(
		source,
		/const camParams2 = \{[\s\S]*audio: \{[\s\S]*echoCancellation: true/,
	);
	assert.match(
		source,
		/const camParams2 = \{[\s\S]*audio: \{[\s\S]*noiseSuppression: false/,
	);
	assert.match(
		source,
		/const camParams2 = \{[\s\S]*audio: \{[\s\S]*autoGainControl: false/,
	);
	assert.doesNotMatch(
		source,
		/const camParams2 = \{[\s\S]*audio: \{[\s\S]*noiseSuppression: true/,
	);
});
