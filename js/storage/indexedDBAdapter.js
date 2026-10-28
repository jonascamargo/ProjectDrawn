// Adaptador de armazenamento sobre IndexedDB.
//
// Interface de adaptador (para trocar por nuvem/contas no futuro):
//   get(store, key) · getAll(store) · getAllByIndex(store, index, value)
//   put(store, value, key?) · delete(store, key)
//
// Stores:
//   projects    { id, ...registro }               (keyPath: id)
//   snapshots   { key, projectId, createdAt, ... } (autoIncrement, índice projectId)
//   handles     FileSystemFileHandle por projectId
//   thumbnails  dataURL por projectId
//   libraries   { id, kind, name, ...registro }    (keyPath: id) — bibliotecas do usuário

const DB_NAME = 'projectdrawn';
const DB_VERSION = 2;
const LEGACY_DB_NAME = 'codedrawn';
const LEGACY_DB_VERSION = 1;
const STORES = ['projects', 'snapshots', 'handles', 'thumbnails'];

function openDatabase(name, version, { create }) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!create) {
        // Banco antigo inexistente: cancela para não criá-lo vazio.
        event.target.transaction.abort();
        return;
      }
      const has = (store) => db.objectStoreNames.contains(store);
      if (!has('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!has('snapshots')) {
        const snapshots = db.createObjectStore('snapshots', { keyPath: 'key', autoIncrement: true });
        snapshots.createIndex('projectId', 'projectId');
      }
      if (!has('handles')) db.createObjectStore('handles');
      if (!has('thumbnails')) db.createObjectStore('thumbnails');
      if (!has('libraries')) db.createObjectStore('libraries', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => (create ? reject(request.error) : resolve(null));
  });
}

function readAll(db, store) {
  return new Promise((resolve, reject) => {
    const s = db.transaction(store, 'readonly').objectStore(store);
    const keys = s.getAllKeys();
    const values = s.getAll();
    values.onsuccess = () => resolve(values.result.map((value, i) => ({ key: keys.result[i], value })));
    values.onerror = () => reject(values.error);
  });
}

export class IndexedDBAdapter {
  #db = null;

  async open() {
    if (this.#db) return this.#db;
    this.#db = await openDatabase(DB_NAME, DB_VERSION, { create: true });
    await this.#importLegacy();
    return this.#db;
  }

  // Copia uma vez os dados do banco do nome antigo do app (CodeDrawn), se existir.
  async #importLegacy() {
    const db = this.#db;
    const hasData = await new Promise((resolve) => {
      const req = db.transaction('projects', 'readonly').objectStore('projects').count();
      req.onsuccess = () => resolve(req.result > 0);
      req.onerror = () => resolve(true);
    });
    if (hasData) return;
    const legacy = await openDatabase(LEGACY_DB_NAME, LEGACY_DB_VERSION, { create: false }).catch(() => null);
    if (!legacy) return;
    try {
      for (const store of STORES) {
        if (!legacy.objectStoreNames.contains(store)) continue;
        const rows = await readAll(legacy, store);
        await new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readwrite');
          const s = tx.objectStore(store);
          for (const { key, value } of rows) (s.keyPath ? s.put(value) : s.put(value, key));
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      }
    } finally {
      legacy.close();
    }
  }

  async #run(storeName, mode, operation) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = operation(tx.objectStore(storeName));
      let result;
      if (request) request.onsuccess = () => (result = request.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  get(store, key) {
    return this.#run(store, 'readonly', (s) => s.get(key));
  }

  getAll(store) {
    return this.#run(store, 'readonly', (s) => s.getAll());
  }

  getAllByIndex(store, index, value) {
    return this.#run(store, 'readonly', (s) => s.index(index).getAll(value));
  }

  put(store, value, key) {
    return this.#run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
  }

  delete(store, key) {
    return this.#run(store, 'readwrite', (s) => s.delete(key));
  }
}
