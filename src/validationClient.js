/**
 * Main-thread client for the validation worker.
 * Falls back to inline dynamic import when Worker is unavailable (tests/SSR).
 */
export function createValidationClient(workerUrl) {
  let worker = null;
  let counter = 0;
  const pending = new Map(); // id -> resolve

  if (typeof Worker !== 'undefined' && workerUrl) {
    worker = new Worker(workerUrl, { type: 'module' });
    worker.onmessage = (e) => {
      const { id, error } = e.data;
      const resolve = pending.get(id);
      if (resolve) {
        pending.delete(id);
        resolve(error);
      }
    };
  }

  return async function runValidation(field, value, data) {
    if (worker) {
      const id = ++counter;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        worker.postMessage({ id, field, value, data });
      });
    }
    // Fallback: run the same validators inline (dynamic import keeps the
    // worker file the single source of truth).
    const mod = await import('./worker/validationWorker.inline.js');
    return mod.validate(field, value, data);
  };
}
