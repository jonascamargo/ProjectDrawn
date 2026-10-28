import { t } from '../i18n/i18n.js';
import { searchEntries, typesCompatible } from '../lang/nodeRegistry.js';

// Busca de nós (clique direito, Tab ou fio solto no vazio).
// filter: { side: 'out'|'in', kind, type, strict } — mostra só nós com pino compatível.
// extra: entradas do contexto (ex.: parâmetros da função sob o ponteiro), mostradas primeiro.
// Resolve com { id, fields } da entrada escolhida ou null.

const MAX_RESULTS = 150;
let current = null;

export function closeNodeSearch() {
  current?.close(null);
}

export function isNodeSearchOpen() {
  return current !== null;
}

function compatible(entry, filter) {
  if (!filter) return true;
  const pins = filter.side === 'out' ? entry.pins.in : entry.pins.out;
  return pins.some((p) => {
    if (p.kind !== filter.kind) return false;
    if (p.kind === 'flow' || !filter.strict) return true;
    return filter.side === 'out' ? typesCompatible(filter.type, p.type) : typesCompatible(p.type, filter.type);
  });
}

function matches(entry, words) {
  if (!words.length) return true;
  const haystack = `${entry.title} ${entry.subtitle ?? ''} ${entry.category} ${(entry.keywords ?? []).join(' ')} ${entry.id}`.toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export function openNodeSearch({ x, y, filter = null, extra = [] }) {
  closeNodeSearch();
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'node-search';
    const input = document.createElement('input');
    input.className = 'field__input node-search__input';
    input.type = 'search';
    input.placeholder = filter ? t('graph.search.filtered', { type: filter.kind === 'flow' ? t('graph.flow') : filter.type }) : t('graph.search.placeholder');
    input.spellcheck = false;
    const list = document.createElement('div');
    list.className = 'node-search__list';
    box.append(input, list);
    document.body.append(box);

    const all = [...extra, ...searchEntries()].filter((e) => compatible(e, filter));
    let results = [];
    let active = 0;

    const render = () => {
      const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      // Sem busca, mostra só os nós da linguagem (o catálogo aparece ao digitar).
      results = all.filter((e) => (words.length || !e.catalog) && matches(e, words)).slice(0, MAX_RESULTS);
      active = Math.min(active, Math.max(0, results.length - 1));
      list.replaceChildren();
      let lastCategory = null;
      results.forEach((entry, index) => {
        if (entry.category !== lastCategory) {
          const header = document.createElement('div');
          header.className = 'node-search__category';
          header.textContent = entry.category || '—';
          list.append(header);
          lastCategory = entry.category;
        }
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'node-search__item';
        if (index === active) row.classList.add('node-search__item--active');
        const title = document.createElement('span');
        title.textContent = entry.title;
        row.append(title);
        if (entry.subtitle) {
          const sub = document.createElement('span');
          sub.className = 'node-search__sub';
          sub.textContent = entry.subtitle;
          row.append(sub);
        }
        row.addEventListener('mousedown', (event) => event.preventDefault());
        row.addEventListener('click', () => close({ id: entry.id, fields: entry.fields ?? null }));
        list.append(row);
      });
      if (!results.length) {
        const empty = document.createElement('p');
        empty.className = 'node-search__empty';
        empty.textContent = t('launcher.noResults');
        list.append(empty);
      }
      list.querySelector('.node-search__item--active')?.scrollIntoView({ block: 'nearest' });
    };

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        active = Math.max(0, Math.min(results.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
        render();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (results[active]) close({ id: results[active].id, fields: results[active].fields ?? null });
      }
    };
    const onOutside = (event) => {
      if (!box.contains(event.target)) close(null);
    };

    function close(value) {
      document.removeEventListener('pointerdown', onOutside, true);
      box.remove();
      current = null;
      resolve(value);
    }

    input.addEventListener('input', () => {
      active = 0;
      render();
    });
    input.addEventListener('keydown', onKey);
    setTimeout(() => document.addEventListener('pointerdown', onOutside, true));

    render();
    const rect = box.getBoundingClientRect();
    box.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    box.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
    input.focus();
    current = { close };
  });
}
