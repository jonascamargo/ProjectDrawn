// DOM mínimo para os testes em Node: só o que o app usa (elementos, eventos, canvas 2D).

// Contexto 2D que aceita qualquer chamada e anota nome e argumentos.
export function fakeContext(calls) {
  const ctx = {
    measureText: (text) => ({ width: String(text).length * 7 }),
  };
  return new Proxy(ctx, {
    get: (obj, key) => (key in obj ? obj[key] : (...args) => calls.push([key, ...args])),
    set: (obj, key, value) => ((obj[key] = value), true),
  });
}

export class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.className = '';
    this.classes = new Set();
    this.classList = {
      toggle: (c, on) => (on ? this.classes.add(c) : this.classes.delete(c)),
      contains: (c) => this.classes.has(c),
    };
    this.calls = [];
    this.width = 0;
    this.height = 0;
  }

  append(...nodes) {
    for (const n of nodes) {
      const child = typeof n === 'string' ? Object.assign(new FakeElement('#text'), { textContent: n }) : n;
      child.parent = this;
      this.children.push(child);
    }
  }

  prepend(...nodes) {
    const old = this.children;
    this.children = [];
    this.append(...nodes);
    this.children.push(...old);
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  get text() {
    return this.textContent + this.children.map((c) => c.text).join('');
  }

  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }

  dispatch(type, extra = {}) {
    const e = { target: this, preventDefault() {}, ...extra };
    for (const fn of this.listeners[type] ?? []) fn(e);
  }

  contains(node) {
    for (let n = node; n; n = n.parent) if (n === this) return true;
    return false;
  }

  closest(selector) {
    const tags = selector.split(',').map((s) => s.trim().toUpperCase());
    for (let n = this; n; n = n.parent) if (tags.includes(n.tagName)) return n;
    return null;
  }

  focus() {}
  blur() {}
  scrollIntoView() {}
  get offsetWidth() { return 240; }
  get offsetHeight() { return 200; }
  get clientWidth() { return 800; }
  get clientHeight() { return 600; }
  getContext() { return fakeContext(this.calls); }
  getBoundingClientRect() { return { left: this.left ?? 0, top: 0 }; }
  setPointerCapture() {}
  hasPointerCapture() { return true; }
  releasePointerCapture() {}
}

// Instala document, window, requestAnimationFrame e ResizeObserver falsos.
export function installDom() {
  const body = new FakeElement('body');
  const canvas = new FakeElement('canvas');
  const hint = new FakeElement('aside');
  body.append(canvas, hint);
  const docListeners = {};
  const cssVars = {};
  globalThis.document = {
    body,
    activeElement: null,
    documentElement: { style: { setProperty: (name, value) => (cssVars[name] = value), vars: cssVars } },
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => (id === 'board' ? canvas : null),
    querySelector: (sel) => (sel === '.hint' ? hint : null),
    addEventListener: (type, fn) => (docListeners[type] ??= []).push(fn),
    dispatch: (type, e) => (docListeners[type] ?? []).forEach((fn) => fn(e)),
  };
  const winListeners = {};
  globalThis.window = {
    devicePixelRatio: 2,
    innerWidth: 1000,
    innerHeight: 700,
    addEventListener: (type, fn) => (winListeners[type] ??= []).push(fn),
    dispatch: (type, e) => (winListeners[type] ?? []).forEach((fn) => fn({ target: body, preventDefault() {}, ...e })),
  };
  globalThis.requestAnimationFrame = (fn) => fn();
  // Imagem: "carrega" na hora, com 12×14 (o tamanho de icons/function.svg).
  globalThis.Image = class {
    decode() { return this.src?.includes('quebrado') ? Promise.reject(new Error('404')) : Promise.resolve(); }
    get naturalWidth() { return 12; }
    get naturalHeight() { return 14; }
  };
  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() { this.cb(); }
  };
  return { body, canvas, hint };
}

// IndexedDB mínimo, como o real no que o app usa: bancos com versão; open(nome) abre na versão
// atual (ou cria a 1); open(nome, v) menor que a atual dá VersionError; maior chama onupgradeneeded.
export function fakeIndexedDB(existing = {}) {
  const dbs = existing; // nome → { version, stores: Map(nome → Map) }
  const created = [];
  const later = (fn) => queueMicrotask(fn);
  const req = (fn) => {
    const r = {};
    later(() => {
      r.result = fn();
      r.onsuccess?.();
    });
    return r;
  };
  const handle = (name) => {
    const data = dbs[name];
    return {
      get version() { return data.version; },
      objectStoreNames: { contains: (store) => data.stores.has(store) },
      createObjectStore(store) {
        created.push(store);
        data.stores.set(store, new Map());
      },
      close() {},
      transaction(store) {
        if (!data.stores.has(store)) throw new Error(`NotFoundError: ${store}`);
        return {
          objectStore: () => ({
            get: (key) => req(() => structuredClone(data.stores.get(store).get(key))),
            put: (value, key) => req(() => data.stores.get(store).set(key, structuredClone(value))),
          }),
        };
      },
    };
  };
  return {
    created,
    dbs,
    open(name, version) {
      const r = {};
      later(() => {
        const current = dbs[name]?.version ?? 0;
        if (version !== undefined && version < current) {
          r.error = new Error(`VersionError: The requested version (${version}) is less than the existing version (${current}).`);
          r.onerror?.();
          return;
        }
        const target = version ?? (current || 1);
        dbs[name] ??= { version: 0, stores: new Map() };
        r.result = handle(name);
        if (target > current) {
          dbs[name].version = target;
          r.onupgradeneeded?.();
        }
        r.onsuccess?.();
      });
      return r;
    },
  };
}
