import { uid } from '../core/ids.js';
import { Project, createItem } from '../core/project.js';
import { migrateProjectData } from './migrations.js';
import { recordFromData, syncRecord } from './projectStore.js';
import {
  bundleFileName,
  contentHash,
  downloadText,
  fileNameFor,
  parseFileText,
  serializeBundle,
  serializeProject,
} from './importExport.js';
import { fileLinkSupported, pickOpenFile, pickSaveFile, readHandle, writeHandle } from './fileLink.js';
import { libraryStore } from './libraryStore.js';
import { embeddedLibrariesFor, importEmbeddedLibraries } from './libraryService.js';

// Operações sobre projetos usadas pelo launcher e pela sessão do editor.
// Decisões do usuário (conflitos, nomes) chegam por callbacks; aqui não há interface.

// Perfis de linguagem disponíveis (embutidos + do usuário): [{ id, name, version }]
export async function fetchLanguageIndex() {
  return (await libraryStore().list()).filter((r) => r.kind === 'language').map(({ id, name, version }) => ({ id, name, version }));
}

export async function fetchCatalogIndex() {
  return (await libraryStore().list()).filter((r) => r.kind === 'catalog').map(({ id, name, version }) => ({ id, name, version }));
}

export async function fetchLanguageProfile(id) {
  return (await libraryStore().get(id))?.data ?? null;
}

// Troca o perfil de linguagem e os catálogos de um projeto (fechado).
export async function setProjectLibraries(store, record, { languageProfile, catalogs }) {
  record.data.languageProfile = languageProfile;
  record.data.libraries = catalogs.map((c) => ({ id: c.id, version: c.version }));
  syncRecord(record, record.data);
  record.updatedAt = Date.now();
  await store.save(record);
}

// ---------- nomes (únicos entre todos os projetos, incluindo a lixeira; a URL usa o nome) ----------

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function projectNameTaken(store, name, exceptId = null) {
  return (await store.list()).some((r) => r.id !== exceptId && sameName(r.name, name));
}

