// Salvar o projeto no navegador: converter cena + câmera em dados simples, e um armazenamento
// (IndexedDB; sem ele, só na memória). Por enquanto um projeto só, na chave 'current'.
export const FORMAT_VERSION = 1;

export function serialize(scene, camera) {
  return {
    version: FORMAT_VERSION,
    camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
    nextId: scene.nextId,
    nodes: scene.elements.map((n) => {
      const base = { id: n.id, type: n.type, x: n.x, y: n.y, scope: n.scope };
      if (n.reroute) {
        const pin = (p) => ({ kind: p.kind, type: p.type });
        return { ...base, reroute: { input: pin(n.inputs[0]), output: pin(n.outputs[0]) } };
      }
      if (n.area) return { ...base, values: { ...n.values }, open: n.open, manual: { ...n.manual } };
      return { ...base, values: { ...n.values } };
    }),
    wires: scene.wires.map((w) => ({ id: w.id, from: { ...w.from }, to: { ...w.to } })),
  };
}

// Recria a cena a partir dos dados. Nós de tipo que a linguagem não conhece são ignorados,
// assim como fios cujas pontas não existem mais.
export function deserialize(data, { scene, camera, language }) {
  scene.elements = [];
  scene.wires = [];
  for (const n of data.nodes ?? []) {
    const def = n.reroute
      ? {
        id: 'reroute', title: '', reroute: true,
        inputs: [{ id: 'in', ...n.reroute.input }], outputs: [{ id: 'out', ...n.reroute.output }],
      }
      : language.node(n.type);
    if (!def) continue;
    const node = scene.addNode(def, { id: n.id, x: n.x, y: n.y, scope: n.scope, values: n.values, open: n.open });
    node.x = n.x;
    node.y = n.y;
    if (n.manual) node.manual = { ...n.manual };
  }
  const pinExists = (ref, side) => scene.byId(ref.node)?.[side].some((p) => p.id === ref.pin);
  for (const w of data.wires ?? []) {
    if (pinExists(w.from, 'outputs') && pinExists(w.to, 'inputs')) scene.wires.push({ id: w.id, from: { ...w.from }, to: { ...w.to } });
  }
  scene.nextId = Math.max(scene.nextId, data.nextId ?? 1, ...scene.wires.map((w) => w.id + 1));
  if (data.camera) Object.assign(camera, data.camera);
  scene.refreshInference();
}

// Armazenamento no IndexedDB: load() → dados ou null; save(dados).
// Banco próprio ('projectdrawn-canvas'): o 'projectdrawn' é do app antigo (ramo legado) e fica intocado.
export function createIdbStore({ dbName = 'projectdrawn-canvas', storeName = 'projects', key = 'current', idb = globalThis.indexedDB } = {}) {
  if (!idb) return createMemoryStore();
  const request = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const createStore = (req) => {
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName);
    };
    return req;
  };
  // Abre na versão que o banco já tiver; se faltar o armazém, sobe uma versão para criá-lo.
  const open = async () => {
    const db = await request(createStore(idb.open(dbName)));
    if (db.objectStoreNames.contains(storeName)) return db;
    const version = db.version + 1;
    db.close();
    return request(createStore(idb.open(dbName, version)));
  };
  let dbPromise = null;
  const db = () => (dbPromise ??= open());
  return {
    async load() {
      const store = (await db()).transaction(storeName, 'readonly').objectStore(storeName);
      return (await request(store.get(key))) ?? null;
    },
    async save(data) {
      const store = (await db()).transaction(storeName, 'readwrite').objectStore(storeName);
      await request(store.put(data, key));
    },
  };
}

export function createMemoryStore() {
  let saved = null;
  return {
    async load() {
      return saved && structuredClone(saved);
    },
    async save(data) {
      saved = structuredClone(data);
    },
  };
}

// Salvamento automático: schedule() a cada mudança; salva depois de `delay` ms sem mudanças.
export function createAutosave(store, getData, { delay = 400, onError = console.error } = {}) {
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    return store.save(getData()).catch(onError);
  };
  return {
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
    get pending() {
      return timer !== null;
    },
  };
}
