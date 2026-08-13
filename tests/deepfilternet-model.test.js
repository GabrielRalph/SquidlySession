import assert from "node:assert/strict";
import test from "node:test";

import {
	createDeepFilterNetFeeds,
	DFN_FRAME_SIZE,
	DFN_STATE_SIZE,
	readDeepFilterNetOutputs,
} from "../src/Features/VideoCall/AudioUtils/Denoise/DeepFilterNet/deepfilternet-model.js";

class FakeTensor {
	constructor(type, data, dims) {
		this.type = type;
		this.data = data;
		this.dims = dims;
	}
}

test("DeepFilterNet feeds use the model's exact names and dimensions", () => {
	const feeds = createDeepFilterNetFeeds(
		FakeTensor,
		new Float32Array(DFN_FRAME_SIZE),
		new Float32Array(DFN_STATE_SIZE),
	);

	assert.deepEqual(Object.keys(feeds), [
		"input_frame",
		"states",
		"atten_lim_db",
	]);
	assert.deepEqual(feeds.input_frame.dims, [480]);
	assert.deepEqual(feeds.states.dims, [45_304]);
	assert.deepEqual(feeds.atten_lim_db.data, new Float32Array([0]));
});

test("DeepFilterNet rejects frames and recurrent state with invalid lengths", () => {
	assert.throws(
		() =>
			createDeepFilterNetFeeds(
				FakeTensor,
				new Float32Array(479),
				new Float32Array(DFN_STATE_SIZE),
			),
		/frame length/i,
	);
	assert.throws(
		() =>
			createDeepFilterNetFeeds(
				FakeTensor,
				new Float32Array(DFN_FRAME_SIZE),
				new Float32Array(45_303),
			),
		/state length/i,
	);
});

test("DeepFilterNet validates the model's enhanced frame and recurrent state", () => {
	const enhancedFrame = new Float32Array(DFN_FRAME_SIZE).fill(0.25);
	const nextState = new Float32Array(DFN_STATE_SIZE).fill(0.5);

	assert.deepEqual(
		readDeepFilterNetOutputs({
			enhanced_audio_frame: { data: enhancedFrame },
			new_states: { data: nextState },
		}),
		{ frame: enhancedFrame, state: nextState },
	);
	assert.throws(
		() =>
			readDeepFilterNetOutputs({
				enhanced_audio_frame: { data: new Float32Array(479) },
				new_states: { data: nextState },
			}),
		/output frame/i,
	);
	assert.throws(
		() =>
			readDeepFilterNetOutputs({
				enhanced_audio_frame: { data: enhancedFrame },
				new_states: { data: new Float32Array(45_303) },
			}),
		/recurrent state/i,
	);
});
