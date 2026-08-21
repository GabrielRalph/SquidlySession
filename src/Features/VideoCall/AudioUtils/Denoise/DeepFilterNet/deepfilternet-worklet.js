const DFN_FRAME_SIZE = 480;

const MAX_PENDING_FRAMES = 8;

/** Buffers Web Audio quanta around one asynchronous DeepFilterNet Worker. */
class DeepFilterNetWorkletBridge {
	constructor(
		sendFrame = null,
		onError = () => {},
		{ onDiagnostics = null, diagnosticsEveryFrames = 0 } = {},
	) {
		this.sendFrame = sendFrame;
		this.onError = onError;
		this.onDiagnostics =
			typeof onDiagnostics === "function" ? onDiagnostics : null;
		this.diagnosticsEveryFrames =
			Number.isInteger(diagnosticsEveryFrames) && diagnosticsEveryFrames > 0
				? diagnosticsEveryFrames
				: 0;
		this.inputFrame = new Float32Array(DFN_FRAME_SIZE);
		this.inputLength = 0;
		this.inFlight = false;
		this.failed = false;
		this.pendingFrames = [];
		this.outputFrames = [];
		this.outputOffset = 0;
		this.framesProcessed = 0;
		this.lastInferenceMs = null;
		this.maxPendingFrames = 0;
		this.droppedFrames = 0;
		this.underflowQuanta = 0;
	}

	connect(port) {
		this.workerPort = port;
		this.sendFrame = (frame) => {
			const samples = frame.buffer;
			port.postMessage({ type: "process", samples }, [samples]);
		};
		port.onmessage = ({ data }) => {
			if (data?.type === "processed") {
				this.receiveProcessedFrame(
					new Float32Array(data.samples),
					data.inferenceMs,
				);
			} else if (data?.type === "error") {
				this.failed = true;
				this.inFlight = false;
				this.pendingFrames.length = 0;
				this.onError(data.message);
			}
		};
		port.start?.();
		this._sendNextFrame();
	}

	close() {
		this.failed = true;
		this.inFlight = false;
		this.pendingFrames.length = 0;
		this.outputFrames.length = 0;
		this.workerPort?.close?.();
		this.workerPort = null;
	}

	process(inputChannels, outputChannel) {
		this._writeOutput(outputChannel);
		this._readInput(inputChannels);
	}

	receiveProcessedFrame(frame, inferenceMs = null) {
		if (!(frame instanceof Float32Array) || frame.length !== DFN_FRAME_SIZE) {
			throw new RangeError("Invalid DeepFilterNet output frame length.");
		}
		this.outputFrames.push(frame);
		this.framesProcessed += 1;
		this.lastInferenceMs = Number.isFinite(inferenceMs) ? inferenceMs : null;
		this.inFlight = false;
		this._sendNextFrame();
		this._emitDiagnostics();
	}

	_readInput(inputChannels) {
		const sampleCount = inputChannels[0]?.length || 0;
		for (let index = 0; index < sampleCount; index += 1) {
			let monoSample = 0;
			for (const channel of inputChannels) {
				monoSample += channel[index];
			}
			this.inputFrame[this.inputLength] =
				monoSample / inputChannels.length;
			this.inputLength += 1;

			if (this.inputLength === DFN_FRAME_SIZE) {
				this._queueInputFrame(this.inputFrame);
				this.inputFrame = new Float32Array(DFN_FRAME_SIZE);
				this.inputLength = 0;
			}
		}
	}

	_queueInputFrame(frame) {
		if (this.failed) return;
		if (!this.inFlight && this.sendFrame) {
			this.inFlight = true;
			this.sendFrame(frame);
			return;
		}
		if (this.pendingFrames.length === MAX_PENDING_FRAMES) {
			this.pendingFrames.shift();
			this.droppedFrames += 1;
		}
		this.pendingFrames.push(frame);
		this.maxPendingFrames = Math.max(
			this.maxPendingFrames,
			this.pendingFrames.length,
		);
	}

	_sendNextFrame() {
		if (this.failed || this.inFlight || !this.sendFrame) return;
		const frame = this.pendingFrames.shift();
		if (!frame) return;
		this.inFlight = true;
		this.sendFrame(frame);
	}

	_writeOutput(outputChannel) {
		outputChannel.fill(0);
		let writeOffset = 0;
		while (writeOffset < outputChannel.length && this.outputFrames.length) {
			const frame = this.outputFrames[0];
			const available = frame.length - this.outputOffset;
			const copyLength = Math.min(
				available,
				outputChannel.length - writeOffset,
			);
			outputChannel.set(
				frame.subarray(this.outputOffset, this.outputOffset + copyLength),
				writeOffset,
			);
			writeOffset += copyLength;
			this.outputOffset += copyLength;
			if (this.outputOffset === frame.length) {
				this.outputFrames.shift();
				this.outputOffset = 0;
			}
		}
		if (writeOffset < outputChannel.length) this.underflowQuanta += 1;
	}

	_emitDiagnostics() {
		if (
			!this.onDiagnostics ||
			!this.diagnosticsEveryFrames ||
			this.framesProcessed % this.diagnosticsEveryFrames !== 0
		) {
			return;
		}
		this.onDiagnostics({
			framesProcessed: this.framesProcessed,
			inferenceMs: this.lastInferenceMs,
			pendingFrames: this.pendingFrames.length,
			outputFrames: this.outputFrames.length,
			maxPendingFrames: this.maxPendingFrames,
			droppedFrames: this.droppedFrames,
			underflowQuanta: this.underflowQuanta,
		});
	}
}

class DeepFilterNetWorkletProcessor extends AudioWorkletProcessor {
	constructor({ processorOptions = {} } = {}) {
		super();
		this.bridge = new DeepFilterNetWorkletBridge(null, (message) => {
			this.port.postMessage({ type: "error", message });
		}, {
			diagnosticsEveryFrames: processorOptions.diagnosticsEveryFrames,
			onDiagnostics: (metrics) => {
				this.port.postMessage({ type: "diagnostics", metrics });
			},
		});
		this.port.onmessage = ({ data }) => {
			if (data?.type === "connect" && data.port) {
				this.bridge.connect(data.port);
			} else if (data?.type === "close") {
				this.bridge.close();
			}
		};
	}

	process(inputs, outputs) {
		const output = outputs[0]?.[0];
		if (output) this.bridge.process(inputs[0] || [], output);
		return true;
	}
}

registerProcessor(
	"DeepFilterNetWorkletProcessor",
	DeepFilterNetWorkletProcessor,
);
