import { validateFields } from '../form/validationRules.js';

const controllers = new Map();

self.onmessage = async (message) => {
  const data = message.data;
  if (data?.type === 'VALIDATE') {
    const controller = new AbortController();
    controllers.set(data.requestId, controller);
    try {
      const errors = await validateFields(data.fields, data.values, {
        signal: controller.signal,
        slow: data.slow === true
      });
      self.postMessage({
        type: 'VALIDATION_RESULT',
        requestId: data.requestId,
        errors,
        signature: data.signature
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        self.postMessage({ type: 'VALIDATION_ABORTED', requestId: data.requestId });
      } else {
        self.postMessage({
          type: 'VALIDATION_FAILED',
          requestId: data.requestId,
          message: error.message
        });
      }
    } finally {
      controllers.delete(data.requestId);
    }
  }

  if (data?.type === 'ABORT_VALIDATION' && controllers.has(data.requestId)) {
    controllers.get(data.requestId).abort();
  }
};
