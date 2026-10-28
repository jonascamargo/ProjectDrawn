import { uid } from '../core/ids.js';
import { libraryStore } from './libraryStore.js';
import { convertGodotApi, looksLikeGodotApi } from './godotImport.js';
import { StorageError } from './migrations.js';
import { downloadText, slugify } from './importExport.js';

// Operações sobre bibliotecas usadas pelo launcher, pelo editor de bibliotecas e
// pela importação/exportação de projetos (que embutem as bibliotecas usadas).

export const LIBRARY_FORMAT = 'projectdrawn-library';
export const LIBRARY_EXTENSION = '.library.json';
const FORMAT_VERSION = 1;

// ---------- nomes (únicos entre todas as bibliotecas; a URL usa o nome) ----------

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function uniqueLibraryName(name, exceptId = null) {
  const records = await libraryStore().list();
  const taken = (candidate) => records.some((r) => r.id !== exceptId && sameName(r.name, candidate));
  if (!taken(name)) return name;
  const stem = name.replace(/ \(\d+\)$/, '');
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})`;
    if (!taken(candidate)) return candidate;
  }
}

export async function findLibraryByName(name) {
  const records = await libraryStore().list();
  return records.find((r) => r.name === name) ?? records.find((r) => sameName(r.name, name)) ?? null;
}

// ---------- criar / editar ----------

export function emptyLibraryData(kind) {
  if (kind === 'catalog') {
    return { engine: '', engineVersion: '', families: [], classes: [], builtinTypes: [], utilityFunctions: [], singletons: [], globalEnums: [] };
  }
  return { rootLabel: '', types: [], nodes: [], fileTypes: [], relationTypes: [], templates: [] };
}

function newRecord({ kind, name, version, description, data }) {
  const now = Date.now();
  return { id: uid('lib'), kind, name, version: String(version || '1'), description: description ?? '', builtin: false, createdAt: now, updatedAt: now, data };
}

// baseId: copia os dados de outra biblioteca do mesmo tipo.
export async function createLibrary({ kind, name, version, description, baseId }) {
  const base = baseId ? await libraryStore().get(baseId) : null;
  const data = base && base.kind === kind ? structuredClone(base.data) : emptyLibraryData(kind);
  const record = newRecord({ kind, name: await uniqueLibraryName(name), version, description, data });
  await libraryStore().save(record);
  return record;
}

export async function duplicateLibrary(record, name) {
  const copy = newRecord({
    kind: record.kind,
    name: await uniqueLibraryName(name),
    version: record.version,
    description: record.description,
    data: structuredClone(record.data),
  });
  await libraryStore().save(copy);
  return copy;
}

export async function saveLibrary(record) {
  record.updatedAt = Date.now();
  await libraryStore().save(record);
}

export async function deleteLibrary(record) {
  await libraryStore().remove(record.id);
}

// Projetos que usam cada biblioteca: Map<libraryId, string[] nomes de projeto>
export async function libraryUsage(projectStore) {
  const usage = new Map();
  const mark = (id, name) => {
    if (!usage.has(id)) usage.set(id, []);
    usage.get(id).push(name);
  };
  for (const project of await projectStore.list()) {
    if (project.deletedAt) continue;
    mark(project.data.languageProfile, project.name);
    for (const ref of project.data.libraries ?? []) mark(ref.id, project.name);
  }
  return usage;
}

// ---------- importar / exportar ----------

function payloadOf(record) {
  const { id, kind, name, version, description, data, updatedAt } = record;
  return { id, kind, name, version, description, updatedAt, data };
}

export function serializeLibrary(record) {
  return JSON.stringify({ format: LIBRARY_FORMAT, formatVersion: FORMAT_VERSION, exportedAt: new Date().toISOString(), library: payloadOf(record) }, null, 2);
}

export function exportLibrary(record) {
  downloadText(slugify(record.name, 'biblioteca') + LIBRARY_EXTENSION, serializeLibrary(record));
}

// Lê um arquivo: biblioteca exportada pelo app ou extension_api.json da Godot.
// Retorna { kind: 'library', payload } | { kind: 'godot', json }.
export function parseLibraryText(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new StorageError('invalidJson');
  }
  if (looksLikeGodotApi(json)) return { kind: 'godot', json };
  if (json?.format === LIBRARY_FORMAT && json.library?.kind) return { kind: 'library', payload: json.library };
  throw new StorageError('unknownFormat');
}

// resolveConflict(existing) → 'replace' | 'copy' | 'skip'
export async function importLibraryPayload(payload, resolveConflict) {
  const store = libraryStore();
  const existing = await store.get(payload.id);
  if (existing) {
    const choice = existing.builtin ? 'copy' : await resolveConflict(existing);
    if (choice === 'skip') return null;
    if (choice === 'replace') {
      Object.assign(existing, { ...payload, id: existing.id, builtin: false, name: await uniqueLibraryName(payload.name, existing.id) });
      await saveLibrary(existing);
      return existing;
    }
  }
  const record = newRecord({ ...payload, name: await uniqueLibraryName(payload.name) });
  if (!existing) record.id = payload.id;
  await store.save(record);
  return record;
}

export async function importGodotApi(json, { name } = {}) {
  const data = convertGodotApi(json);
  const record = newRecord({
    kind: 'catalog',
    name: await uniqueLibraryName(name || `Godot ${data.engineVersion}`),
    version: data.engineVersion,
    description: `Classes da Godot ${data.engineVersion} importadas do extension_api.json`,
    data,
  });
  await libraryStore().save(record);
  return record;
}

// ---------- bibliotecas embutidas em projetos ----------

// Bibliotecas do usuário referenciadas pelo projeto (as embutidas no app não vão).
export async function embeddedLibrariesFor(projectData) {
  const ids = [projectData.languageProfile, ...(projectData.libraries ?? []).map((ref) => ref.id)];
  const out = [];
  for (const id of new Set(ids)) {
    const record = await libraryStore()?.get(id);
    if (record && !record.builtin) out.push(payloadOf(record));
  }
  return out;
}

// Ao importar/abrir um projeto: adiciona as bibliotecas que ainda não existem.
// As que já existem são mantidas como estão (a versão local prevalece).
export async function importEmbeddedLibraries(payloads = []) {
  let added = 0;
  for (const payload of payloads) {
    if (!payload?.id || (await libraryStore().get(payload.id))) continue;
    const record = newRecord({ ...payload, name: await uniqueLibraryName(payload.name) });
    record.id = payload.id;
    await libraryStore().save(record);
    added++;
  }
  return added;
}
