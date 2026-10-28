// Bibliotecas: perfis de linguagem e catálogos de engine.
//
// Registro: { id, kind: 'language' | 'catalog', name, version, description, builtin,
//             createdAt, updatedAt, data }
//   data (language): { rootLabel, types, nodes, fileTypes, relationTypes, templates }
//   data (catalog):  { engine, engineVersion, families, classes, builtinTypes,
//                      utilityFunctions, singletons, globalEnums }
//
// Embutidas vêm de languages/index.json e catalogs/index.json (somente leitura);
// as do usuário ficam no store 'libraries' do adaptador.

export const LIBRARY_KINDS = ['language', 'catalog'];

const BUILTIN_SOURCES = [
  { kind: 'language', folder: 'languages' },
  { kind: 'catalog', folder: 'catalogs' },
];

let instance = null;

export function setLibraryStore(store) {
  instance = store;
}

export function libraryStore() {
  return instance;
}

export class LibraryStore {
  #builtins = null;

  constructor(adapter) {
    this.adapter = adapter;
  }

  async #loadBuiltins() {
    if (this.#builtins) return this.#builtins;
    const builtins = [];
    for (const { kind, folder } of BUILTIN_SOURCES) {
      const index = await fetchJson(`${folder}/index.json`);
      for (const entry of index ?? []) {
        const data = await fetchJson(`${folder}/${entry.file ?? `${entry.id}.json`}`);
        if (!data) continue;
        builtins.push({
          id: entry.id,
          kind,
          name: entry.name ?? data.name ?? entry.id,
          version: String(data.version ?? entry.version ?? '1'),
          description: data.description ?? '',
          builtin: true,
          createdAt: 0,
          updatedAt: 0,
          data,
        });
      }
    }
    this.#builtins = builtins;
    return builtins;
  }

  async list() {
    return [...(await this.#loadBuiltins()), ...(await this.adapter.getAll('libraries'))];
  }

  async get(id) {
    const builtin = (await this.#loadBuiltins()).find((lib) => lib.id === id);
    return builtin ?? (await this.adapter.get('libraries', id)) ?? null;
  }

  async save(record) {
    if (record.builtin) throw new Error('builtin library is read-only');
    await this.adapter.put('libraries', record);
  }

  remove(id) {
    return this.adapter.delete('libraries', id);
  }
}

async function fetchJson(url) {
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
