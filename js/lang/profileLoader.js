import { libraryStore } from '../storage/libraryStore.js';

// Bibliotecas ativas do projeto aberto: o perfil de linguagem (tipos de arquivo,
// relações, tipos e nós) e os catálogos de engine (classes, métodos, sinais).
let current = null;
let catalogs = [];

const OTHER = { category: 'other', label: '', extensions: [] };

export async function loadProfile(id) {
  const record = await libraryStore()?.get(id);
  if (!record || record.kind !== 'language') throw new Error(`profile: ${id}`);
  current = record.data;
  return current;
}

// refs: [{ id }] — catálogos que faltam são ignorados (a sessão avisa).
export async function loadCatalogs(refs = []) {
  const loaded = [];
  const missing = [];
  for (const ref of refs) {
    const record = await libraryStore()?.get(ref.id);
    if (record?.kind === 'catalog') loaded.push(record.data);
    else missing.push(ref);
  }
  catalogs = loaded;
  return { loaded, missing };
}

export function currentProfile() {
  return current;
}

export function currentCatalogs() {
  return catalogs;
}

export function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function fileTypeOf(name) {
  const ext = extensionOf(name);
  if (!ext) return OTHER;
  return current?.fileTypes?.find((type) => type.extensions.includes(ext)) ?? OTHER;
}

export function relationTypes() {
  return current?.relationTypes ?? [];
}

export function relationType(id) {
  return relationTypes().find((type) => type.id === id) ?? { id, label: id };
}

export function quickCreateTypes() {
  return (current?.fileTypes ?? []).filter((type) => type.quickCreate);
}
