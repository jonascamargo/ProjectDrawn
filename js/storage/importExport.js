import { StorageError } from './migrations.js';

// Formatos de arquivo:
//   projeto: { format: 'projectdrawn-project', formatVersion, savedAt, project, view }
//   pacote:  { format: 'projectdrawn-bundle', formatVersion, exportedAt, projects: [{ project, view }] }
// Os formatos 'codedrawn-*' (nome antigo do app) continuam aceitos na leitura.
// Um JSON de projeto "cru" (só Project.toJSON()) também é aceito na importação.

export const PROJECT_FORMAT = 'projectdrawn-project';
export const BUNDLE_FORMAT = 'projectdrawn-bundle';
export const FILE_EXTENSION = '.projectdrawn.json';
const LEGACY_PROJECT_FORMAT = 'codedrawn-project';
const LEGACY_BUNDLE_FORMAT = 'codedrawn-bundle';
const FORMAT_VERSION = 1;

// libraries: bibliotecas do usuário usadas pelo projeto, embutidas para abrir em outro PC.
export function serializeProject(data, view = {}, libraries = []) {
  return JSON.stringify(
    { format: PROJECT_FORMAT, formatVersion: FORMAT_VERSION, savedAt: new Date().toISOString(), project: data, view, libraries },
    null,
    2,
  );
}

export function serializeBundle(entries, libraries = []) {
  return JSON.stringify(
    {
      format: BUNDLE_FORMAT,
      formatVersion: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      projects: entries.map(({ data, view }) => ({ project: data, view: view ?? {} })),
      libraries,
    },
    null,
    2,
  );
}

// Retorna [{ data, view, libraries }].
export function parseFileText(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new StorageError('invalidJson');
  }
  if (json?.format === BUNDLE_FORMAT || json?.format === LEGACY_BUNDLE_FORMAT) {
    const libraries = json.libraries ?? [];
    return (json.projects ?? []).map((entry) => ({ data: entry.project, view: entry.view ?? {}, libraries }));
  }
  if (json?.format === PROJECT_FORMAT || json?.format === LEGACY_PROJECT_FORMAT) {
    return [{ data: json.project, view: json.view ?? {}, libraries: json.libraries ?? [] }];
  }
  if (Array.isArray(json?.items)) return [{ data: json, view: {}, libraries: [] }];
  throw new StorageError('unknownFormat');
}

// Hash rápido (FNV-1a) do conteúdo do projeto, para saber se um arquivo mudou de fato.
export function contentHash(data) {
  const text = JSON.stringify(data);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16) + ':' + text.length;
}

export function slugify(name, fallback = 'projeto') {
  return (
    (name || fallback)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || fallback
  );
}

export function fileNameFor(name) {
  return slugify(name) + FILE_EXTENSION;
}

export function bundleFileName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `projectdrawn-pacote-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
}

export function downloadText(fileName, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Abre o seletor de arquivos do navegador. Resolve com File[] (vazio se cancelado).
export function pickFiles({ multiple = true, accept = '.json,application/json' } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}
