// Vínculo de projeto com arquivo no disco (File System Access API — Chrome/Edge).
// O arquivo vinculado é a fonte da verdade; o IndexedDB guarda uma cópia (cache).
// O navegador exige um clique do usuário para conceder permissão a cada sessão.

export const fileLinkSupported = typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function';

const PICKER_TYPES = [{ description: 'ProjectDrawn', accept: { 'application/json': ['.json'] } }];

function isAbort(error) {
  return error?.name === 'AbortError';
}

// Resolve com o handle ou null se o usuário cancelar.
export async function pickSaveFile(suggestedName) {
  try {
    return await window.showSaveFilePicker({ suggestedName, types: PICKER_TYPES });
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

export async function pickOpenFile() {
  try {
    const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
    return handle ?? null;
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

// request: tenta pedir permissão (só funciona logo após um clique do usuário).
// Retorna 'granted' | 'prompt' | 'denied'.
export async function filePermission(handle, { request = false } = {}) {
  const options = { mode: 'readwrite' };
  try {
    let state = await handle.queryPermission(options);
    if (state === 'prompt' && request) state = await handle.requestPermission(options);
    return state;
  } catch {
    return 'prompt';
  }
}

export async function readHandle(handle) {
  const file = await handle.getFile();
  return { text: await file.text(), lastModified: file.lastModified };
}

export async function fileLastModified(handle) {
  return (await handle.getFile()).lastModified;
}

// Escreve e retorna o novo lastModified.
export async function writeHandle(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  return fileLastModified(handle);
}
