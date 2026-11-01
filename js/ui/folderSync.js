import { bus } from '../core/events.js';
import { t } from '../i18n/i18n.js';
import { createItem } from '../core/project.js';
import { addItems, removeItems, updateItem, updateSettings } from '../core/projectOps.js';
import { graphSnapshot } from '../core/graphOps.js';
import { adapterFor, generateCode, parseCode } from '../lang/adapters.js';
import { isReal } from '../core/realItems.js';
import { projectFolder } from '../storage/projectFolder.js';
import { SKIP_DIRS, SKIP_FILES, godotSettings, layout } from './projectImport.js';
import { itemByPath } from './codeImport.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';

// Sincronização com a pasta do projeto real: guarda um retrato (caminhos, tamanho e data de
// cada arquivo), compara com a pasta e APLICA as mudanças no app (novo, apagado, movido,
// alterado → reimporta os arquivos com código). O Log só registra o que mudou.
// Caminho no app = caminho na pasta (a raiz do canvas é a raiz da pasta).
const MAX_LOG = 50;
let running = false;

// Verifica ao ligar/reconectar a pasta e ao abrir o projeto (quando o navegador já permite).
export function bindFolderSync(editor) {
  let last = '';
  bus.on('folder:changed', (state) => {
    const key = `${state.projectId}|${state.status}|${state.name}`;
    if (state.status !== 'granted' || key === last) {
      last = key;
      return;
    }
    last = key;
    // Ao abrir, o projeto entra no editor logo depois do evento.
    setTimeout(() => {
      if (editor.project?.id === state.projectId) syncProjectFolder(editor);
    }, 0);
  });
}

export async function syncProjectFolder(editor, { quiet = false } = {}) {
  const folder = projectFolder();
  const project = editor.project;
  if (!project || folder.status !== 'granted' || !folder.handle || running) return null;
  running = true;
  try {
    const scan = await scanFolder(folder.handle);
    const old = project.folder?.snapshot ?? null;
    const changes = diff(old, scan);
    const applied = await apply(editor, scan, changes, Boolean(old));
    project.folder = {
      snapshot: { folders: [...scan.folders], files: Object.fromEntries([...scan.files].map(([p, f]) => [p, { size: f.size, mtime: f.mtime }])) },
      log: [...(project.folder?.log ?? []), ...(changes.length || !old ? [{ at: Date.now(), first: !old, changes: old ? changes : [{ type: 'linked', path: folder.name, count: scan.files.size }] }] : [])].slice(-MAX_LOG),
    };
    bus.emit('project:changed', project);
    if (!quiet || changes.length) toast[changes.length ? 'success' : 'info'](old ? t('sync.done', { count: changes.length, applied }) : t('sync.first', { count: applied }));
    return changes;
  } catch {
    toast.error(t('sync.failed'));
    return null;
  } finally {
    running = false;
  }
}

// ---------- leitura da pasta ----------

async function scanFolder(root) {
  const folders = new Set();
  const files = new Map(); // caminho → { size, mtime, handle }
  const walk = async (dir, prefix) => {
    const jobs = [];
    for await (const handle of dir.values()) {
      const path = prefix ? `${prefix}/${handle.name}` : handle.name;
      if (handle.kind === 'directory') {
        if (SKIP_DIRS.has(handle.name) || handle.name.startsWith('.')) continue;
        folders.add(path);
        jobs.push(walk(handle, path));
      } else if (!SKIP_FILES.test(handle.name)) {
        jobs.push(handle.getFile().then((file) => files.set(path, { size: file.size, mtime: file.lastModified, handle })));
      }
    }
    await Promise.all(jobs);
  };
  await walk(root, '');
  return { folders, files };
}

// ---------- comparação ----------

