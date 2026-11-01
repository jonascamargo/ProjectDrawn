import { bus } from '../core/events.js';
import { t } from '../i18n/i18n.js';
import { isVariableDeclaration, readGraph } from '../core/graph.js';
import { getDef } from '../lang/nodeRegistry.js';
import { withItemProfile } from '../lang/profileLoader.js';
import { nodeLabels, scopeTitle } from '../canvas/graphLayout.js';

// Busca no canvas (Ctrl+F): campo no centro da janela, por cima de tudo. Acha pastas,
// arquivos, comentários, funções/eventos, variáveis/sinais e qualquer nó do projeto.
// "/" separa um caminho: "player/mov" = dentro do que tem "player", o que tem "mov".
// Escolher um resultado abre as pastas/script no caminho, centraliza e seleciona.

const MAX_RESULTS = 120;
const GROUPS = ['items', 'scopes', 'declarations', 'nodes'];
let current = null;

export function isCanvasSearchOpen() {
  return current !== null;
}

export function closeCanvasSearch() {
  current?.close();
}

// Lista de tudo que pode ser achado: { group, label, sub, trail: [nomes acima], go() }.
function collect(editor) {
  const project = editor.project;
  const out = [];
  for (const item of project.items.values()) {
    const trail = [...project.ancestors(item.id)].reverse().map((a) => a.name);
    out.push({ group: 'items', label: item.name || '?', sub: trail.join('/'), trail, go: () => revealItem(editor, item.id) });
    const graph = readGraph(item);
    if (!graph.nodes.length) continue;
    const fileTrail = [...trail, item.name];
    withItemProfile(item, () => {
      const scopeName = new Map();
      for (const scope of graph.scopes) {
        const label = scopeTitle(graph, scope);
        scopeName.set(scope.id, label);
        out.push({ group: 'scopes', label, sub: fileTrail.join('/'), trail: fileTrail, go: () => editor.revealGraph(item.id, { scopeId: scope.id }) });
      }
      for (const node of graph.nodes) {
        const def = getDef(node.type);
        const inScope = node.scopeId ? scopeName.get(node.scopeId) : null;
        const nodeTrail = inScope ? [...fileTrail, inScope] : fileTrail;
        const go = () => editor.revealGraph(item.id, { nodeId: node.id });
        if (isVariableDeclaration(node) || node.type === 'signal.declare') {
          const keyword = node.type === 'signal.declare' ? 'signal' : node.type === 'var.const' ? 'const' : 'var';
          out.push({ group: 'declarations', label: node.fields?.name || '?', sub: `${keyword}${node.fields?.type ? ` · ${node.fields.type}` : ''} · ${nodeTrail.join('/')}`, trail: nodeTrail, go });
          continue;
        }
        if (def?.template === 'event' || node.type === 'func.entry' || node.type === 'core.reroute') continue;
        const { title, subtitle } = nodeLabels(graph, node, def);
        out.push({ group: 'nodes', label: title || node.type, sub: [subtitle, nodeTrail.join('/')].filter(Boolean).join(' · '), trail: nodeTrail, go });
      }
    });
  }
  return out;
}

// Abre as pastas acima do item, centraliza e seleciona.
function revealItem(editor, id) {
  let changed = false;
  for (const ancestor of editor.project.ancestors(id)) {
    if (!ancestor.expanded) changed = true;
    ancestor.expanded = true;
  }
  if (changed) bus.emit('project:changed', editor.project);
  editor.navigateTo(id);
}

const has = (text, term) => term.split(/\s+/).filter(Boolean).every((w) => text.includes(w));

// Último termo no nome; os anteriores, em ordem, em algum nome do caminho acima.
function matches(entry, terms) {
  if (!has(entry.label.toLowerCase(), terms[terms.length - 1])) return false;
  let at = 0;
  for (const term of terms.slice(0, -1)) {
    while (at < entry.trail.length && !has(entry.trail[at].toLowerCase(), term)) at++;
    if (at >= entry.trail.length) return false;
    at++;
  }
  return true;
}

export function openCanvasSearch(editor) {
  if (!editor.project) return;
  closeCanvasSearch();
  const all = collect(editor);
  const box = document.createElement('div');
  box.className = 'canvas-search';
  const input = document.createElement('input');
  input.className = 'field__input canvas-search__input';
  input.type = 'search';
  input.placeholder = t('canvasSearch.placeholder');
  input.spellcheck = false;
  const list = document.createElement('div');
  list.className = 'canvas-search__list';
  box.append(input, list);
  const backdrop = document.createElement('div');
  backdrop.className = 'canvas-search-backdrop';
  document.body.append(backdrop, box);

  let results = [];
  let active = 0;

  const render = () => {
    const terms = input.value.toLowerCase().split('/').map((s) => s.trim());
    const empty = !terms.some(Boolean);
    if (!terms[terms.length - 1]) terms[terms.length - 1] = '';
    results = empty ? [] : GROUPS.flatMap((g) => all.filter((e) => e.group === g && matches(e, terms))).slice(0, MAX_RESULTS);
    active = Math.min(active, Math.max(0, results.length - 1));
    list.replaceChildren();
    let lastGroup = null;
    results.forEach((entry, index) => {
      if (entry.group !== lastGroup) {
        const header = document.createElement('div');
        header.className = 'canvas-search__group';
        header.textContent = t(`canvasSearch.group.${entry.group}`);
        list.append(header);
        lastGroup = entry.group;
      }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'canvas-search__item';
      if (index === active) row.classList.add('canvas-search__item--active');
      const label = document.createElement('span');
      label.className = 'canvas-search__label';
      label.textContent = entry.label;
      const sub = document.createElement('span');
      sub.className = 'canvas-search__sub';
      sub.textContent = entry.sub;
      row.append(label, sub);
      row.addEventListener('mousedown', (event) => event.preventDefault());
      row.addEventListener('click', () => choose(entry));
      list.append(row);
    });
    if (!empty && !results.length) {
      const none = document.createElement('p');
      none.className = 'canvas-search__empty';
      none.textContent = t('launcher.noResults');
      list.append(none);
    }
    list.hidden = empty;
    list.querySelector('.canvas-search__item--active')?.scrollIntoView({ block: 'nearest' });
  };

  const choose = (entry) => {
    close();
    entry.go();
  };

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(0, Math.min(results.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
      render();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (results[active]) choose(results[active]);
    }
  };
  const onOutside = (event) => {
    if (!box.contains(event.target)) close();
  };

  function close() {
    document.removeEventListener('pointerdown', onOutside, true);
    backdrop.remove();
    box.remove();
    current = null;
  }

  input.addEventListener('input', () => {
    active = 0;
    render();
  });
  input.addEventListener('keydown', onKey);
  setTimeout(() => document.addEventListener('pointerdown', onOutside, true));
  render();
  input.focus();
  current = { close };
}
