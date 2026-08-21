import { DeepFilterNetWorkletBridge } from "./deepfilternet-worklet-core.js";

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
