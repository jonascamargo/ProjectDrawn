import { t } from '../i18n/i18n.js';
import { uid } from '../core/ids.js';
import { updateItem, updateSettings } from '../core/projectOps.js';
import { bus } from '../core/events.js';
import { currentProfile, loadCatalogs, loadProfile } from '../lang/profileLoader.js';
import { fetchCatalogIndex, fetchLanguageIndex } from '../storage/projectService.js';
import { openModal } from './modal.js';
import { createTableEditor } from './tableEditor.js';
import { toast } from './toast.js';

// Configurações do projeto: Geral (nome, descrição, grade, validação, bibliotecas),
// Autoload (scripts globais, na ordem de carregamento) e Mapa de entrada (ações usadas
// pelo nó "Ação de entrada").
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Autoloads do projeto na ordem de carregamento: [{ item, name }].
export function autoloads(project) {
  const order = project.settings.autoloads ?? [];
  const index = (id) => {
    const i = order.indexOf(id);
    return i < 0 ? Infinity : i;
  };
  return [...project.items.values()]
    .filter((item) => item.autoload)
    .sort((a, b) => index(a.id) - index(b.id))
    .map((item) => ({ item, name: item.autoload }));
}

export function inputActions(project) {
  return project?.settings.inputMap ?? [];
}

// session: para checar nome único (todos os projetos, inclusive lixeira).
export async function openProjectSettings(editor, session) {
  const project = editor.project;
  if (!project) return;
  const [languages, catalogs, records] = await Promise.all([fetchLanguageIndex(), fetchCatalogIndex(), session.store.list()]);
  const rootLabel = currentProfile()?.rootLabel ?? '';
  const loads = autoloads(project).map(({ item, name }) => ({ id: item.id, name }));
  const actions = structuredClone(inputActions(project));

  const content = el('div', 'project-settings');
  const tabs = el('div', 'side-tabs');
  const panes = {};
  const show = (name) => {
    for (const tab of tabs.children) tab.classList.toggle('side-tabs__tab--active', tab.dataset.tab === name);
    for (const [key, pane] of Object.entries(panes)) pane.hidden = key !== name;
  };
  for (const name of ['general', 'autoload', 'input']) {
    const tab = el('button', 'side-tabs__tab', t(`projectSettings.tab.${name}`));
    tab.type = 'button';
    tab.dataset.tab = name;
    tab.addEventListener('click', () => show(name));
    tabs.append(tab);
    panes[name] = el('div', 'project-settings__pane');
  }
  content.append(tabs, panes.general, panes.autoload, panes.input);

  // ---------- Geral ----------
  const s = project.settings;
  const used = new Set((project.libraries ?? []).map((ref) => ref.id));
  const general = {
    name: input('text', project.name),
    description: textarea(project.description ?? ''),
    gridSize: input('number', s.gridSize ?? 20),
    snap: checkbox(s.snap !== false),
    showGrid: checkbox(s.showGrid !== false),
    strictTypes: checkbox(s.strictTypes !== false),
    language: select(languages.map((l) => [l.id, `${l.name} (v${l.version})`]), project.languageProfile),
    catalogs: catalogs.map((c) => ({ id: c.id, version: c.version, box: checkbox(used.has(c.id)), label: `${c.name} (v${c.version})` })),
  };
  general.gridSize.min = 4;
  general.gridSize.step = 1;
  panes.general.append(
    labeled(t('projectSettings.name'), general.name),
    labeled(t('projectSettings.description'), general.description),
    section(t('projectSettings.canvas')),
    labeled(t('projectSettings.gridSize'), general.gridSize),
    inline(general.snap, t('projectSettings.snap')),
    inline(general.showGrid, t('projectSettings.showGrid')),
    inline(general.strictTypes, t('projectSettings.strictTypes')),
    el('p', 'side-panel__hint', t('projectSettings.strictHint')),
    section(t('projectSettings.libraries')),
    labeled(t('launcher.language'), general.language),
    ...(general.catalogs.length ? general.catalogs.map((c) => inline(c.box, c.label)) : [el('p', 'side-panel__hint', t('libraries.noCatalogs'))]),
  );

  // ---------- Autoload ----------
  const renderLoads = () => {
    const pane = panes.autoload;
    pane.replaceChildren(el('p', 'side-panel__hint', t('projectSettings.autoloadHint')));
    loads.forEach((load, i) => {
      const line = el('div', 'project-settings__row');
      const up = button('↑', t('projectSettings.moveUp'), () => {
        [loads[i - 1], loads[i]] = [loads[i], loads[i - 1]];
        renderLoads();
      });
      up.disabled = i === 0;
      const down = button('↓', t('projectSettings.moveDown'), () => {
        [loads[i + 1], loads[i]] = [loads[i], loads[i + 1]];
        renderLoads();
      });
      down.disabled = i === loads.length - 1;
      const name = el('input', 'field__input');
      name.value = load.name;
      name.spellcheck = false;
      name.addEventListener('input', () => (load.name = name.value.trim()));
      const remove = button('×', t('projectSettings.removeAutoload'), () => {
        loads.splice(i, 1);
        renderLoads();
      });
      line.append(up, down, name, el('span', 'outline__sub', project.path(load.id, rootLabel)), remove);
      pane.append(line);
    });
    if (!loads.length) pane.append(el('p', 'side-panel__hint', t('projectSettings.noAutoloads')));
    const scripts = [...project.items.values()].filter((item) => editor.graph.isScript(item) && !loads.some((l) => l.id === item.id));
    if (scripts.length) {
      const add = el('div', 'project-settings__row');
      const select = el('select', 'field__input');
      for (const item of scripts) select.append(option(item.id, project.path(item.id, rootLabel)));
      add.append(select, button('+', t('projectSettings.addAutoload'), () => {
        const item = project.get(select.value);
        loads.push({ id: item.id, name: pascalCase(item.name.replace(/\.[^.]+$/, '')) });
        renderLoads();
      }));
      pane.append(add);
    }
  };
  renderLoads();

  // ---------- Mapa de entrada ----------
  panes.input.append(
    el('p', 'side-panel__hint', t('projectSettings.inputHint')),
    createTableEditor({
      rows: actions,
      onChange: () => {},
      addLabel: t('projectSettings.addAction'),
      newRow: () => ({ id: uid('act'), name: `acao_${actions.length + 1}`, deadzone: 0.5, events: [] }),
      columns: [
        { key: 'name', label: t('projectSettings.col.action') },
        { key: 'deadzone', label: t('projectSettings.col.deadzone'), type: 'number' },
        { key: 'events', label: t('projectSettings.col.events'), type: 'list', placeholder: t('projectSettings.eventsPlaceholder') },
      ],
    }),
  );
  show('general');

  const result = await openModal({ title: t('projectSettings.title'), content, width: '680px' });
  if (!result) return;

  const name = general.name.value.trim();
  const taken = records.some((r) => r.id !== session.record?.id && r.name.trim().toLowerCase() === name.toLowerCase());
  const problem = !name ? t('projectSettings.emptyName') : taken ? t('launcher.nameTaken') : validate(loads, actions);
  if (problem) {
    toast.warning(problem);
    return;
  }
  editor.history.transaction(t('projectSettings.history'), () => {
    const desired = new Map(loads.map((l) => [l.id, l.name]));
    for (const item of project.items.values()) {
      const next = desired.get(item.id) ?? null;
      if ((item.autoload ?? null) !== next) editor.history.execute(updateItem(project, item.id, { autoload: next }, t('projectSettings.history')));
    }
    editor.history.execute(updateSettings(project, {
      autoloads: loads.map((l) => l.id),
      inputMap: actions,
      gridSize: Math.max(4, Math.round(Number(general.gridSize.value) || 20)),
      snap: general.snap.checked,
      showGrid: general.showGrid.checked,
      strictTypes: general.strictTypes.checked,
    }, t('projectSettings.history')));
  });

  // Nome, descrição e bibliotecas (fora do desfazer, como no launcher).
  const renamed = name !== project.name;
  project.name = name;
  project.description = general.description.value;
  if (renamed) window.history.replaceState(null, '', `#/projeto/${encodeURIComponent(name)}`);
  const chosen = general.catalogs.filter((c) => c.box.checked).map((c) => ({ id: c.id, version: c.version }));
  const librariesChanged = general.language.value !== project.languageProfile || chosen.map((c) => c.id).join() !== (project.libraries ?? []).map((r) => r.id).join();
  if (librariesChanged) {
    project.languageProfile = general.language.value;
    project.libraries = chosen;
    await loadProfile(project.languageProfile).catch(() => toast.error(t('errors.profileLoad')));
    const { missing } = await loadCatalogs(chosen);
    if (missing.length) toast.warning(t('libraries.missingCatalogs', { count: missing.length }));
  }
  bus.emit('project:changed', project);
  toast.success(t('projectSettings.saved'));
}

