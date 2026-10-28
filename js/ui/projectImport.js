import { t } from '../i18n/i18n.js';
import { uid } from '../core/ids.js';
import { createItem } from '../core/project.js';
import { addItems, updateSettings } from '../core/projectOps.js';
import { contentOrigin } from '../canvas/itemLayout.js';
import { buildGraph } from '../import/graphBuilder.js';
import { itemByPath, showImportWarnings } from './codeImport.js';
import { toast } from './toast.js';

// Importar arquivos .gd (cada um vira um script com nós) e a pasta de um projeto Godot
// (pastas e arquivos recriados; .gd viram nós; autoloads e ações do project.godot).

const COLUMNS = 4;
const GAP_X = 220;
const GAP_Y = 70;
const SKIP_DIRS = new Set(['.godot', '.import', '.git', '.vscode', '.idea']);
const SKIP_FILES = /\.(import|uid|tmp)$/i;

// ---------- arquivos .gd ----------

export function importScriptFiles(editor, parentId, world) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gd';
  input.multiple = true;
  input.addEventListener('change', async () => {
    const files = [...input.files];
    if (!files.length) return;
    const entries = await Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() })));
    const plan = { folders: [], files: entries.map((e) => ({ path: e.name, name: e.name, text: e.text })) };
    commit(editor, parentId, world, plan, null);
  });
  input.click();
}

// ---------- pasta do projeto Godot ----------

export async function importGodotFolder(editor, parentId, world) {
  if (typeof window.showDirectoryPicker !== 'function') {
    toast.warning(t('import.folderUnsupported'));
    return;
  }
  let root;
  try {
    root = await window.showDirectoryPicker({ mode: 'read' });
  } catch {
    return; // cancelado
  }
  const plan = { folders: [], files: [] };
  let projectFile = null;
  const walk = async (dir, prefix) => {
    for await (const handle of dir.values()) {
      const path = prefix ? `${prefix}/${handle.name}` : handle.name;
      if (handle.kind === 'directory') {
        if (SKIP_DIRS.has(handle.name) || handle.name.startsWith('.')) continue;
        plan.folders.push({ path, name: handle.name });
        await walk(handle, path);
      } else if (!SKIP_FILES.test(handle.name)) {
        const isScript = handle.name.toLowerCase().endsWith('.gd');
        const isProject = !prefix && handle.name === 'project.godot';
        const text = isScript || isProject ? await (await handle.getFile()).text() : null;
        if (isProject) projectFile = text;
        plan.files.push({ path, name: handle.name, text: isScript ? text : null });
      }
    }
  };
  try {
    await walk(root, '');
  } catch {
    toast.error(t('import.folderFailed'));
    return;
  }
  commit(editor, parentId, world, plan, projectFile);
}

// ---------- criação ----------

