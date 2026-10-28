// Perfil de linguagem: tipos de arquivo, tipos de relação e (na Fase 4) catálogo de nós.
let current = null;

const OTHER = { category: 'other', label: '', extensions: [] };

export async function loadProfile(id) {
  const response = await fetch(`languages/${id}.json`);
  if (!response.ok) throw new Error(`profile: ${id} (${response.status})`);
  current = await response.json();
  return current;
}

export function currentProfile() {
  return current;
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