// [{ type: 'added'|'removed'|'modified'|'moved', kind: 'file'|'folder', path, from? }]
function diff(old, scan) {
  const changes = [];
  const oldFiles = new Map(Object.entries(old?.files ?? {}));
  const oldFolders = new Set(old?.folders ?? []);
  const added = [...scan.files.keys()].filter((p) => !oldFiles.has(p));
  const removed = [...oldFiles.keys()].filter((p) => !scan.files.has(p));
  // Movido/renomeado: some de um lugar e aparece em outro com o mesmo tamanho e data.
  const name = (p) => p.split('/').pop();
  for (const path of [...removed]) {
    const was = oldFiles.get(path);
    const to = added.find((p) => {
      const f = scan.files.get(p);
      return f.size === was.size && f.mtime === was.mtime && (name(p) === name(path) || p.split('/').slice(0, -1).join('/') === path.split('/').slice(0, -1).join('/'));
    });
    if (!to) continue;
    changes.push({ type: 'moved', kind: 'file', path: to, from: path });
    added.splice(added.indexOf(to), 1);
    removed.splice(removed.indexOf(path), 1);
  }
  for (const path of [...scan.folders].filter((p) => !oldFolders.has(p)).sort(depth)) changes.push({ type: 'added', kind: 'folder', path });
  for (const path of added) changes.push({ type: 'added', kind: 'file', path });
  for (const path of removed) changes.push({ type: 'removed', kind: 'file', path });
  for (const path of [...oldFolders].filter((p) => !scan.folders.has(p)).sort(depth).reverse()) changes.push({ type: 'removed', kind: 'folder', path });
  for (const [path, was] of oldFiles) {
    const now = scan.files.get(path);
    if (now && (now.size !== was.size || now.mtime !== was.mtime)) changes.push({ type: 'modified', kind: 'file', path });
  }
  return changes;
}

const depth = (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b);

// ---------- aplicar no app ----------

