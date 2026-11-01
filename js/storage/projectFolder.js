import { bus } from '../core/events.js';

// Pasta do projeto real (ex.: o projeto Godot) ligada a um projeto do app — opcional.
// O app lê a pasta (preview, comparação de estrutura) e só grava o próprio arquivo .codedrawn.json. A permissão do
// navegador vale por sessão: ao abrir o projeto o estado fica "prompt" até o usuário reconectar.
// Estado: { projectId, handle, status: 'none' | 'prompt' | 'granted' | 'denied', name }.
const key = (projectId) => `folder:${projectId}`;
let state = { projectId: null, handle: null, status: 'none', name: '' };

export function projectFolder() {
  return state;
}

export function folderSupported() {
  return typeof window.showDirectoryPicker === 'function';
}

function set(next) {
  state = next;
  bus.emit('folder:changed', state);
}

async function permission(handle, request) {
  try {
    let status = await handle.queryPermission({ mode: 'readwrite' });
    if (status === 'prompt' && request) status = await handle.requestPermission({ mode: 'readwrite' });
    return status;
  } catch {
    return 'prompt';
  }
}

export async function loadProjectFolder(store, projectId) {
  const handle = (await store.handle(key(projectId)).catch(() => null)) ?? null;
  set({ projectId, handle, status: handle ? await permission(handle, false) : 'none', name: handle?.name ?? '' });
}

export async function linkProjectFolder(store, projectId) {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await store.setHandle(key(projectId), handle);
  set({ projectId, handle, status: await permission(handle, true), name: handle.name });
}

export async function reconnectProjectFolder() {
  if (!state.handle) return;
  set({ ...state, status: await permission(state.handle, true) });
}

export async function unlinkProjectFolder(store) {
  if (state.projectId) await store.deleteHandle(key(state.projectId));
  set({ projectId: state.projectId, handle: null, status: 'none', name: '' });
}

export function forgetProjectFolder(store, projectId) {
  return store.deleteHandle(key(projectId)).catch(() => {});
}

// Arquivo da pasta real pelo caminho do item no app ("pasta/arquivo.png"). Se o projeto Godot
// foi importado dentro de uma pasta do app, tenta também sem as primeiras pastas do caminho.
export async function readProjectFile(path) {
  if (state.status !== 'granted' || !state.handle) return null;
  const parts = path.split('/').filter(Boolean);
  for (let skip = 0; skip < parts.length; skip++) {
    const file = await fileAt(state.handle, parts.slice(skip));
    if (file) return file;
  }
  return null;
}

async function fileAt(dir, parts) {
  try {
    let current = dir;
    for (const name of parts.slice(0, -1)) current = await current.getDirectoryHandle(name);
    return await (await current.getFileHandle(parts[parts.length - 1])).getFile();
  } catch {
    return null;
  }
}