// plan: { folders: [{ path, name }], files: [{ path, name, text|null }] } — path relativo à raiz importada.
function commit(editor, parentId, world, plan, projectFile) {
  const project = editor.project;
  const items = [];
  const byPath = new Map(); // caminho relativo → item
  const reserved = new Set();
  const children = new Map(); // id do pai (ou '' p/ destino) → itens criados

  const parentOf = (path) => {
    const slash = path.lastIndexOf('/');
    return slash < 0 ? parentId : byPath.get(path.slice(0, slash))?.id ?? parentId;
  };
  const make = (kind, entry) => {
    const parent = parentOf(entry.path);
    // Só no destino pode haver nome repetido com o que já existe.
    const name = parent === parentId ? project.uniqueName(parentId, entry.name, reserved) : entry.name;
    if (parent === parentId) reserved.add(name.toLowerCase());
    const item = createItem({ kind, name, parentId: parent });
    items.push(item);
    byPath.set(entry.path, item);
    const key = parent ?? '';
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(item);
    return item;
  };
  // Pastas primeiro (pais antes dos filhos), depois os arquivos.
  for (const folder of [...plan.folders].sort((a, b) => a.path.split('/').length - b.path.split('/').length)) make('folder', folder);
  for (const file of plan.files) make('file', file);

  // Scripts → nós. preload("res://…") aponta para o item importado ou para um já existente.
  const warnings = [];
  for (const file of plan.files) {
    if (file.text === null || file.text === undefined) continue;
    const item = byPath.get(file.path);
    const resolvePath = (res) => byPath.get(res.replace(/^res:\/\//, ''))?.id ?? itemByPath(project, res);
    const result = buildGraph(file.text, { resolvePath });
    item.graph = result.graph;
    if (result.warnings.length) warnings.push({ item, count: result.warnings.length, list: result.warnings });
  }

  layout(project, editor, parentId, world, children);

  // Autoloads gravados nos itens novos antes de adicioná-los (desfazer remove tudo junto).
  const settingsPatch = projectFile ? godotSettings(project, projectFile, byPath) : null;
  for (const [item, name] of settingsPatch?.autoloads ?? []) item.autoload = name;
  editor.history.transaction(t('import.history'), () => {
    editor.history.execute(addItems(project, items, [], t('import.history')));
    if (settingsPatch?.patch) editor.history.execute(updateSettings(project, settingsPatch.patch, t('import.history')));
  });

  const scripts = plan.files.filter((f) => f.text !== null && f.text !== undefined).length;
  const total = warnings.reduce((sum, w) => sum + w.count, 0);
  toast.success(t('import.filesDone', { files: plan.files.length, folders: plan.folders.length, scripts, warnings: total }));
  if (warnings.length === 1) showImportWarnings(editor, warnings[0].item.id, warnings[0].list);
  else if (warnings.length) toast.info(t('import.warningsPerScript'));
}

// Grade simples: pastas antes de arquivos, 4 colunas, a partir do ponto clicado (ou abaixo do
// que já existe no destino).
function layout(project, editor, parentId, world, children) {
  for (const [key, list] of children) {
    list.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
    let x0 = 0;
    let y0 = 0;
    if ((key || null) === parentId) {
      const origin = contentOrigin(editor.layout, parentId);
      if (world) {
        x0 = world.x - origin.x;
        y0 = world.y - origin.y;
      } else {
        const existing = project.children(parentId);
        y0 = existing.length ? Math.max(...existing.map((c) => c.y)) + GAP_Y * 2 : 0;
      }
    }
    list.forEach((item, i) => {
      item.x = editor.snap(x0 + (i % COLUMNS) * GAP_X);
      item.y = editor.snap(y0 + Math.floor(i / COLUMNS) * GAP_Y);
    });
  }
}

// ---------- project.godot ----------

// Seções [autoload] e [input]: autoloads (nome → script importado) e ações do mapa de entrada.
function godotSettings(project, text, byPath) {
  const sections = parseIni(text);
  const autoloads = [];
  for (const [name, value] of Object.entries(sections.autoload ?? {})) {
    const path = String(value).replace(/^"\*?|"$/g, '').replace(/^\*/, '').replace(/^res:\/\//, '');
    const item = byPath.get(path);
    if (item) autoloads.push([item, name]);
  }
  const actions = Object.entries(sections.input ?? {}).map(([name, value]) => ({
    id: uid('act'),
    name,
    deadzone: Number(String(value).match(/"deadzone":\s*([\d.]+)/)?.[1] ?? 0.5),
    events: describeEvents(String(value)),
  }));
  const patch = {};
  if (autoloads.length) patch.autoloads = [...(project.settings.autoloads ?? []), ...autoloads.map(([item]) => item.id)];
  if (actions.length) {
    const existing = project.settings.inputMap ?? [];
    patch.inputMap = [...existing, ...actions.filter((a) => !existing.some((e) => e.name === a.name))];
  }
  return { patch: Object.keys(patch).length ? patch : null, autoloads };
}

// INI da Godot: [seção] e chave=valor, com valores que podem ocupar várias linhas ({ … }).
function parseIni(text) {
  const out = {};
  let section = '';
  let key = null;
  let value = '';
  let depth = 0;
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (key) {
      value += `\n${line}`;
      depth += count(line, '{[(') - count(line, '}])');
      if (depth <= 0) {
        (out[section] ??= {})[key] = value;
        key = null;
      }
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;
    const head = trimmed.match(/^\[(.+)\]$/);
    if (head) {
      section = head[1];
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    depth = count(v, '{[(') - count(v, '}])');
    if (depth > 0) {
      key = k;
      value = v;
    } else (out[section] ??= {})[k] = v;
  }
  return out;
}

function count(text, chars) {
  let n = 0;
  for (const ch of text) if (chars.includes(ch)) n++;
  return n;
}

const KEYS = { 32: 'Espaço', 4194305: 'Esc', 4194309: 'Enter', 4194306: 'Tab', 4194325: 'Shift', 4194326: 'Ctrl', 4194328: 'Alt', 4194319: '←', 4194320: '↑', 4194321: '→', 4194322: '↓' };

// Eventos do mapa de entrada em texto legível (Tecla W, Joypad botão 0, Mouse botão 1…).
function describeEvents(value) {
  const events = [];
  for (const m of value.matchAll(/Object\((InputEvent\w+),([^)]*)\)/g)) {
    const [, type, body] = m;
    const field = (name) => body.match(new RegExp(`"${name}":\\s*(-?[\\d.]+)`))?.[1];
    if (type === 'InputEventKey') {
      const code = Number(field('physical_keycode') || field('keycode') || 0);
      events.push(KEYS[code] ?? (code >= 48 && code <= 90 ? String.fromCharCode(code) : `Tecla ${code}`));
    } else if (type === 'InputEventJoypadButton') events.push(`Joypad botão ${field('button_index')}`);
    else if (type === 'InputEventJoypadMotion') events.push(`Joypad eixo ${field('axis')}${Number(field('axis_value')) < 0 ? '-' : '+'}`);
    else if (type === 'InputEventMouseButton') events.push(`Mouse botão ${field('button_index')}`);
    else events.push(type.replace('InputEvent', ''));
  }
  return events;
}
