import { normalize } from '../core/canvas/nodeMenu.js';
import { t } from '../core/i18n.js';

// Seletor de tipo com busca, para listas longas (a GDScript tem mais de mil tipos): abre embaixo do
// botão, com um campo de busca e a lista em grupos (Basic, Godot classes…). Um só por painel.
const LIMIT = 100; // itens mostrados de uma vez em cada grupo (a busca filtra o resto)

export class TypePicker {
  constructor(parent) {
    this.el = document.createElement('div');
    this.el.className = 'type-picker';
    this.el.hidden = true;
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = t('types.search');
    this.list = document.createElement('ul');
    this.el.append(this.input, this.list);
    parent.append(this.el);
    this.items = [];
    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.items.length) {
        e.preventDefault();
        this.pick(0);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.list.addEventListener('pointerdown', (e) => {
      const li = e.target.closest('li');
      if (li?.dataset.index != null) this.pick(Number(li.dataset.index));
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && !this.el.contains(e.target) && e.target !== this.anchor) this.close();
    }, true);
  }

  // types: { id: { label, group } }; none: texto da opção "sem tipo" (valor null), ou nada.
  open(anchor, { types, value = null, none = null, onPick }) {
    this.anchor = anchor;
    this.options = [
      ...(none ? [{ id: null, label: none, group: 'Basic' }] : []),
      ...Object.entries(types).map(([id, def]) => ({ id, label: def.label ?? id, group: def.group ?? 'Basic' })),
    ];
    this.value = value;
    this.onPick = onPick;
    this.input.value = '';
    this.el.hidden = false;
    const r = anchor.getBoundingClientRect?.();
    if (r) {
      this.el.style.left = `${r.left}px`;
      this.el.style.top = `${r.bottom + 4}px`;
      this.el.style.minWidth = `${r.width}px`;
    }
    this.refresh();
    this.input.focus();
  }

  close() {
    this.el.hidden = true;
    this.input.blur();
  }

  // Os que casam com a busca (começando com ela primeiro), em grupos, até LIMIT em cada um. O grupo
  // do tipo escolhido vem primeiro (ex.: escolhido Node2D: Godot classes no topo), com ele no começo.
  refresh() {
    const q = normalize(this.input.value.trim());
    const hits = this.options.filter((o) => normalize(o.label).includes(q));
    const starts = (o) => (normalize(o.label).startsWith(q) ? 0 : 1);
    const current = this.options.find((o) => o.id === this.value)?.group;
    const groups = [...new Set([current, ...this.options.map((o) => o.group)].filter(Boolean))];
    const rank = (o) => (o.id === this.value ? -1 : starts(o));
    const inGroups = groups.map((g) => hits.filter((o) => o.group === g).sort((a, b) => rank(a) - rank(b)));
    this.items = inGroups.flatMap((list) => list.slice(0, LIMIT));
    const hidden = hits.length - this.items.length;
    const rows = [];
    let group = null;
    this.items.forEach((o, i) => {
      if (o.group !== group) {
        group = o.group;
        const head = document.createElement('li');
        head.className = 'group';
        head.textContent = group;
        rows.push(head);
      }
      const li = document.createElement('li');
      li.dataset.index = i;
      li.textContent = o.label;
      if (o.id === this.value) li.className = 'active';
      rows.push(li);
    });
    if (!this.items.length) rows.push(Object.assign(document.createElement('li'), { className: 'empty', textContent: t('types.empty') }));
    if (hidden) rows.push(Object.assign(document.createElement('li'), { className: 'empty', textContent: t('types.more', { n: hidden }) }));
    this.list.replaceChildren(...rows);
  }

  pick(index) {
    const option = this.items[index];
    if (!option) return;
    this.close();
    this.onPick(option.id);
  }
}
