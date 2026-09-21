export class WorkerValidationClient {
  constructor(workerUrl) {
    this.worker = new Worker(workerUrl, { type: 'module' });
    this.pending = new Map();
    this.worker.onmessage = (message) => this.handleMessage(message.data);
  }

  validate({ requestId, fields, values, slow = false, signature }) {
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({
        type: 'VALIDATE',
        requestId,
        fields,
        values,
        slow,
        signature
      });
    });
  }

  abort(requestId) {
    if (!this.pending.has(requestId)) return;
    this.worker.postMessage({ type: 'ABORT_VALIDATION', requestId });
  }

  terminate() {
    this.worker.terminate();
    this.pending.clear();
  }

  handleMessage(message) {
    const request = this.pending.get(message.requestId);
    if (!request) return;
    this.pending.delete(message.requestId);

    if (message.type === 'VALIDATION_RESULT') {
      request.resolve(message);
    } else if (message.type === 'VALIDATION_ABORTED') {
      request.reject(Object.assign(new Error('Validation aborted'), { name: 'AbortError' }));
    } else {
      request.reject(Object.assign(
        new Error(message.message ?? 'Worker validation failed'),
        { name: 'ValidationWorkerError' }
      ));
    }
  }
}
