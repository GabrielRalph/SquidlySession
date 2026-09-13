/**
 * Writes ASCII text into a binary view.
 *
 * @param {DataView} view - Destination WAV data.
 * @param {number} offset - Starting byte offset.
 * @param {string} value - ASCII text to write.
 * @returns {void}
 */
function writeText(view, offset, value) {
	for (let index = 0; index < value.length; index++) {
		view.setUint8(offset + index, value.charCodeAt(index));
	}
}

/**
 * Encodes planar floating-point PCM as an interleaved 16-bit WAV file.
 *
 * @param {Float32Array[]} channels - Audio samples nominally in the range -1 to 1.
 * @param {number} sampleRate - Samples per second.
 * @returns {ArrayBuffer} A browser-playable PCM WAV file.
 * @throws {TypeError} If no channels are supplied.
 * @throws {RangeError} If channel lengths differ or sampleRate is invalid.
 */
export function encodeWav(channels, sampleRate) {
	if (!Array.isArray(channels) || channels.length === 0) {
		throw new TypeError("Audio channels must be a non-empty array.");
	}
	if (!(sampleRate > 0)) {
		throw new RangeError("sampleRate must be greater than zero.");
	}

	const frameLength = channels[0].length;
	if (channels.some((channel) => channel.length !== frameLength)) {
		throw new RangeError("Audio channels must have the same length.");
	}

	const channelCount = channels.length;
	const bytesPerSample = 2;
	const dataLength = frameLength * channelCount * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataLength);
	const view = new DataView(buffer);

	// Standard PCM WAV uses a 44-byte RIFF/WAVE header followed by sample data.
	writeText(view, 0, "RIFF");
	view.setUint32(4, 36 + dataLength, true);
	writeText(view, 8, "WAVE");
	writeText(view, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channelCount, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
	view.setUint16(32, channelCount * bytesPerSample, true);
	view.setUint16(34, bytesPerSample * 8, true);
	writeText(view, 36, "data");
	view.setUint32(40, dataLength, true);

	let byteOffset = 44;
	for (let frameIndex = 0; frameIndex < frameLength; frameIndex++) {
		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			// Interleave channels and clamp algorithm output before converting to int16.
			const sample = Math.max(-1, Math.min(1, channels[channelIndex][frameIndex]));
			const pcmSample = sample < 0 ? sample * 32768 : sample * 32767;
			view.setInt16(byteOffset, Math.round(pcmSample), true);
			byteOffset += bytesPerSample;
		}
	}

	return buffer;
}
