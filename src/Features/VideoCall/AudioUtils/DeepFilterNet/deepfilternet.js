import { relURL } from "../../../../Utilities/usefull-funcs.js";

import { DFN_SAMPLE_RATE } from "./deepfilternet-model.js";
import { createDeepFilterNetWorkerClient } from "./deepfilternet-worker-client.js";

const PROCESSOR_NAME = "DeepFilterNetWorkletProcessor";
const DEFAULT_WORKER_URL = relURL("./deepfilternet-worker.js", import.meta);
const DEFAULT_WORKLET_URL = relURL("./deepfilternet-worklet.js", import.meta);
const DEFAULT_MODEL_URL = relURL("./denoiser_model.onnx", import.meta);
const DEFAULT_WASM_URL = relURL(
	"./ort-wasm-simd-threaded.wasm",
	import.meta,
);

function makeTrackChangedEvent(oldTrack, newTrack) {
	const event = new Event("trackchanged");
	event.oldTrack = oldTrack;
	event.newTrack = newTrack;
	return event;
}

/**
 * Replaces a stream's microphone track with a DeepFilterNet-processed track.
 *
 * @param {MediaStream} inputStream Capture stream containing microphone audio.
 * @param {object} [options] Test and runtime dependency overrides.
 * @returns {Promise<{
 * stream: MediaStream,
 * audioTrack: MediaStreamTrack,
 * context: AudioContext,
 * node: AudioWorkletNode,
 * close: function(): Promise<void>
 * }>} Processed stream and owned-resource lifecycle.
 */
export async function createDeepFilterNetAdapter(
	inputStream,
	{
		context = null,
		workerUrl = DEFAULT_WORKER_URL,
		workletUrl = DEFAULT_WORKLET_URL,
		modelUrl = DEFAULT_MODEL_URL,
		wasmUrl = DEFAULT_WASM_URL,
		createClient = null,
		createMessageChannel = null,
		onError = null,
	} = {},
) {
	if (!(inputStream instanceof MediaStream)) {
		throw new TypeError("inputStream must be a MediaStream.");
	}
	const inputAudioTrack = inputStream.getAudioTracks()[0];
	if (!inputAudioTrack) {
		throw new Error("inputStream must contain an audio track.");
	}

	const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
	if (!context && !AudioContextClass) {
		throw new Error("Web Audio is not supported by this browser.");
	}
	if (typeof globalThis.AudioWorkletNode !== "function") {
		throw new Error("AudioWorklet is not supported by this browser.");
	}
	if (!createClient && typeof globalThis.Worker !== "function") {
		throw new Error("Web Workers are not supported by this browser.");
	}
	if (!createMessageChannel && typeof globalThis.MessageChannel !== "function") {
		throw new Error("MessageChannel is not supported by this browser.");
	}

	const audioContext =
		context || new AudioContextClass({ sampleRate: DFN_SAMPLE_RATE });
	let client = null;
	let channel = null;
	let workletNode = null;
	let destinationNode = null;
	let sourceNode = null;
	let processedAudioTrack = null;
	let listeningForTrackChanges = false;
	let cleanupPromise = null;
	let runtimeErrorReported = false;

	const onTrackChanged = (event) => {
		const { oldTrack, newTrack } = event;
		if (!oldTrack || !newTrack || oldTrack.kind !== newTrack.kind) return;

		if (newTrack.kind === "audio") {
			connectInputTrack(newTrack);
		} else if (newTrack.kind === "video") {
			if (outputStream.getTracks().includes(oldTrack)) {
				outputStream.removeTrack(oldTrack);
			}
			outputStream.addTrack(newTrack);
			outputStream.dispatchEvent(makeTrackChangedEvent(oldTrack, newTrack));
		}
	};

	let outputStream = null;
	const connectInputTrack = (track) => {
		sourceNode?.disconnect();
		sourceNode = audioContext.createMediaStreamSource(new MediaStream([track]));
		sourceNode.connect(workletNode);
	};

	const cleanup = () => {
		if (!cleanupPromise) {
			cleanupPromise = (async () => {
				if (listeningForTrackChanges) {
					inputStream.removeEventListener("trackchanged", onTrackChanged);
				}
				sourceNode?.disconnect();
				if (workletNode) {
					workletNode.port.postMessage({ type: "close" });
					workletNode.disconnect();
				}
				destinationNode?.disconnect();
				processedAudioTrack?.stop();
				channel?.port1?.close?.();
				channel?.port2?.close?.();
				client?.close();
				if (audioContext.state !== "closed") await audioContext.close();
			})();
		}
		return cleanupPromise;
	};

	const handleRuntimeError = (error) => {
		if (runtimeErrorReported) return;
		runtimeErrorReported = true;
		const runtimeError =
			error instanceof Error
				? error
				: new Error("DeepFilterNet runtime failed.");
		void cleanup();
		if (onError) onError(runtimeError);
	};

	try {
		if (audioContext.sampleRate !== DFN_SAMPLE_RATE) {
			throw new RangeError("DeepFilterNet requires a 48 kHz AudioContext.");
		}

		client = createClient
			? createClient()
			: createDeepFilterNetWorkerClient(
					new Worker(workerUrl, { type: "module" }),
				);
		client.setFatalErrorHandler(handleRuntimeError);
		await client.initialize(modelUrl, wasmUrl);
		await audioContext.audioWorklet.addModule(workletUrl);

		workletNode = new AudioWorkletNode(audioContext, PROCESSOR_NAME, {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [1],
		});
		workletNode.port.onmessage = ({ data }) => {
			if (data?.type === "error") {
				handleRuntimeError(new Error(data.message));
			}
		};
		destinationNode = audioContext.createMediaStreamDestination();
		destinationNode.channelCount = 1;
		destinationNode.channelCountMode = "explicit";
		workletNode.connect(destinationNode);

		channel = createMessageChannel
			? createMessageChannel()
			: new MessageChannel();
		await client.connect(channel.port1);
		workletNode.port.postMessage(
			{ type: "connect", port: channel.port2 },
			[channel.port2],
		);

		connectInputTrack(inputAudioTrack);
		processedAudioTrack = destinationNode.stream.getAudioTracks()[0];
		processedAudioTrack.enabled = inputAudioTrack.enabled;
		outputStream = new MediaStream([
			...inputStream.getVideoTracks(),
			processedAudioTrack,
		]);
		inputStream.addEventListener("trackchanged", onTrackChanged);
		listeningForTrackChanges = true;

		if (audioContext.state === "suspended") await audioContext.resume();
		if (audioContext.state !== "running") {
			throw new Error(
				"The AudioContext could not start. Resume it from a user interaction before starting WebRTC.",
			);
		}

		return {
			stream: outputStream,
			audioTrack: processedAudioTrack,
			context: audioContext,
			node: workletNode,
			close: cleanup,
		};
	} catch (error) {
		await cleanup();
		throw error;
	}
}
