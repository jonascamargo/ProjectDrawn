import { libraryStore } from '../storage/libraryStore.js';

// Bibliotecas ativas do projeto aberto: os perfis de linguagem (tipos de arquivo, relações,
// tipos e nós) e os catálogos de engine (classes, métodos, sinais; compartilhados).
// O projeto tem um perfil principal e pode ter outros; cada arquivo usa o perfil da sua
// extensão (ou o escolhido nas Propriedades, item.profile). O código que trata um arquivo
// roda dentro de withItemProfile(item, …), e currentProfile() devolve o perfil dele.
const profiles = new Map(); // id → dados do perfil
const names = new Map(); // id → nome da biblioteca
let order = []; // ids carregados, principal primeiro
const active = []; // pilha de perfis em uso (topo = atual)
let catalogs = [];

const OTHER = { category: 'other', label: '', extensions: [] };

// ids: principal primeiro. Retorna { missing: [ids] } (os que não carregaram ficam de fora).
export async function loadProfiles(ids = []) {
  profiles.clear();
  names.clear();
  order = [];
  const missing = [];
  for (const id of new Set(ids.filter(Boolean))) {
    const record = await libraryStore()?.get(id);
    if (record?.kind === 'language') {
      profiles.set(id, record.data);
      names.set(id, record.name ?? id);
      order.push(id);
    } else {
      missing.push(id);
    }
  }
  return { missing };
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

export function primaryProfile() {
  return profiles.get(order[0]) ?? null;
}

// Perfil em uso: o do arquivo sendo tratado, ou o principal.
export function currentProfile() {
  return active.length ? active[active.length - 1] : primaryProfile();
}

export function loadedProfiles() {
  return order.map((id) => ({ id, name: names.get(id), data: profiles.get(id) }));
}

export function profileById(id) {
  return profiles.get(id) ?? null;
}

export function currentCatalogs() {
  return catalogs;
}

export function withProfile(profile, fn) {
  active.push(profile ?? primaryProfile());
  try {
    return fn();
  } finally {
    active.pop();
  }
}

export function withItemProfile(item, fn) {
  return withProfile(item ? profileOf(item) : null, fn);
}

export function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

const typeIn = (profile, ext) => profile?.fileTypes?.find((type) => type.extensions.includes(ext)) ?? null;

// Perfil do arquivo: o escolhido nas Propriedades; senão o que modela a extensão com nós
// (tipo de arquivo com "graph"); senão o primeiro que conhece a extensão; senão o principal.
// Em cada passo o principal vem antes dos outros.
export function profileIdFor(item) {
  if (item?.profile && profiles.has(item.profile)) return item.profile;
  const ext = item?.kind === 'file' ? extensionOf(item.name) : '';
  return (ext && ownerOf(ext)) || (order[0] ?? null);
}

function ownerOf(ext) {
  return order.find((id) => typeIn(profiles.get(id), ext)?.graph) ?? order.find((id) => typeIn(profiles.get(id), ext)) ?? null;
}

export function profileOf(item) {
  return profiles.get(profileIdFor(item)) ?? primaryProfile();
}

// Tipo de arquivo pelo nome (do perfil dono da extensão; ver profileIdFor).
export function fileTypeOf(name) {
  const ext = extensionOf(name);
  const owner = ext ? ownerOf(ext) : null;
  return (owner && typeIn(profiles.get(owner), ext)) || OTHER;
}

// Tipo de arquivo do item, respeitando o perfil escolhido nas Propriedades.
export function fileTypeOfItem(item) {
  if (item?.profile && profiles.has(item.profile)) {
    const type = typeIn(profiles.get(item.profile), extensionOf(item.name));
    if (type) return type;
  }
  return fileTypeOf(item?.name ?? '');
}

// Junta as listas de todos os perfis, sem repetir (o principal vale primeiro).
function union(key, idOf) {
  const out = [];
  const seen = new Set();
  for (const id of order) {
    for (const entry of profiles.get(id)?.[key] ?? []) {
      const k = idOf(entry);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(entry);
    }
  }
  return out;
}

export function allFileTypes() {
  return union('fileTypes', (type) => type.extensions.join(','));
}

export function relationTypes() {
  return union('relationTypes', (type) => type.id);
}

export function relationType(id) {
  return relationTypes().find((type) => type.id === id) ?? { id, label: id };
}

export function quickCreateTypes() {
  return allFileTypes().filter((type) => type.quickCreate);
}