function validate(loads, actions) {
  const names = new Set();
  for (const l of loads) {
    if (!IDENTIFIER.test(l.name)) return t('projectSettings.invalidName', { name: l.name || '—' });
    if (names.has(l.name)) return t('projectSettings.duplicateName', { name: l.name });
    names.add(l.name);
  }
  const actionNames = new Set();
  for (const a of actions) {
    a.name = String(a.name ?? '').trim();
    if (!a.name) return t('projectSettings.emptyAction');
    if (actionNames.has(a.name)) return t('projectSettings.duplicateAction', { name: a.name });
    actionNames.add(a.name);
  }
  return null;
}

export function pascalCase(text) {
  const out = String(text).split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
  return /^\d/.test(out) ? `_${out}` : out || 'Global';
}

function input(type, value) {
  const node = el('input', 'field__input');
  node.type = type;
  node.value = value;
  node.spellcheck = false;
  return node;
}

function textarea(value) {
  const node = el('textarea', 'field__input');
  node.rows = 2;
  node.value = value;
  return node;
}

function checkbox(checked) {
  const node = el('input');
  node.type = 'checkbox';
  node.checked = checked;
  return node;
}

function select(options, value) {
  const node = el('select', 'field__input');
  for (const [v, label] of options) node.append(option(v, label));
  node.value = value;
  return node;
}

function labeled(label, control) {
  const wrap = el('label', 'field');
  wrap.append(el('span', 'field__label', label), control);
  return wrap;
}

function inline(control, label) {
  const wrap = el('label', 'project-settings__check');
  wrap.append(control, el('span', null, label));
  return wrap;
}

function section(title) {
  return el('h4', 'inspector__section', title);
}

function button(text, title, onClick) {
  const b = el('button', 'btn btn--icon', text);
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function option(value, label) {
  const o = el('option', null, label);
  o.value = value;
  return o;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
