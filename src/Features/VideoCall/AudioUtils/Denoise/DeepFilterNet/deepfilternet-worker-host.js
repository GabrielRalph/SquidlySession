import {
	DFN_FRAME_SIZE,
	DFN_STATE_SIZE,
} from "./deepfilternet-model.js";

function validateRuntimeResult(result) {
	if (
		!(result?.frame instanceof Float32Array) ||
		result.frame.length !== DFN_FRAME_SIZE
	) {
		throw new Error("DeepFilterNet returned an invalid output frame.");
	}
	if (
		!(result.state instanceof Float32Array) ||
		result.state.length !== DFN_STATE_SIZE
	) {
		throw new Error("DeepFilterNet returned an invalid recurrent state.");
	}
	return result;
}

/** Owns one initialized DeepFilterNet runtime and its recurrent state. */
export class DeepFilterNetWorkerHost {
	constructor(createRuntime) {
		this.createRuntime = createRuntime;
		this.runtime = null;
		this.state = null;
		this.processing = Promise.resolve();
	}

	async initialize(modelUrl, wasmUrl) {
		const runtime = this.createRuntime();
		await runtime.initialize(modelUrl, wasmUrl);
		await runtime.processFrame(
			new Float32Array(DFN_FRAME_SIZE),
			new Float32Array(DFN_STATE_SIZE),
		).then(validateRuntimeResult);
		this.runtime = runtime;
		this.state = new Float32Array(DFN_STATE_SIZE);
	}

	async process(frame) {
		if (!this.runtime || !this.state) {
			throw new Error("DeepFilterNet worker is not initialized.");
		}
		if (!(frame instanceof Float32Array) || frame.length !== DFN_FRAME_SIZE) {
			throw new RangeError("Invalid DeepFilterNet frame length.");
		}

		const result = validateRuntimeResult(
			await this.runtime.processFrame(frame, this.state),
		);
		this.state = result.state;
		return result.frame;
	}

	attachPort(port) {
		port.onmessage = (event) => {
			if (event.data?.type !== "process") return;
			this.processing = this.processing.then(async () => {
				try {
					const output = await this.process(
						new Float32Array(event.data.samples),
					);
					const transferred = output.slice().buffer;
					port.postMessage(
						{ type: "processed", samples: transferred },
						[transferred],
					);
				} catch (error) {
					port.postMessage({
						type: "error",
						message:
							error instanceof Error
								? error.message
								: "DeepFilterNet inference failed.",
					});
				}
			});
		};
		port.start?.();
	}
}
