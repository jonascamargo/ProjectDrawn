import { t } from '../i18n/i18n.js';
import { uid } from '../core/ids.js';
import { updateItem, updateSettings } from '../core/projectOps.js';
import { currentProfile } from '../lang/profileLoader.js';
import { openModal } from './modal.js';
import { createTableEditor } from './tableEditor.js';
import { toast } from './toast.js';

// Configurações do projeto: Autoload (scripts globais, na ordem de carregamento) e
// Mapa de entrada (ações usadas pelo nó "Ação de entrada").
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

export async function openProjectSettings(editor) {
  const project = editor.project;
  if (!project) return;
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
  for (const name of ['autoload', 'input']) {
    const tab = el('button', 'side-tabs__tab', t(`projectSettings.tab.${name}`));
    tab.type = 'button';
    tab.dataset.tab = name;
    tab.addEventListener('click', () => show(name));
    tabs.append(tab);
    panes[name] = el('div', 'project-settings__pane');
  }
  content.append(tabs, panes.autoload, panes.input);

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
  show('autoload');

  const result = await openModal({ title: t('projectSettings.title'), content, width: '680px' });
  if (!result) return;

  const problem = validate(loads, actions);
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
    editor.history.execute(updateSettings(project, { autoloads: loads.map((l) => l.id), inputMap: actions }, t('projectSettings.history')));
  });
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
