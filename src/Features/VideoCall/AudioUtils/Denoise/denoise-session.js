import { createDenoiseGraph } from "./denoise-graph.js";

function makeTrackChangedEvent(oldTrack, newTrack) {
	const event = new Event("trackchanged");
	event.oldTrack = oldTrack;
	event.newTrack = newTrack;
	return event;
}

/**
 * Creates a stable WebRTC stream using a denoiser's realtime capability.
 *
 * A denoiser declares `id`, `sampleRate`, and `channelCount`. Realtime support
 * is enabled by `realtime.attachStream` (package-owned graph) or
 * `realtime.createProcessor({ context, onError })` (host-owned graph).
 * createProcessor returns `{ node, close? }`; the session owns the surrounding
 * graph, stream/device changes, runtime failure cleanup, and AudioContext.
 *
 * @param {MediaStream} inputStream
 * @param {object} options
 * @param {object} options.denoiser
 * @param {AudioContext|null} [options.context]
 * @param {function(Error): void|null} [options.onError]
 */
export async function createRealtimeDenoiseSession(
	inputStream,
	{ denoiser, context = null, onError = null } = {},
) {
	if (!(inputStream instanceof MediaStream)) {
		throw new TypeError("inputStream must be a MediaStream.");
	}
	if (
		!denoiser?.realtime?.attachStream &&
		!denoiser?.realtime?.createProcessor
	) {
		throw new Error(
			`${denoiser?.id || "The denoiser"} does not support realtime denoising.`,
		);
	}

	const inputAudioTrack = inputStream.getAudioTracks()[0];
	if (!inputAudioTrack) {
		throw new Error("inputStream must contain an audio track.");
	}

	const AudioContextClass =
		globalThis.AudioContext || globalThis.webkitAudioContext;
	if (!context && !AudioContextClass) {
		throw new Error("Web Audio is not supported by this browser.");
	}
	const ownsAudioContext = !context;
	const audioContext =
		context || new AudioContextClass({ sampleRate: denoiser.sampleRate });
	if (audioContext.sampleRate !== denoiser.sampleRate) {
		if (ownsAudioContext && audioContext.state !== "closed") {
			await audioContext.close();
		}
		throw new RangeError(
			`${denoiser.id} requires a ${denoiser.sampleRate / 1000} kHz AudioContext.`,
		);
	}

	if (denoiser.realtime.attachStream) {
		let attached = null;
		let outputTrack = null;
		let outputStream = null;
		let listeningForTrackChanges = false;
		let cleanupPromise = null;
		let remounting = false;

		const close = () => {
			if (!cleanupPromise) {
				cleanupPromise = (async () => {
					if (listeningForTrackChanges) {
						inputStream.removeEventListener("trackchanged", onTrackChanged);
					}
					await attached?.close?.();
					if (ownsAudioContext && audioContext.state !== "closed") {
						await audioContext.close();
					}
				})();
			}
			return cleanupPromise;
		};

		const reportRuntimeError = (error) => {
			const runtimeError =
				error instanceof Error
					? error
					: new Error(`${denoiser.id} runtime failed.`);
			void close().then(
				() => onError?.(runtimeError),
				() => onError?.(runtimeError),
			);
		};

		const applyAttached = (next, sourceAudioTrack) => {
			const audioTrack = next.audioTrack;
			if (!audioTrack) {
				throw new Error("The denoiser did not produce an audio track.");
			}
			audioTrack.enabled = sourceAudioTrack.enabled;
			attached = next;
			outputTrack = audioTrack;
			return audioTrack;
		};

		const onTrackChanged = ({ oldTrack, newTrack }) => {
			if (!oldTrack || !newTrack || oldTrack.kind !== newTrack.kind) return;

			if (newTrack.kind === "video") {
				if (outputStream.getTracks().includes(oldTrack)) {
					outputStream.removeTrack(oldTrack);
				}
				outputStream.addTrack(newTrack);
				outputStream.dispatchEvent(makeTrackChangedEvent(oldTrack, newTrack));
				return;
			}

			if (remounting || cleanupPromise) return;
			remounting = true;
			void (async () => {
				try {
					const previous = attached;
					const previousTrack = outputTrack;
					await previous?.close?.();
					const next = await denoiser.realtime.attachStream(inputStream, {
						onError: reportRuntimeError,
						audioContext,
					});
					applyAttached(next, newTrack);
					if (outputStream.getTracks().includes(previousTrack)) {
						outputStream.removeTrack(previousTrack);
					}
					outputStream.addTrack(outputTrack);
					outputStream.dispatchEvent(
						makeTrackChangedEvent(previousTrack, outputTrack),
					);
				} catch (error) {
					reportRuntimeError(error);
				} finally {
					remounting = false;
				}
			})();
		};

		try {
			const first = await denoiser.realtime.attachStream(inputStream, {
				onError: reportRuntimeError,
				audioContext,
			});
			applyAttached(first, inputAudioTrack);
			const videoTracks = inputStream.getVideoTracks();
			const attachedVideos = first.stream.getVideoTracks?.() ?? [];
			outputStream =
				attachedVideos.length > 0 || videoTracks.length === 0
					? first.stream
					: new MediaStream([...videoTracks, outputTrack]);
			inputStream.addEventListener("trackchanged", onTrackChanged);
			listeningForTrackChanges = true;
			if (audioContext.state === "suspended") await audioContext.resume();
			return {
				stream: outputStream,
				get audioTrack() {
					return outputTrack;
				},
				context: audioContext,
				node: null,
				close,
			};
		} catch (error) {
			await close();
			throw error;
		}
	}

	let destination = null;
	let graph = null;
	let outputTrack = null;
	let outputStream = null;
	let listeningForTrackChanges = false;
	let cleanupPromise = null;
	let runtimeErrorReported = false;

	const close = () => {
		if (!cleanupPromise) {
			cleanupPromise = (async () => {
				if (listeningForTrackChanges) {
					inputStream.removeEventListener("trackchanged", onTrackChanged);
				}
				await graph?.close();
				destination?.disconnect();
				outputTrack?.stop();
				if (audioContext.state !== "closed") await audioContext.close();
			})();
		}
		return cleanupPromise;
	};

	const reportRuntimeError = (error) => {
		if (runtimeErrorReported) return;
		runtimeErrorReported = true;
		const runtimeError =
			error instanceof Error ? error : new Error(`${denoiser.id} runtime failed.`);
		void close().then(
			() => onError?.(runtimeError),
			() => onError?.(runtimeError),
		);
	};

	const connectInputTrack = (track) => {
		const source = audioContext.createMediaStreamSource(new MediaStream([track]));
		graph.connectSource(source);
	};

	const onTrackChanged = ({ oldTrack, newTrack }) => {
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

	try {
		destination = audioContext.createMediaStreamDestination();
		destination.channelCount = denoiser.channelCount;
		destination.channelCountMode = "explicit";
		graph = await createDenoiseGraph({
			context: audioContext,
			destination,
			createProcessor: denoiser.realtime.createProcessor,
			onError: reportRuntimeError,
		});
		connectInputTrack(inputAudioTrack);

		outputTrack = destination.stream.getAudioTracks()[0];
		if (!outputTrack) {
			throw new Error("The denoiser did not produce an audio track.");
		}
		outputTrack.enabled = inputAudioTrack.enabled;
		outputStream = new MediaStream([
			...inputStream.getVideoTracks(),
			outputTrack,
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
			audioTrack: outputTrack,
			context: audioContext,
			node: graph.node,
			close,
		};
	} catch (error) {
		await close();
		throw error;
	}
}
