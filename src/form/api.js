export function submitApplication(submission, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve({
        reference: `APP-${Date.now().toString(36).toUpperCase()}`,
        submittedAt: new Date().toISOString(),
        submission
      });
    }, 900);

    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Submit aborted', 'AbortError'));
    }, { once: true });
  });
}
