/**
 * Validates planar audio channels and returns their shared frame length.
 *
 * @param {Float32Array[]} channels - One sample array per audio channel.
 * @returns {number} The number of samples in each channel.
 * @throws {TypeError} If channels is empty or does not contain typed arrays.
 * @throws {RangeError} If the channel lengths differ.
 */
function validateChannels(channels) {
	if (!Array.isArray(channels) || channels.length === 0) {
		throw new TypeError("Audio channels must be a non-empty array.");
	}

	const frameLength = channels[0]?.length;
	if (!Number.isInteger(frameLength)) {
		throw new TypeError("Audio channels must contain typed arrays.");
	}

	if (channels.some((channel) => channel.length !== frameLength)) {
		throw new RangeError("Audio channels must have the same length.");
	}

	return frameLength;
}

/**
 * Stateful algorithm contract shared by the live worklet and offline file test.
 *
 * The default implementation passes audio through unchanged. Replace the body of
 * process() with a denoiser while preserving this planar Float32 interface.
 */
export class NoiseSuppressor {
	/**
	 * Creates a suppressor for a fixed audio format.
	 *
	 * @param {object} [options] - Audio format configuration.
	 * @param {number} [options.sampleRate=48000] - Samples per second.
	 * @param {number} [options.channelCount=1] - Number of planar channels.
	 * @throws {RangeError} If either format value is invalid.
	 */
	constructor({ sampleRate = 48000, channelCount = 1 } = {}) {
		if (!(sampleRate > 0)) {
			throw new RangeError("sampleRate must be greater than zero.");
		}
		if (!Number.isInteger(channelCount) || channelCount < 1) {
			throw new RangeError("channelCount must be a positive integer.");
		}

		this.sampleRate = sampleRate;
		this.channelCount = channelCount;
	}

	/**
	 * Processes one block of non-interleaved floating-point PCM audio.
	 *
	 * @param {Float32Array[]} inputChannels - Read-only input channel blocks.
	 * @param {Float32Array[]} outputChannels - Writable output channel blocks.
	 * @returns {void}
	 */
	process(inputChannels, outputChannels) {
		// AudioWorklet exposes one Float32Array per channel. Retaining that shape
		// lets the exact same algorithm run in the render thread and file tests.
		for (let channelIndex = 0; channelIndex < outputChannels.length; channelIndex++) {
			const output = outputChannels[channelIndex];
			const input = inputChannels[channelIndex];
			output.fill(0);
			if (input) {
				output.set(input.subarray(0, output.length));
			}
		}
	}

	/**
	 * Clears algorithm history before processing unrelated audio.
	 *
	 * Stateful algorithms should reset filter and noise-profile state here.
	 * @returns {void}
	 */
	reset() {}
}

/**
 * Processes complete channel buffers in worklet-sized blocks.
 *
 * @param {Float32Array[]} inputChannels - Full planar input audio.
 * @param {object} [options] - Offline processing options.
 * @param {number} [options.sampleRate=48000] - Samples per second.
 * @param {number} [options.blockSize=128] - Samples passed to each process call.
 * @param {NoiseSuppressor|null} [options.suppressor=null] - Processor instance to reuse.
 * @returns {Float32Array[]} Newly allocated processed channel buffers.
 * @throws {TypeError} If inputChannels is invalid.
 * @throws {RangeError} If channel lengths differ or blockSize is invalid.
 */
export function processAudioChannels(
	inputChannels,
	{
		sampleRate = 48000,
		blockSize = 128,
		suppressor = null,
	} = {},
) {
	const frameLength = validateChannels(inputChannels);
	if (!Number.isInteger(blockSize) || blockSize < 1) {
		throw new RangeError("blockSize must be a positive integer.");
	}

	// A single instance spans all blocks so a real denoiser can preserve filter,
	// noise-profile, and fixed-frame buffering state between calls.
	const processor =
		suppressor ||
		new NoiseSuppressor({
			sampleRate,
			channelCount: inputChannels.length,
		});
	const outputChannels = inputChannels.map(
		() => new Float32Array(frameLength),
	);

	for (let offset = 0; offset < frameLength; offset += blockSize) {
		const end = Math.min(offset + blockSize, frameLength);
		// subarray creates zero-copy views. The final block can be shorter than
		// blockSize, so fixed-frame algorithms should buffer that tail internally.
		const inputs = inputChannels.map((channel) => channel.subarray(offset, end));
		const outputs = outputChannels.map((channel) => channel.subarray(offset, end));
		processor.process(inputs, outputs);
	}

	return outputChannels;
}
