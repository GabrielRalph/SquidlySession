export const DFN_SAMPLE_RATE = 48_000;
export const DFN_FRAME_SIZE = 480;
export const DFN_STATE_SIZE = 45_304;

/**
 * Creates the exact input tensors expected by the local DeepFilterNet model.
 *
 * @param {typeof import("onnxruntime-web").Tensor} TensorClass Tensor constructor.
 * @param {Float32Array} frame One 10 ms mono frame.
 * @param {Float32Array} state Recurrent model state.
 * @returns {Record<string, import("onnxruntime-web").Tensor>} Named ONNX feeds.
 */
export function createDeepFilterNetFeeds(TensorClass, frame, state) {
	if (frame.length !== DFN_FRAME_SIZE) {
		throw new RangeError("Invalid DeepFilterNet frame length.");
	}
	if (state.length !== DFN_STATE_SIZE) {
		throw new RangeError("Invalid DeepFilterNet state length.");
	}

	return {
		input_frame: new TensorClass("float32", frame, [DFN_FRAME_SIZE]),
		states: new TensorClass("float32", state, [DFN_STATE_SIZE]),
		atten_lim_db: new TensorClass("float32", new Float32Array([0]), [1]),
	};
}

/**
 * Validates and unwraps one inference result.
 *
 * @param {Record<string, {data: unknown}>} outputs Named ONNX outputs.
 * @returns {{frame: Float32Array, state: Float32Array}} Validated result.
 */
export function readDeepFilterNetOutputs(outputs) {
	const frame = outputs.enhanced_audio_frame?.data;
	const state = outputs.new_states?.data;

	if (!(frame instanceof Float32Array) || frame.length !== DFN_FRAME_SIZE) {
		throw new Error("DeepFilterNet returned an invalid output frame.");
	}
	if (!(state instanceof Float32Array) || state.length !== DFN_STATE_SIZE) {
		throw new Error("DeepFilterNet returned an invalid recurrent state.");
	}

	return { frame, state };
}