export async function uniqueProjectName(store, name, exceptId = null) {
  const records = await store.list();
  const taken = (candidate) => records.some((r) => r.id !== exceptId && sameName(r.name, candidate));
  if (!taken(name)) return name;
  const stem = name.replace(/ \(\d+\)$/, '');
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})`;
    if (!taken(candidate)) return candidate;
  }
}

// Garante nome único nos dados (alterando data.name se preciso).
async function ensureUniqueName(store, data, exceptId) {
  data.name = await uniqueProjectName(store, data.name || 'Projeto', exceptId);
  return data;
}

export async function findActiveByName(store, name) {
  const active = (await store.list()).filter((r) => !r.deletedAt);
  return active.find((r) => r.name === name) ?? active.find((r) => sameName(r.name, name)) ?? null;
}

export async function createProject(store, { name, description, languageProfile, templateId }) {
  name = await uniqueProjectName(store, name);
  const project = new Project({ name, description, languageProfile });
  if (templateId) {
    const profile = await fetchLanguageProfile(languageProfile);
    const template = profile?.templates?.find((tpl) => tpl.id === templateId);
    if (template) addTemplateItems(project, template.items, null);
  }
  const record = recordFromData(project.toJSON());
  await store.save(record);
  return record;
}

function addTemplateItems(project, items, parentId) {
  items.forEach((spec, index) => {
    const item = createItem({ kind: spec.kind, name: spec.name, parentId, x: spec.x ?? 0, y: spec.y ?? 0, z: index });
    project.items.set(item.id, item);
    if (spec.children?.length) addTemplateItems(project, spec.children, item.id);
  });
  project.invalidate();
}

// Copia o projeto com um novo id (itens mantêm seus ids: são únicos por projeto).
function asCopy(data, name) {
  const copy = structuredClone(data);
  copy.id = uid('prj');
  copy.name = name;
  return copy;
}

export async function duplicateProject(store, record, name) {
  const copy = recordFromData(asCopy(record.data, await uniqueProjectName(store, name)), { camera: record.camera });
  await store.save(copy);
  const thumb = await store.thumbnail(record.id);
  if (thumb) await store.setThumbnail(copy.id, thumb);
  return copy;
}

export async function renameProject(store, record, name) {
  record.data.name = name;
  syncRecord(record, record.data);
  record.updatedAt = Date.now();
  await store.save(record);
}

export function viewOf(record) {
  return record.camera ? { camera: record.camera } : {};
}

export async function exportRecords(store, records) {
  if (!records.length) return;
  if (records.length === 1) {
    const libraries = await embeddedLibrariesFor(records[0].data);
    downloadText(fileNameFor(records[0].name), serializeProject(records[0].data, viewOf(records[0]), libraries));
  } else {
    const libraries = new Map();
    for (const record of records) for (const lib of await embeddedLibrariesFor(record.data)) libraries.set(lib.id, lib);
    downloadText(bundleFileName(), serializeBundle(records.map((r) => ({ data: r.data, view: viewOf(r) })), [...libraries.values()]));
  }
  const now = Date.now();
  for (const record of records) {
    record.lastExportedAt = now;
    await store.save(record);
  }
}

// resolveConflict(existingRecord, data) → 'replace' | 'copy' | 'skip'
export async function importTexts(store, texts, resolveConflict) {
  const imported = [];
  for (const text of texts) {
    for (const entry of parseFileText(text)) {
      await importEmbeddedLibraries(entry.libraries);
      let data = migrateProjectData(entry.data);
      const existing = await store.get(data.id);
      if (existing) {
        const choice = await resolveConflict(existing, data);
        if (choice === 'skip') continue;
        if (choice === 'copy') data = asCopy(data, data.name);
        if (choice === 'replace') {
          await store.addSnapshot(existing.id, existing.data, 'beforeImport');
          syncRecord(existing, await ensureUniqueName(store, data, existing.id));
          existing.updatedAt = Date.now();
          existing.deletedAt = null;
          existing.camera = entry.view?.camera ?? existing.camera;
          await store.save(existing);
          imported.push(existing);
          continue;
        }
      }
      await ensureUniqueName(store, data, data.id);
      const record = recordFromData(data, { camera: entry.view?.camera ?? null, lastExportedAt: Date.now() });
      await store.save(record);
      imported.push(record);
    }
  }
  return imported;
}

// ---------- arquivo no disco ----------

export async function linkRecordToFile(store, record) {
  if (!fileLinkSupported) return null;
  const handle = await pickSaveFile(fileNameFor(record.name));
  if (!handle) return null;
  const lastModified = await writeHandle(handle, serializeProject(record.data, viewOf(record), await embeddedLibrariesFor(record.data)));
  await store.setHandle(record.id, handle);
  record.link = { fileName: handle.name, lastModified, syncedAt: record.updatedAt, hash: contentHash(record.data) };
  await store.save(record);
  return handle;
}

export async function unlinkRecord(store, record) {
  await store.deleteHandle(record.id);
  record.link = null;
  await store.save(record);
}

// Abre um arquivo do disco e o vincula. resolveConflict igual a importTexts.
export async function openFromDisk(store, resolveConflict) {
  const handle = await pickOpenFile();
  if (!handle) return null;
  const { text, lastModified } = await readHandle(handle);
  const [entry] = parseFileText(text);
  await importEmbeddedLibraries(entry.libraries);
  let data = migrateProjectData(entry.data);

  const existing = await store.get(data.id);
  let record;
  if (existing) {
    const choice = await resolveConflict(existing, data);
    if (choice === 'skip') return null;
    if (choice === 'copy') {
      data = asCopy(data, data.name);
      record = recordFromData(data);
    } else {
      await store.addSnapshot(existing.id, existing.data, 'beforeImport');
      record = syncRecord(existing, data);
      record.deletedAt = null;
    }
  } else {
    record = recordFromData(data);
  }
  syncRecord(record, await ensureUniqueName(store, record.data, record.id));
  record.camera = entry.view?.camera ?? record.camera;
  record.updatedAt = Date.now();
  record.link = { fileName: handle.name, lastModified, syncedAt: record.updatedAt, hash: contentHash(record.data) };
  await store.save(record);
  await store.setHandle(record.id, handle);
  return record;
}

// ---------- lixeira e versões ----------

export async function moveToTrash(store, record) {
  record.deletedAt = Date.now();
  await store.save(record);
}

// Remove definitivamente projetos na lixeira há mais de `days` dias (0 = nunca).
export async function purgeExpiredTrash(store, days) {
  if (!days) return 0;
  const limit = Date.now() - days * 24 * 60 * 60 * 1000;
  const expired = (await store.list()).filter((r) => r.deletedAt && r.deletedAt < limit);
  for (const record of expired) await store.remove(record.id);
  return expired.length;
}

export async function restoreFromTrash(store, record) {
  record.deletedAt = null;
  await store.save(record);
}

export async function restoreSnapshot(store, record, snapshot) {
  await store.addSnapshot(record.id, record.data, 'beforeRestore');
  const data = migrateProjectData(structuredClone(snapshot.data));
  syncRecord(record, await ensureUniqueName(store, data, record.id));
  record.updatedAt = Date.now();
  await store.save(record);
}
