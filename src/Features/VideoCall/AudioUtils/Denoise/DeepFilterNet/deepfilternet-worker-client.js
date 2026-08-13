/** Page-side request client for one DeepFilterNet Worker. */
export class DeepFilterNetWorkerClient {
	constructor(worker) {
		this.worker = worker;
		this.nextId = 1;
		this.pending = new Map();
		this.closed = false;
		this.fatalError = null;
		this.fatalErrorHandler = null;
		worker.onmessage = ({ data }) => this._handleResponse(data);
		worker.onerror = ({ message }) =>
			this._handleFatalError(
				new Error(message || "DeepFilterNet worker failed."),
			);
		worker.onmessageerror = () =>
			this._handleFatalError(
				new Error("DeepFilterNet worker message could not be decoded."),
			);
	}

	setFatalErrorHandler(handler) {
		this.fatalErrorHandler = handler;
		if (this.fatalError) handler(this.fatalError);
	}

	initialize(modelUrl, wasmUrl) {
		return this._request({ type: "initialize", modelUrl, wasmUrl });
	}

	connect(port) {
		return this._request({ type: "connect", port }, [port]);
	}

	close() {
		if (this.closed) return;
		this.closed = true;
		this.worker.terminate();
		this._rejectAll(new Error("DeepFilterNet worker was closed."));
	}

	_request(message, transfer = []) {
		if (this.closed) {
			return Promise.reject(new Error("DeepFilterNet worker was closed."));
		}
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.worker.postMessage({ ...message, id }, transfer);
		});
	}

	_handleResponse(response) {
		const pending = this.pending.get(response.id);
		if (!pending) return;
		this.pending.delete(response.id);
		if (response.type === "error") {
			pending.reject(new Error(response.message));
		} else {
			pending.resolve();
		}
	}

	_rejectAll(error) {
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}

	_handleFatalError(error) {
		if (this.fatalError) return;
		this.fatalError = error;
		this._rejectAll(error);
		this.fatalErrorHandler?.(error);
	}
}

export function createDeepFilterNetWorkerClient(worker) {
	return new DeepFilterNetWorkerClient(worker);
}
