import { relURL } from "../../../../../Utilities/usefull-funcs.js";

import {
	DFN_FRAME_SIZE,
	DFN_SAMPLE_RATE,
} from "./deepfilternet-model.js";
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
const FRAME_BUDGET_MS = (DFN_FRAME_SIZE / DFN_SAMPLE_RATE) * 1000;
const DEFAULT_DIAGNOSTICS_EVERY_FRAMES = 100;

function createDiagnosticsLogger() {
	let lastDroppedFrames = 0;
	let lastUnderflowQuanta = null;
	let lastWarningAt = 0;
	return (metrics) => {
		const droppedFrames = metrics?.droppedFrames || 0;
		const underflowQuanta = metrics?.underflowQuanta || 0;
		const isSlow = metrics?.inferenceMs > FRAME_BUDGET_MS;
		const hasNewDrops = droppedFrames > lastDroppedFrames;
		const newUnderflows =
			lastUnderflowQuanta === null
				? 0
				: underflowQuanta - lastUnderflowQuanta;
		lastDroppedFrames = droppedFrames;
		lastUnderflowQuanta = underflowQuanta;
		if (!isSlow && !hasNewDrops && newUnderflows <= 5) return;

		const currentTime = Date.now();
		if (
			!hasNewDrops &&
			newUnderflows <= 5 &&
			currentTime - lastWarningAt < 1000
		) {
			return;
		}
		lastWarningAt = currentTime;
		console.warn(
			"[DeepFilterNet] realtime processing is behind.",
			metrics,
		);
	};
}

function createDeepFilterNetWorker(workerUrl) {
	const pageLocation = globalThis.location;
	const resolvedWorkerUrl = pageLocation
		? new URL(workerUrl, pageLocation.href)
		: null;
	const isCrossOrigin =
		resolvedWorkerUrl && resolvedWorkerUrl.origin !== pageLocation.origin;

	if (!isCrossOrigin) {
		return {
			worker: new Worker(workerUrl, { type: "module" }),
			cleanup: () => {},
		};
	}

	if (
		typeof globalThis.Blob !== "function" ||
		typeof globalThis.URL?.createObjectURL !== "function" ||
		typeof globalThis.URL?.revokeObjectURL !== "function"
	) {
		throw new Error(
			"Cross-origin DeepFilterNet workers require Blob URL support.",
		);
	}

	const bootstrap = new Blob(
		[`import ${JSON.stringify(resolvedWorkerUrl.href)};`],
		{ type: "text/javascript" },
	);
	const bootstrapUrl = URL.createObjectURL(bootstrap);
	let cleanedUp = false;
	const cleanup = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		URL.revokeObjectURL(bootstrapUrl);
	};

	try {
		return {
			worker: new Worker(bootstrapUrl, { type: "module" }),
			cleanup,
		};
	} catch (error) {
		cleanup();
		throw error;
	}
}

/** Creates a realtime DeepFilterNet denoiser plugin. */
export function createDeepFilterNetDenoiser(
	{
		workerUrl = DEFAULT_WORKER_URL,
		workletUrl = DEFAULT_WORKLET_URL,
		modelUrl = DEFAULT_MODEL_URL,
		wasmUrl = DEFAULT_WASM_URL,
		onDiagnostics = createDiagnosticsLogger(),
		diagnosticsEveryFrames = DEFAULT_DIAGNOSTICS_EVERY_FRAMES,
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
				const diagnosticsEnabled =
					typeof onDiagnostics === "function" &&
					Number.isInteger(diagnosticsEveryFrames) &&
					diagnosticsEveryFrames > 0;
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
				let worker = null;
				let cleanupWorker = null;
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
							try {
								client?.close();
							} finally {
								if (!client) worker?.terminate?.();
								cleanupWorker?.();
							}
						})();
					}
					return cleanupPromise;
				};

				try {
					if (createClient) {
						client = createClient();
					} else {
						const workerHandle = createDeepFilterNetWorker(workerUrl);
						worker = workerHandle.worker;
						cleanupWorker = workerHandle.cleanup;
						client = createDeepFilterNetWorkerClient(worker);
					}
					client.setFatalErrorHandler(onError);
					await client.initialize(modelUrl, wasmUrl);
					await context.audioWorklet.addModule(workletUrl);

					node = new WorkletNodeClass(context, PROCESSOR_NAME, {
						numberOfInputs: 1,
						numberOfOutputs: 1,
						outputChannelCount: [1],
						processorOptions: {
							diagnosticsEveryFrames: diagnosticsEnabled
								? diagnosticsEveryFrames
								: 0,
						},
					});
					node.port.onmessage = ({ data }) => {
						if (data?.type === "error") {
							onError(new Error(data.message));
						} else if (data?.type === "diagnostics") {
							onDiagnostics?.(data.metrics);
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