async function apply(editor, scan, changes, hasSnapshot) {
  const project = editor.project;
  const byPath = new Map([...project.items.values()].map((item) => [project.path(item.id, ''), item]));
  const parentPath = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const created = [];
  const children = new Map();
  const ensure = (path, kind) => {
    if (!path) return null;
    if (byPath.has(path)) return byPath.get(path);
    const parent = ensure(parentPath(path), 'folder');
    const item = createItem({ kind, name: path.split('/').pop(), parentId: parent?.id ?? null });
    byPath.set(path, item);
    created.push(item);
    const key = parent?.id ?? '';
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(item);
    return item;
  };

  // Tudo que existe na pasta e falta no app entra — menos o que está dentro de itens ignorados.
  const ignoredRoots = [...project.items.values()].filter((i) => i.ignored).map((i) => project.path(i.id, ''));
  const ignored = (p) => ignoredRoots.some((r) => p === r || p.startsWith(`${r}/`));
  const additions = [...[...scan.folders].sort(depth).map((path) => ({ kind: 'folder', path })), ...[...scan.files.keys()].map((path) => ({ kind: 'file', path }))]
    .filter((c) => !ignored(c.path));
  const newFiles = [];
  for (const c of additions) {
    if (byPath.has(c.path)) continue;
    const item = ensure(c.path, c.kind);
    if (c.kind === 'file') newFiles.push({ item, path: c.path });
  }

  const resolvePath = (res) => byPath.get(res.replace(/^res:\/\//, ''))?.id ?? itemByPath(project, res);
  const readText = async (path) => (await scan.files.get(path).handle.getFile()).text();
  for (const { item, path } of newFiles) {
    if (!adapterFor(item)) continue;
    const result = parseCode(item, await readText(path), { resolvePath });
    if (result?.graph) item.graph = result.graph;
  }
  const modified = [];
  for (const c of changes.filter((x) => x.type === 'modified' && !ignored(x.path))) {
    const item = byPath.get(c.path);
    if (!item || !adapterFor(item)) continue;
    const result = parseCode(item, await readText(c.path), { resolvePath });
    if (result?.graph) modified.push({ item, graph: result.graph });
  }
  const moves = [];
  for (const c of changes.filter((x) => x.type === 'moved')) {
    const item = byPath.get(c.from);
    if (!item) continue;
    const parent = ensure(parentPath(c.path), 'folder');
    moves.push({ item, patch: { parentId: parent?.id ?? null, name: c.path.split('/').pop() } });
  }
  const removed = changes
    .filter((c) => c.type === 'removed')
    .map((c) => byPath.get(c.path))
    .filter(Boolean);
  const removedIds = new Set(removed.map((i) => i.id));
  const removeIds = removed.filter((i) => ![...project.ancestors(i.id)].some((a) => removedIds.has(a.id))).map((i) => i.id);
  const projectFile = scan.files.has('project.godot') && (!hasSnapshot || changes.some((c) => c.path === 'project.godot' && c.type !== 'removed'))
    ? await readText('project.godot')
    : null;

  layout(project, editor, null, null, children);
  const label = t('sync.history');
  const count = created.length + modified.length + moves.length + removeIds.length;
  if (!count && !projectFile) return 0;
  editor.history.transaction(label, () => {
    if (created.length) editor.history.execute(addItems(project, created, [], label));
    for (const { item, patch } of moves) editor.history.execute(updateItem(project, item.id, patch, label));
    for (const { item, graph } of modified) editor.history.execute(graphSnapshot(project, item.id, structuredClone(item.graph ?? null), graph, label));
    if (removeIds.length) editor.history.execute(removeItems(project, removeIds, label));
    if (projectFile) {
      const settings = godotSettings(project, projectFile, byPath);
      for (const [item, name] of settings?.autoloads ?? []) if (item.autoload !== name) editor.history.execute(updateItem(project, item.id, { autoload: name }, label));
      if (settings?.patch) editor.history.execute(updateSettings(project, settings.patch, label));
    }
  });
  return count;
}

// ---------- app → diretório real ----------

// Cria no diretório real a pasta/arquivo criado no app (e as pastas do caminho). Pasta leva
// junto o que foi criado no app dentro dela; arquivo com código grava o código gerado.
// Depois, uma verificação inclui tudo no retrato (o item passa a ser do diretório real).
export async function reflectToFolder(editor, item) {
  const folder = projectFolder();
  const project = editor.project;
  if (folder.status !== 'granted' || !folder.handle) {
    toast.warning(t('real.needFolder'));
    return;
  }
  const write = async (it) => {
    const parts = project.path(it.id, '').split('/');
    let dir = folder.handle;
    for (const name of it.kind === 'folder' ? parts : parts.slice(0, -1)) dir = await dir.getDirectoryHandle(name, { create: true });
    if (it.kind === 'folder') {
      for (const child of project.children(it.id)) if (!isReal(project, child)) await write(child);
      return;
    }
    const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await handle.createWritable();
    await writable.write(generateCode(it)?.code ?? '');
    await writable.close();
  };
  try {
    await write(item);
  } catch {
    toast.error(t('real.reflectFailed'));
    return;
  }
  await syncProjectFolder(editor, { quiet: true });
  toast.success(t('real.reflected', { name: item.name }));
}

// ---------- tela de Log ----------

const ICONS = { added: '+', removed: '−', modified: '✎', moved: '→', linked: '🔗' };

export function openFolderLog(editor) {
  const log = [...(editor.project?.folder?.log ?? [])].reverse();
  const content = document.createElement('div');
  content.className = 'folder-log';
  if (!log.length) content.append(text('p', 'side-panel__hint', t('sync.logEmpty')));
  for (const entry of log) {
    const title = text('h4', 'inspector__section', `${new Date(entry.at).toLocaleString()} · ${t('sync.logCount', { count: entry.changes.length })}`);
    const list = document.createElement('ul');
    list.className = 'folder-log__list';
    for (const c of entry.changes) {
      const line = c.type === 'linked'
        ? t('sync.logLinked', { name: c.path, count: c.count })
        : `${ICONS[c.type]} ${t(`sync.type.${c.type}`)}: ${c.from ? `${c.from} → ` : ''}${c.path}${c.kind === 'folder' ? '/' : ''}`;
      list.append(text('li', `folder-log__item folder-log__item--${c.type}`, line));
    }
    content.append(title, list);
  }
  openModal({ title: t('sync.logTitle'), content, width: '640px', actions: [{ id: 'ok', label: t('modal.close'), variant: 'primary', submit: true }] });
}

function text(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = value;
  return el;
}
