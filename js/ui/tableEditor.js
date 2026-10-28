import { t } from '../i18n/i18n.js';

// Tabela editável genérica (linhas = objetos). Cada alteração muta a linha e chama onChange.
// Colunas: { key, label, type, options, placeholder, width, datalist }
//   type: text | number | color | select | checkbox | list (array ↔ "a, b") |
//         numbers (array de números) | json (qualquer valor ↔ JSON) | args (argumentos ↔ "a: int = 0, b")

export function createTableEditor({ columns, rows, readOnly = false, onChange, newRow = () => ({}), addLabel }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'table-editor';

  const table = document.createElement('table');
  table.className = 'table-editor__table';
  const head = document.createElement('tr');
  for (const column of columns) {
    const th = document.createElement('th');
    th.textContent = column.label;
    if (column.width) th.style.width = column.width;
    head.append(th);
  }
  if (!readOnly) head.append(document.createElement('th'));
  const thead = document.createElement('thead');
  thead.append(head);
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);
  wrapper.append(table);

  const renderRows = () => {
    tbody.replaceChildren();
    rows.forEach((row, index) => {
      const tr = document.createElement('tr');
      for (const column of columns) {
        const td = document.createElement('td');
        td.append(cellInput(column, row, readOnly, onChange));
        tr.append(td);
      }
      if (!readOnly) {
        const td = document.createElement('td');
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn--icon btn--ghost table-editor__remove';
        remove.title = t('libraries.removeRow');
        remove.textContent = '×';
        remove.addEventListener('click', () => {
          rows.splice(index, 1);
          renderRows();
          onChange?.();
        });
        td.append(remove);
        tr.append(td);
      }
      tbody.append(tr);
    });
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = columns.length + 1;
      td.className = 'table-editor__empty';
      td.textContent = t('libraries.emptyTable');
      tr.append(td);
      tbody.append(tr);
    }
  };
  renderRows();

  if (!readOnly) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn--ghost table-editor__add';
    add.textContent = addLabel ?? t('libraries.addRow');
    add.addEventListener('click', () => {
      rows.push(newRow());
      renderRows();
      onChange?.();
      tbody.lastElementChild?.querySelector('input, select')?.focus();
    });
    wrapper.append(add);
  }
  return wrapper;
}

function cellInput(column, row, readOnly, onChange) {
  const value = row[column.key];
  let input;

  if (column.type === 'select') {
    input = document.createElement('select');
    for (const option of column.options ?? []) {
      const opt = document.createElement('option');
      opt.value = typeof option === 'string' ? option : option.value;
      opt.textContent = typeof option === 'string' ? option || '—' : option.label;
      input.append(opt);
    }
    input.value = value ?? '';
  } else if (column.type === 'checkbox') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(value);
  } else {
    input = document.createElement('input');
    input.type = column.type === 'number' ? 'number' : column.type === 'color' ? 'color' : 'text';
    input.value = formatValue(column.type, value);
    if (column.placeholder) input.placeholder = column.placeholder;
    if (column.datalist) input.setAttribute('list', column.datalist);
    input.spellcheck = false;
    input.autocomplete = 'off';
  }
  input.className = 'table-editor__input';
  input.disabled = readOnly;

  input.addEventListener('change', () => {
    const next = column.type === 'checkbox' ? input.checked : parseValue(column.type, input.value);
    if (next === undefined || next === '' || (Array.isArray(next) && !next.length && column.optional)) delete row[column.key];
    else row[column.key] = next;
    onChange?.();
  });
  return input;
}

export function formatValue(type, value) {
  if (value === undefined || value === null) return type === 'color' ? '#888888' : '';
  switch (type) {
    case 'list':
    case 'numbers':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value);
    case 'args':
      return argsToText(value);
    default:
      return String(value);
  }
}

export function parseValue(type, text) {
  switch (type) {
    case 'number':
      return text === '' ? undefined : Number(text);
    case 'list':
      return text.split(',').map((s) => s.trim()).filter(Boolean);
    case 'numbers':
      return text.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
    case 'json':
      if (text.trim() === '') return undefined;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    case 'args':
      return textToArgs(text);
    default:
      return text;
  }
}

// [{ name, type, default }] ↔ "nome: tipo = padrão, outro: tipo"
export function argsToText(args = []) {
  return args
    .map((a) => `${a.name}${a.type ? `: ${a.type}` : ''}${a.default !== undefined ? ` = ${a.default}` : ''}`)
    .join(', ');
}

// Divide por vírgulas fora de parênteses/colchetes/chaves (ex.: "p = Vector2(0, 0), q").
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

export function textToArgs(text) {
  return splitTopLevel(text)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      const left = (eq >= 0 ? part.slice(0, eq) : part).trim();
      const def = eq >= 0 ? part.slice(eq + 1).trim() : undefined;
      const [name, type] = left.split(':').map((s) => s.trim());
      const arg = { name };
      if (type) arg.type = type;
      if (def !== undefined) arg.default = def;
      return arg;
    });
}
