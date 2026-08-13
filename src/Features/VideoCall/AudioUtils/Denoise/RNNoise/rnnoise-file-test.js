import { renderOfflineDenoise } from "../denoise-offline.js";
import { createRnnoiseDenoiser } from "./rnnoise.js";
import { encodeWav } from "./rnnoise-wav.js";

const form = document.querySelector("#file-test-form");
const fileInput = document.querySelector("#audio-file");
const status = document.querySelector("#status");
const originalAudio = document.querySelector("#original-audio");
const processedAudio = document.querySelector("#processed-audio");
const downloadOutput = document.querySelector("#download-output");

let originalUrl = null;
let processedUrl = null;
const TEST_SAMPLE_RATE = 48000;

/**
 * Replaces a browser object URL and revokes the previous URL to avoid leaks.
 *
 * @param {string|null} currentUrl - URL previously assigned to an output element.
 * @param {Blob|File} value - Binary value exposed through the replacement URL.
 * @returns {string} The newly created object URL.
 */
function replaceObjectUrl(currentUrl, value) {
	if (currentUrl) URL.revokeObjectURL(currentUrl);
	return URL.createObjectURL(value);
}

/**
 * Decodes, processes, and renders the audio file selected in the test page.
 *
 * @param {SubmitEvent} event - File-test form submission.
 * @returns {Promise<void>}
 */
async function processSelectedFile(event) {
	// Step 1: Keep the form on this page and read the file selected by the user.
	event.preventDefault();
	const file = fileInput.files[0];
	if (!file) return;

	// Step 2: Reset the result UI while the new file is being processed.
	status.dataset.error = "false";
	status.textContent = "Decoding audio…";
	downloadOutput.hidden = true;

	// Step 3: Create a 48 kHz decoding context. decodeAudioData resamples supported
	// input formats to this rate, which is the rate expected by the RNNoise path.
	const context = new AudioContext({ sampleRate: TEST_SAMPLE_RATE });
	try {
		// Step 4: Read the compressed file bytes and decode them into an AudioBuffer.
		// The AudioBuffer exposes one Float32Array of PCM samples per input channel.
		const decoded = await context.decodeAudioData(await file.arrayBuffer());

		// Step 5: Time only the denoising render, not file decoding or WAV export.
		const startedAt = performance.now();

		// Step 6: Downmix the decoded channels to mono and render them through the
		// same RNNoise AudioWorklet used by the live WebRTC stream. The helper returns
		// one Float32Array containing the denoised mono PCM samples.
		const denoisedMono = await renderOfflineDenoise(decoded, {
			denoiser: createRnnoiseDenoiser(),
		});
		const processingTime = performance.now() - startedAt;

		// Step 7: The WAV encoder accepts an array of channels, so wrap the mono
		// samples as one channel and convert the Float32 PCM into a PCM16 WAV file.
		const outputChannels = [denoisedMono];
		const wav = encodeWav(outputChannels, decoded.sampleRate);
		const outputBlob = new Blob([wav], { type: "audio/wav" });

		// Step 8: Expose the original file and processed WAV as temporary browser
		// URLs, then attach them to the two audio players for comparison.
		originalUrl = replaceObjectUrl(originalUrl, file);
		processedUrl = replaceObjectUrl(processedUrl, outputBlob);
		originalAudio.src = originalUrl;
		processedAudio.src = processedUrl;

		// Step 9: Reuse the processed URL for a downloadable WAV result.
		downloadOutput.href = processedUrl;
		downloadOutput.download = `${file.name.replace(/\.[^.]+$/, "")}-processed.wav`;
		downloadOutput.hidden = false;

		// Step 10: Compare processing time with audio duration. A factor below 1
		// means the denoising completed faster than real-time playback.
		const realTimeFactor = processingTime / 1000 / decoded.duration;
		status.textContent = [
			`${decoded.sampleRate} Hz`,
			`${decoded.numberOfChannels} input channel${decoded.numberOfChannels === 1 ? "" : "s"} → mono output`,
			`${decoded.duration.toFixed(2)} s`,
			`${processingTime.toFixed(1)} ms processing`,
			`${realTimeFactor.toFixed(3)}× real-time`,
		].join(" · ");
	} catch (error) {
		// Report decoding, worklet, or encoding failures on the test page.
		status.dataset.error = "true";
		status.textContent = `Could not process this file: ${error.message}`;
	} finally {
		// Release the decoding context even when one of the processing steps fails.
		await context.close();
	}
}

// Start the complete processing pipeline when the user submits the file form.
form.addEventListener("submit", processSelectedFile);
