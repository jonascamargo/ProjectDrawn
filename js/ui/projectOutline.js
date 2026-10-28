import { bus } from '../core/events.js';
import { t } from '../i18n/i18n.js';
import { functionEntry, readGraph } from '../core/graph.js';
import { currentProfile } from '../lang/profileLoader.js';
import { scopeTitle } from '../canvas/graphLayout.js';

// Aba "Projeto" do painel esquerdo: dados globais de cada script (class_name, extends,
// variáveis, constantes, sinais, funções, eventos, enums) e autoloads.
// Clique revela o item no canvas; arrastar para dentro do script cria o nó de uso.
export const SYMBOL_DRAG_TYPE = 'application/x-projectdrawn-symbol';

const ICONS = { class: '◆', var: '●', const: '■', signal: '⚡', func: 'ƒ', event: '▶', enum: '≡', autoload: '★' };

export class ProjectOutline {
  #frame = 0;

  constructor(root, editor) {
    this.root = root;
    this.editor = editor;
    this.search = el('input', 'field__input outline__search');
    this.search.type = 'search';
    this.search.placeholder = t('outline.search');
    this.list = el('div', 'outline__list');
    root.append(this.search, this.list, el('p', 'side-panel__hint', t('outline.hint')));
    this.search.addEventListener('input', () => this.render());
    const schedule = () => {
      if (!this.#frame) this.#frame = requestAnimationFrame(() => this.render());
    };
    bus.on('project:changed', schedule);
    bus.on('session:changed', schedule);
  }

  render() {
    this.#frame = 0;
    if (this.root.hidden) return;
    const project = this.editor.project;
    this.list.replaceChildren();
    if (!project) return;
    const query = this.search.value.trim().toLowerCase();
    const rootLabel = currentProfile()?.rootLabel ?? '';

    const autoloads = [...project.items.values()].filter((i) => i.tags?.some((tag) => tag.toLowerCase() === 'autoload'));
    if (autoloads.length) {
      const group = this.#group(t('outline.autoloads'));
      for (const item of autoloads) {
        if (query && !item.name.toLowerCase().includes(query)) continue;
        group.append(this.#row({ kind: 'autoload', label: item.name, sub: project.path(item.id, rootLabel), onClick: () => this.editor.navigateTo(item.id) }));
      }
      if (group.children.length > 1) this.list.append(group);
    }

    const scripts = [...project.items.values()]
      .filter((item) => this.editor.graph.isScript(item))
      .sort((a, b) => project.path(a.id).localeCompare(project.path(b.id)));
    for (const item of scripts) {
      const symbols = collectSymbols(item).filter((s) => !query || s.label.toLowerCase().includes(query));
      if (query && !symbols.length) continue;
      const group = this.#group(project.path(item.id, rootLabel));
      if (!symbols.length) group.append(el('p', 'side-panel__hint outline__empty', t('outline.noSymbols')));
      for (const symbol of symbols) {
        group.append(this.#row({
          ...symbol,
          onClick: () => this.editor.revealGraph(item.id, symbol.target),
          drag: symbol.draggable ? { fileId: item.id, kind: symbol.kind === 'const' ? 'var' : symbol.kind, id: symbol.id } : null,
        }));
      }
      this.list.append(group);
    }
    if (!this.list.children.length) this.list.append(el('p', 'side-panel__hint', query ? t('launcher.noResults') : t('outline.empty')));
  }

  #group(title) {
    const details = el('details', 'outline__group');
    details.open = true;
    details.append(el('summary', 'outline__summary', title));
    return details;
  }

  #row({ kind, label, sub, onClick, drag }) {
    const row = el('div', 'outline__row');
    row.append(el('span', `outline__icon outline__icon--${kind}`, ICONS[kind] ?? '•'), el('span', 'outline__label', label));
    if (sub) row.append(el('span', 'outline__sub', sub));
    row.title = drag ? t('outline.dragHint') : label;
    row.addEventListener('click', onClick);
    if (drag) {
      row.draggable = true;
      row.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData(SYMBOL_DRAG_TYPE, JSON.stringify(drag));
        event.dataTransfer.effectAllowed = 'copy';
      });
    }
    return row;
  }
}

// Símbolos globais de um script, na ordem em que aparecem no GDScript.
function collectSymbols(item) {
  const graph = readGraph(item);
  const out = [];
  const byType = (type) => graph.nodes.filter((n) => n.type === type);
  for (const n of byType('class.class_name')) out.push({ kind: 'class', label: `class_name ${n.fields?.name ?? ''}`, target: { nodeId: n.id } });
  for (const n of byType('class.extends')) out.push({ kind: 'class', label: `extends ${n.fields?.base ?? ''}`, target: { nodeId: n.id } });
  for (const n of byType('var.path')) out.push({ kind: 'const', label: n.fields?.name ?? '?', sub: n.fields?.mode === 'path' ? 'String' : 'preload', id: n.id, draggable: true, target: { nodeId: n.id } });
  for (const n of byType('var.const')) out.push({ kind: 'const', label: n.fields?.name ?? '?', sub: n.fields?.type || '', id: n.id, draggable: true, target: { nodeId: n.id } });
  for (const n of byType('var.member')) {
    const notes = [n.fields?.export && '@export', n.fields?.onready && '@onready'].filter(Boolean).join(' ');
    out.push({ kind: 'var', label: n.fields?.name ?? '?', sub: [notes, n.fields?.type].filter(Boolean).join(' '), id: n.id, draggable: true, target: { nodeId: n.id } });
  }
  for (const n of byType('signal.declare')) out.push({ kind: 'signal', label: n.fields?.name ?? '?', sub: (n.params ?? []).map((p) => p.name).join(', '), id: n.id, draggable: true, target: { nodeId: n.id } });
  for (const n of byType('class.enum')) out.push({ kind: 'enum', label: n.fields?.name ?? '?', target: { nodeId: n.id } });
  for (const scope of graph.scopes) {
    if (scope.kind === 'function') {
      const entry = functionEntry(graph, scope.id);
      out.push({ kind: 'func', label: `${entry?.fields?.name ?? '?'}()`, sub: entry?.fields?.returnType && entry.fields.returnType !== 'void' ? entry.fields.returnType : '', id: scope.id, draggable: true, target: { scopeId: scope.id } });
    } else {
      out.push({ kind: 'event', label: scopeTitle(graph, scope), target: { scopeId: scope.id } });
    }
  }
  return out;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
