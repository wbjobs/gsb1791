/**
 * Draft persistence on IndexedDB, with an injectable backend so the same
 * code runs in the browser (real IDB) and in tests (in-memory shim).
 *
 * Snapshots are plain JSON: { v, value, context, history, validation, updatedAt }.
 */

export function createMemoryBackend() {
  const map = new Map();
  return {
    async get(key) { return map.get(key) ?? null; },
    async set(key, value) { map.set(key, structuredClone(value)); },
    async delete(key) { map.delete(key); },
    async keys() { return [...map.keys()]; },
  };
}

export function createIdbBackend(dbName = 'form-drafts', store = 'drafts') {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const out = fn(s);
        t.oncomplete = () => resolve(out?.result ?? out);
        t.onerror = () => reject(t.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    get: (key) => tx('readonly', (s) => s.get(key)).then((r) => r ?? null),
    set: (key, value) => tx('readwrite', (s) => s.put(value, key)).then(() => undefined),
    delete: (key) => tx('readwrite', (s) => s.delete(key)).then(() => undefined),
    keys: () => tx('readonly', (s) => s.getAllKeys()),
  };
}

export function createDraftStore(backend) {
  const store = backend ?? (typeof indexedDB !== 'undefined' ? createIdbBackend() : createMemoryBackend());
  return {
    load: (draftId) => store.get(`draft:${draftId}`),
    save: (draftId, snapshot) => store.set(`draft:${draftId}`, { ...snapshot, updatedAt: Date.now() }),
    remove: (draftId) => store.delete(`draft:${draftId}`),
    list: () => store.keys(),
  };
}
