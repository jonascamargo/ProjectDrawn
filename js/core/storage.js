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
      if (n.lang) base.lang = n.lang;
      if (Object.keys(n.inputValues ?? {}).length) base.inputValues = structuredClone(n.inputValues);
      const split = [...(n.inputs ?? []), ...(n.outputs ?? [])].filter((p) => p.split).map((p) => `${p.direction}:${p.id}`);
      if (split.length) base.split = split;
      if (n.reroute) {
        const pin = (p) => ({ kind: p.kind, type: p.type });
        return { ...base, reroute: { input: pin(n.inputs[0]), output: pin(n.outputs[0]) } };
      }
      if (n.area) return { ...base, values: { ...n.values }, open: n.open, manual: { ...n.manual } };
      if (n.ref != null) return { ...base, values: { ...n.values }, ref: n.ref, ...(n.refKey != null && { refKey: n.refKey }) };
      return { ...base, values: { ...n.values } };
    }),
    wires: scene.wires.map((w) => ({ id: w.id, from: { ...w.from }, to: { ...w.to } })),
  };
}

// Recria a cena a partir dos dados, com as linguagens da cena. Nós de tipo que nenhuma linguagem
// conhece são ignorados, assim como fios cujas pontas não existem mais. Dados sem `lang` (de antes
// das linguagens) acham o tipo no núcleo ou na primeira linguagem que tiver.
export function deserialize(data, { scene, camera }) {
  scene.elements = [];
  scene.wires = [];
  for (const n of data.nodes ?? []) {
    const def = n.reroute
      ? {
        id: 'reroute', title: '', reroute: true, lang: n.lang ?? null,
        inputs: [{ id: 'in', ...n.reroute.input }], outputs: [{ id: 'out', ...n.reroute.output }],
      }
      : scene.languages.def(n.type, n.lang);
    if (!def) continue;
    const node = scene.addNode(def, {
      id: n.id, x: n.x, y: n.y, scope: n.scope, values: n.values, open: n.open, ref: n.ref ?? null, refKey: n.refKey ?? null,
      inputValues: n.inputValues,
    });
    node.x = n.x;
    node.y = n.y;
    if (n.manual) node.manual = { ...n.manual };
  }
  // Com todos os nós no lugar, os nativos seguem a classe em volta (a função pode ter vindo antes do
  // arquivo) e as referências pegam os pinos do alvo (ex.: parâmetros da chamada); só então os pinos
  // abertos e os fios encontram os pinos deles.
  scene.refreshNatives();
  scene.syncReferences();
  for (const n of data.nodes ?? []) {
    const node = scene.byId(n.id);
    for (const key of (node && n.split) ?? []) {
      const [side, id] = key.split(':');
      const pin = node[side === 'in' ? 'inputs' : 'outputs'].find((p) => p.id === id);
      if (pin) scene.splitPin(node, pin);
    }
  }
  const pinExists = (ref, side) => scene.byId(ref.node)?.[side].some((p) => p.id === ref.pin);
  for (const w of data.wires ?? []) {
    if (pinExists(w.from, 'outputs') && pinExists(w.to, 'inputs')) scene.wires.push({ id: w.id, from: { ...w.from }, to: { ...w.to } });
  }
  scene.nextId = Math.max(scene.nextId, data.nextId ?? 1, ...scene.wires.map((w) => w.id + 1));
  if (data.camera) Object.assign(camera, data.camera);
  scene.refreshInference();
  scene.syncReferences();
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
