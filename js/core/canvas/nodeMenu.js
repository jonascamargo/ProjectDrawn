import { t } from '../i18n.js';

// Menu de criar nó: campo de busca + lista, em HTML por cima do canvas. Mostra até LIMIT itens (a
// busca filtra o resto); itens searchOnly (ex.: métodos de todas as classes) só aparecem buscando.
const LIMIT = 200;

// Sem acento e minúsculo, para a busca achar "matematica" em "Matemática".
export function normalize(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Definições que casam com a busca (no título ou na categoria), título que começa com a busca primeiro.
export function filterNodes(defs, query) {
  const q = normalize(query.trim());
  if (!q) return [...defs];
  const hits = defs.filter((d) => normalize(`${d.title} ${d.category ?? ''}`).includes(q));
  const starts = (d) => (normalize(d.title).startsWith(q) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b));
}

// Categoria curta (a primeira palavra), para quando o nome do nó não deixa espaço:
// "Native methods" → "Native".
export function shortCategory(text) {
  return String(text ?? '').split(/\s+/)[0];
}

export class NodeMenu {
  // onPick(def, world, context): cria o nó escolhido no ponto onde o menu abriu
  // (context: o que foi passado ao abrir, ex.: a área e o pino de onde veio o fio).
  constructor(parent, { onPick }) {
    this.onPick = onPick;
    this.items = [];
    this.active = 0;
    this.world = null;
    this.defs = [];
    this.context = null;

    this.el = document.createElement('div');
    this.el.className = 'node-menu';
    this.el.hidden = true;
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = t('menu.search');
    this.list = document.createElement('ul');
    this.el.append(this.input, this.list);
    parent.append(this.el);

    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.list.addEventListener('pointerdown', (e) => {
      const li = e.target.closest('li');
      if (li) this.pick(Number(li.dataset.index));
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && !this.el.contains(e.target)) this.close();
    }, true);
  }

  // defs: os nós que o menu oferece (ex.: os aceitos na área, os que ligam com o fio solto).
  open(screen, world, { defs = [], context = null } = {}) {
    this.world = world;
    this.defs = defs;
    this.context = context;
    this.input.value = '';
    this.el.hidden = false;
    // Dentro da janela, mesmo abrindo perto da borda.
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    this.el.style.left = `${Math.min(screen.x, window.innerWidth - w - 8)}px`;
    this.el.style.top = `${Math.min(screen.y, window.innerHeight - h - 8)}px`;
    this.refresh();
    this.input.focus();
  }

  close() {
    this.el.hidden = true;
    this.input.blur();
  }

  refresh() {
    const query = this.input.value.trim();
    const hits = filterNodes(query ? this.defs : this.defs.filter((d) => !d.searchOnly), query);
    this.items = hits.slice(0, LIMIT);
    this.active = 0;
    this.list.replaceChildren(...this.items.map((def, i) => {
      const li = document.createElement('li');
      li.dataset.index = i;
      const title = document.createElement('span');
      title.textContent = def.title;
      const category = document.createElement('small');
      category.textContent = def.category ?? '';
      category.title = def.category ?? '';
      li.append(title, category);
      return li;
    }));
    // Nome grande: a categoria fica na versão curta (a completa na dica do mouse).
    for (const li of this.list.children) if (!this.fits(li)) li.children[1].textContent = shortCategory(li.children[1].title);
    if (!this.items.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = t('menu.empty');
      this.list.append(empty);
    }
    if (hits.length > LIMIT) {
      const more = document.createElement('li');
      more.className = 'empty';
      more.textContent = t('menu.more', { n: hits.length - LIMIT });
      this.list.append(more);
    }
    this.highlight();
  }

  // A linha cabe sem passar da largura do menu?
  fits(li) {
    return !(li.scrollWidth > li.clientWidth);
  }

  highlight() {
    [...this.list.children].forEach((li, i) => li.classList.toggle('active', i === this.active && this.items.length > 0));
    this.list.children[this.active]?.scrollIntoView({ block: 'nearest' });
  }

  onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.items.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      this.active = (this.active + step + this.items.length) % this.items.length;
      this.highlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.items.length) this.pick(this.active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  pick(index) {
    const def = this.items[index];
    if (!def) return;
    this.close();
    this.onPick(def, this.world, this.context);
  }
}
