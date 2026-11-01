import { t } from '../i18n/i18n.js';
import { allowedTarget, searchEntries, typesCompatible } from '../lang/nodeRegistry.js';

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
    // Regra "aceita só" (anotações ligam só no valor de declarações e de outras anotações).
    if (filter.side === 'out' ? !allowedTarget(filter.onlyTo, entry.id, p.id) : filter.node && !allowedTarget(p.onlyTo, filter.node, filter.pin)) return false;
    if (p.kind !== 'data' || !filter.strict) return true;
    return filter.side === 'out' ? p.truthy || typesCompatible(filter.type, p.type) : filter.truthy || typesCompatible(p.type, filter.type);
  });
}

const hays = new WeakMap();
function haystack(entry, withValues = true) {
  const base = `${entry.title} ${entry.subtitle ?? ''} ${entry.category} ${(entry.keywords ?? []).join(' ')} ${entry.id}`.toLowerCase();
  if (!withValues || !entry.values) return base;
  if (!hays.has(entry)) hays.set(entry, `${base} ${entry.values.join(' ')}`.toLowerCase());
  return hays.get(entry);
}

function matches(entry, words) {
  if (!words.length) return true;
  const text = haystack(entry);
  return words.every((w) => text.includes(w));
}

// Enum: o valor digitado (ex.: "space" em Key → KEY_SPACE) já vem escolhido no nó.
function choiceOf(entry, words) {
  const fields = entry.fields ?? null;
  if (!entry.values || !words.length) return { id: entry.id, fields };
  const base = haystack(entry, false);
  const found = entry.values
    .filter((v) => {
      const name = v.toLowerCase();
      return words.some((w) => name.includes(w)) && words.every((w) => name.includes(w) || base.includes(w));
    })
    .sort((a, b) => a.length - b.length)[0];
  return { id: entry.id, fields: found ? { ...fields, item: found } : fields };
}

// Puxando um fio de um pino de tipo definido, o que é desse tipo aparece primeiro, mesmo
// sem digitar: da entrada, as constantes (Vector3.ZERO, UP…); da saída, os membros e
// métodos do tipo (x, length(), normalized()…).
function exactConstant(entry, filter) {
  if (!entry.catalog || !filter || filter.kind !== 'data' || !filter.type || ['Variant', '$T', '$field'].includes(filter.type)) return false;
  if (filter.side === 'in') return entry.id.startsWith('cat.const:') && entry.pins.out[0]?.type === filter.type;
  return entry.subtitle === filter.type && /^cat\.(cget|call|get|set):/.test(entry.id);
}

// base: false mostra só as entradas de `extra` (ex.: classes de nó numa cena).
export function openNodeSearch({ x, y, filter = null, extra = [], base = true }) {
  closeNodeSearch();
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'node-search';
    const input = document.createElement('input');
    input.className = 'field__input node-search__input';
    input.type = 'search';
    input.placeholder = filter ? t('graph.search.filtered', { type: filter.kind === 'flow' ? t('graph.flow') : filter.kind === 'tree' ? t('graph.tree') : filter.type ?? filter.kind }) : t('graph.search.placeholder');
    input.spellcheck = false;
    const list = document.createElement('div');
    list.className = 'node-search__list';
    box.append(input, list);
    document.body.append(box);

    const all = [...extra, ...(base ? searchEntries() : [])].filter((e) => compatible(e, filter));
    let results = [];
    let words = [];
    let active = 0;

    const render = () => {
      words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      // Sem busca, mostra só os nós da linguagem (o catálogo aparece ao digitar).
      const shown = all.filter((e) => (words.length || !e.catalog || exactConstant(e, filter)) && matches(e, words));
      results = [...shown.filter((e) => exactConstant(e, filter)), ...shown.filter((e) => !exactConstant(e, filter))].slice(0, MAX_RESULTS);
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
        const item = choiceOf(entry, words).fields?.item;
        if (entry.subtitle || item) {
          const sub = document.createElement('span');
          sub.className = 'node-search__sub';
          sub.textContent = [entry.subtitle, entry.values ? item : null].filter(Boolean).join(' · ');
          row.append(sub);
        }
        row.addEventListener('mousedown', (event) => event.preventDefault());
        row.addEventListener('click', () => close(choiceOf(entry, words)));
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
        if (results[active]) close(choiceOf(results[active], words));
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
