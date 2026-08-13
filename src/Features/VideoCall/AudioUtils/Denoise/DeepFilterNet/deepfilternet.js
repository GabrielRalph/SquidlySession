import { relURL } from "../../../../../Utilities/usefull-funcs.js";

import { DFN_SAMPLE_RATE } from "./deepfilternet-model.js";
import { createDeepFilterNetWorkerClient } from "./deepfilternet-worker-client.js";

const PROCESSOR_NAME = "DeepFilterNetWorkletProcessor";
const DEFAULT_WORKER_URL = relURL(
	"./deepfilternet-worker.js",
	import.meta,
);
const DEFAULT_WORKLET_URL = relURL(
	"./deepfilternet-worklet.js",
	import.meta,
);
const DEFAULT_MODEL_URL = relURL("./denoiser_model.onnx", import.meta);
const DEFAULT_WASM_URL = relURL(
	"./ort-wasm-simd-threaded.wasm",
	import.meta,
);

/** Creates a realtime DeepFilterNet denoiser plugin. */
export function createDeepFilterNetDenoiser(
	{
		workerUrl = DEFAULT_WORKER_URL,
		workletUrl = DEFAULT_WORKLET_URL,
		modelUrl = DEFAULT_MODEL_URL,
		wasmUrl = DEFAULT_WASM_URL,
		createClient = null,
		createMessageChannel = null,
		AudioWorkletNodeClass = null,
	} = {},
) {
	return {
		id: "deepfilternet",
		sampleRate: DFN_SAMPLE_RATE,
		channelCount: 1,
		realtime: {
			async createProcessor({ context, onError }) {
				const WorkletNodeClass =
					AudioWorkletNodeClass || globalThis.AudioWorkletNode;
				if (!WorkletNodeClass) {
					throw new Error("AudioWorklet is not supported by this browser.");
				}
				if (!createClient && typeof globalThis.Worker !== "function") {
					throw new Error("Web Workers are not supported by this browser.");
				}
				if (
					!createMessageChannel &&
					typeof globalThis.MessageChannel !== "function"
				) {
					throw new Error("MessageChannel is not supported by this browser.");
				}

				let client = null;
				let channel = null;
				let node = null;
				let cleanupPromise = null;
				const close = () => {
					if (!cleanupPromise) {
						cleanupPromise = (async () => {
							if (node) {
								node.port.postMessage({ type: "close" });
								node.port.onmessage = null;
								node.onprocessorerror = null;
							}
							channel?.port1?.close?.();
							channel?.port2?.close?.();
							client?.close();
						})();
					}
					return cleanupPromise;
				};

				try {
					client = createClient
						? createClient()
						: createDeepFilterNetWorkerClient(
								new Worker(workerUrl, { type: "module" }),
							);
					client.setFatalErrorHandler(onError);
					await client.initialize(modelUrl, wasmUrl);
					await context.audioWorklet.addModule(workletUrl);

					node = new WorkletNodeClass(context, PROCESSOR_NAME, {
						numberOfInputs: 1,
						numberOfOutputs: 1,
						outputChannelCount: [1],
					});
					node.port.onmessage = ({ data }) => {
						if (data?.type === "error") {
							onError(new Error(data.message));
						}
					};
					node.onprocessorerror = () => {
						onError(
							new Error("DeepFilterNet AudioWorklet processor failed."),
						);
					};

					channel = createMessageChannel
						? createMessageChannel()
						: new MessageChannel();
					await client.connect(channel.port1);
					node.port.postMessage(
						{ type: "connect", port: channel.port2 },
						[channel.port2],
					);
					return { node, close };
				} catch (error) {
					await close();
					throw error;
				}
			},
		},
	};
}

export const deepFilterNetDenoiser = createDeepFilterNetDenoiser();
