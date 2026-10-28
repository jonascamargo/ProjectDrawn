import { uid } from './ids.js';

export const SCHEMA_VERSION = 1;

// Item do sistema de arquivos visual.
// x, y: posição local, relativa à origem de conteúdo do pai (raiz = origem do mundo).
// color: null | 'palette:<nome>' | '#hex'
export function createItem({ kind, name, parentId = null, x = 0, y = 0, z = 0 }) {
  return {
    id: uid('itm'),
    kind,
    name,
    parentId,
    x,
    y,
    z,
    expanded: false,
    color: null,
    description: '',
    tags: [],
  };
}

// Relação direcionada entre dois itens (from → to).
export function createRelation({ from, to, type }) {
  return { id: uid('rel'), from, to, type };
}

export class Project {
  #children = null;

  constructor({ id = uid('prj'), name = '', description = '', languageProfile = 'gdscript', settings = {} } = {}) {
    this.schemaVersion = SCHEMA_VERSION;
    this.id = id;
    this.name = name;
    this.description = description;
    this.languageProfile = languageProfile;
    this.settings = { snap: true, gridSize: 20, ...settings };
    this.items = new Map();
    this.relations = new Map();
  }

  // Chamado após mudanças estruturais (adicionar, remover, mudar pai ou z).
  invalidate() {
    this.#children = null;
  }

  get(id) {
    return this.items.get(id);
  }

  children(parentId = null) {
    if (!this.#children) {
      this.#children = new Map();
      for (const item of this.items.values()) {
        const key = item.parentId ?? null;
        if (!this.#children.has(key)) this.#children.set(key, []);
        this.#children.get(key).push(item);
      }
      for (const list of this.#children.values()) list.sort((a, b) => a.z - b.z);
    }
    return this.#children.get(parentId) ?? [];
  }

  // Do pai imediato até o nível mais alto (não inclui a raiz).
  ancestors(id) {
    const out = [];
    let current = this.items.get(id);
    while (current?.parentId) {
      current = this.items.get(current.parentId);
      if (!current) break;
      out.push(current);
    }
    return out;
  }

  isDescendant(id, ofId) {
    if (ofId === null) return true;
    return this.ancestors(id).some((a) => a.id === ofId);
  }

  descendants(id) {
    const out = [];
    const stack = [...this.children(id)];
    while (stack.length) {
      const item = stack.pop();
      out.push(item);
      stack.push(...this.children(item.id));
    }
    return out;
  }

  path(id, rootLabel = '') {
    const item = this.items.get(id);
    if (!item) return rootLabel;
    const names = [...this.ancestors(id)].reverse().map((a) => a.name);
    return rootLabel + [...names, item.name].join('/');
  }

  nameTaken(parentId, name, exceptId = null) {
    const lower = name.toLowerCase();
    return this.children(parentId).some((c) => c.id !== exceptId && c.name.toLowerCase() === lower);
  }

  uniqueName(parentId, name, reserved = new Set()) {
    const taken = (n) => this.nameTaken(parentId, n) || reserved.has(n.toLowerCase());
    if (!taken(name)) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    const stem = base.replace(/_\d+$/, '');
    for (let i = 2; ; i++) {
      const candidate = `${stem}_${i}${ext}`;
      if (!taken(candidate)) return candidate;
    }
  }

  nextZ(parentId = null) {
    const list = this.children(parentId);
    return list.length ? list[list.length - 1].z + 1 : 0;
  }

  relationsOf(itemIds) {
    const ids = itemIds instanceof Set ? itemIds : new Set(itemIds);
    return [...this.relations.values()].filter((r) => ids.has(r.from) || ids.has(r.to));
  }

  toJSON() {
    return {
      schemaVersion: this.schemaVersion,
      id: this.id,
      name: this.name,
      description: this.description,
      languageProfile: this.languageProfile,
      settings: this.settings,
      items: [...this.items.values()],
      relations: [...this.relations.values()],
    };
  }

  static fromJSON(data) {
    const project = new Project(data);
    for (const item of data.items ?? []) project.items.set(item.id, item);
    for (const relation of data.relations ?? []) project.relations.set(relation.id, relation);
    return project;
  }
}
