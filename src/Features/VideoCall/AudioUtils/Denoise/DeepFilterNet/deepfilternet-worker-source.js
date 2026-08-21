import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";

import {
	createDeepFilterNetFeeds,
	readDeepFilterNetOutputs,
} from "./deepfilternet-model.js";
import { DeepFilterNetWorkerHost } from "./deepfilternet-worker-host.js";

const DEEPFILTERNET_OUTPUTS = ["enhanced_audio_frame", "new_states"];

class OnnxDeepFilterNetRuntime {
	async initialize(modelUrl, wasmUrl) {
		env.wasm.numThreads = 1;
		env.wasm.proxy = false;
		env.wasm.wasmPaths = { wasm: wasmUrl };
		this.session = await InferenceSession.create(modelUrl, {
			executionProviders: ["wasm"],
		});
	}

	async processFrame(frame, state) {
		if (!this.session) {
			throw new Error("DeepFilterNet runtime is not initialized.");
		}
		const outputs = await this.session.run(
			createDeepFilterNetFeeds(Tensor, frame, state),
			DEEPFILTERNET_OUTPUTS,
		);
		return readDeepFilterNetOutputs(outputs);
	}
}

const host = new DeepFilterNetWorkerHost(
	() => new OnnxDeepFilterNetRuntime(),
);

self.onmessage = async ({ data }) => {
	try {
		if (data.type === "initialize") {
			await host.initialize(data.modelUrl, data.wasmUrl);
			self.postMessage({ id: data.id, type: "ready" });
		} else if (data.type === "connect") {
			host.attachPort(data.port);
			self.postMessage({ id: data.id, type: "connected" });
		}
	} catch (error) {
		self.postMessage({
			id: data.id,
			type: "error",
			message:
				error instanceof Error
					? error.message
					: "DeepFilterNet worker failed.",
		});
	}
};
