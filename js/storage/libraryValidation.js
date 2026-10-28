import { LIBRARY_KINDS } from './libraryStore.js';

// Valida a estrutura de uma biblioteca. Retorna [{ key, params }] para traduzir com
// t(`libraries.errors.${key}`, params); lista vazia = válida.

const PIN_KINDS = ['flow', 'data'];
const TYPE_CATEGORIES = ['primitive', 'struct', 'object', 'container', 'any', 'void'];

export function validateLibrary(record) {
  const errors = [];
  const err = (key, params = {}) => errors.push({ key, params });

  if (!LIBRARY_KINDS.includes(record.kind)) err('kind');
  if (!String(record.name ?? '').trim()) err('name');
  const data = record.data;
  if (!data || typeof data !== 'object') {
    err('data');
    return errors;
  }

  if (record.kind === 'language') validateLanguage(data, err);
  else if (record.kind === 'catalog') validateCatalog(data, err);
  return errors;
}

function checkUnique(list, key, err, errorKey) {
  const seen = new Set();
  for (const entry of list) {
    const value = entry?.[key];
    if (!value) {
      err(`${errorKey}Missing`);
      continue;
    }
    if (seen.has(value)) err(`${errorKey}Duplicate`, { id: value });
    seen.add(value);
  }
}

function validateLanguage(data, err) {
  for (const field of ['types', 'nodes', 'fileTypes', 'relationTypes']) {
    if (data[field] !== undefined && !Array.isArray(data[field])) err('notArray', { field });
  }
  const types = data.types ?? [];
  const nodes = data.nodes ?? [];
  checkUnique(types, 'id', err, 'type');
  for (const type of types) {
    if (type.category && !TYPE_CATEGORIES.includes(type.category)) err('typeCategory', { id: type.id });
  }
  checkUnique(nodes, 'id', err, 'node');
  for (const node of nodes) {
    for (const side of ['inputs', 'outputs']) {
      const pins = node[side] ?? [];
      if (!Array.isArray(pins)) {
        err('notArray', { field: `${node.id}.${side}` });
        continue;
      }
      const ids = new Set();
      for (const pin of pins) {
        if (!pin.id) err('pinMissing', { node: node.id });
        else if (ids.has(pin.id)) err('pinDuplicate', { node: node.id, pin: pin.id });
        ids.add(pin.id);
        if (!PIN_KINDS.includes(pin.kind)) err('pinKind', { node: node.id, pin: pin.id ?? '?' });
      }
    }
  }
  checkUnique(data.relationTypes ?? [], 'id', err, 'relation');
  for (const fileType of data.fileTypes ?? []) {
    if (!Array.isArray(fileType.extensions)) err('fileTypeExtensions', { category: fileType.category ?? '?' });
  }
}

function validateCatalog(data, err) {
  if (!Array.isArray(data.classes)) {
    err('notArray', { field: 'classes' });
    return;
  }
  checkUnique(data.classes, 'name', err, 'class');
  const names = new Set(data.classes.map((c) => c.name));
  for (const cls of data.classes) {
    if (cls.inherits && !names.has(cls.inherits)) err('classInherits', { name: cls.name, base: cls.inherits });
  }
}
