const DB_NAME = 'branching-form-db';
const DB_VERSION = 1;
const STORE = 'drafts';
const POINTER_KEY = 'branching-form.current-draft-id';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'draftId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class DraftStore {
  constructor(storage = localStorage) {
    this.storage = storage;
    this.databasePromise = openDatabase();
  }

  async save(snapshot) {
    const database = await this.databasePromise;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(snapshot);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    this.storage.setItem(POINTER_KEY, snapshot.draftId);
    return snapshot.draftId;
  }

  async load(draftId = this.storage.getItem(POINTER_KEY)) {
    if (!draftId) return null;
    const database = await this.databasePromise;
    const transaction = database.transaction(STORE, 'readonly');
    return requestToPromise(transaction.objectStore(STORE).get(draftId));
  }

  async loadMostRecent() {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).getAll();
    const drafts = await requestToPromise(request);
    return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
  }

  async remove(draftId) {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(draftId);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    if (this.storage.getItem(POINTER_KEY) === draftId) {
      this.storage.removeItem(POINTER_KEY);
    }
  }
}
