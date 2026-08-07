const DFN_FRAME_SIZE = 480;

const MAX_PENDING_FRAMES = 8;

/** Buffers Web Audio quanta around one asynchronous DeepFilterNet Worker. */
class DeepFilterNetWorkletBridge {
	constructor(sendFrame = null, onError = () => {}) {
		this.sendFrame = sendFrame;
		this.onError = onError;
		this.inputFrame = new Float32Array(DFN_FRAME_SIZE);
		this.inputLength = 0;
		this.inFlight = false;
		this.failed = false;
		this.pendingFrames = [];
		this.outputFrames = [];
		this.outputOffset = 0;
	}

	connect(port) {
		this.workerPort = port;
		this.sendFrame = (frame) => {
			const samples = frame.buffer;
			port.postMessage({ type: "process", samples }, [samples]);
		};
		port.onmessage = ({ data }) => {
			if (data?.type === "processed") {
				this.receiveProcessedFrame(new Float32Array(data.samples));
			} else if (data?.type === "error") {
				this.failed = true;
				this.inFlight = false;
				this.pendingFrames.length = 0;
				this.onError(data.message);
			}
		};
		port.start?.();
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

	receiveProcessedFrame(frame) {
		if (!(frame instanceof Float32Array) || frame.length !== DFN_FRAME_SIZE) {
			throw new RangeError("Invalid DeepFilterNet output frame length.");
		}
		this.outputFrames.push(frame);
		this.inFlight = false;
		this._sendNextFrame();
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
		}
		this.pendingFrames.push(frame);
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
	}
}

class DeepFilterNetWorkletProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.bridge = new DeepFilterNetWorkletBridge(null, (message) => {
			this.port.postMessage({ type: "error", message });
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
