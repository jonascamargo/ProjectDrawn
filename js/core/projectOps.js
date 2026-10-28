import { bus } from './events.js';

// Fábricas de comandos para mutar o projeto (usadas com CommandStack.execute).
// Todos emitem 'project:changed' ao aplicar e ao desfazer.

function changed(project) {
  project.invalidate();
  bus.emit('project:changed', project);
}

export function addItems(project, items, relations = [], label) {
  return {
    label,
    do() {
      for (const item of items) project.items.set(item.id, item);
      for (const relation of relations) project.relations.set(relation.id, relation);
      changed(project);
    },
    undo() {
      for (const relation of relations) project.relations.delete(relation.id);
      for (const item of items) project.items.delete(item.id);
      changed(project);
    },
  };
}

// Remove os itens, seus descendentes e todas as relações que os tocam.
export function removeItems(project, ids, label) {
  const all = new Map();
  for (const id of ids) {
    const item = project.get(id);
    if (!item) continue;
    all.set(id, item);
    for (const d of project.descendants(id)) all.set(d.id, d);
  }
  const relations = project.relationsOf(new Set(all.keys()));
  return {
    label,
    do() {
      for (const relation of relations) project.relations.delete(relation.id);
      for (const id of all.keys()) project.items.delete(id);
      changed(project);
    },
    undo() {
      for (const [id, item] of all) project.items.set(id, item);
      for (const relation of relations) project.relations.set(relation.id, relation);
      changed(project);
    },
  };
}

// moves: [{ id, from: { x, y, parentId, z }, to: { x, y, parentId, z } }]
export function moveItems(project, moves, label) {
  const apply = (key) => {
    for (const move of moves) {
      const item = project.get(move.id);
      if (item) Object.assign(item, move[key]);
    }
    changed(project);
  };
  return { label, do: () => apply('to'), undo: () => apply('from') };
}

export function updateItem(project, id, patch, label) {
  const item = project.get(id);
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, item[key]]));
  return {
    label,
    do() {
      Object.assign(item, patch);
      changed(project);
    },
    undo() {
      Object.assign(item, previous);
      changed(project);
    },
  };
}

export function addRelation(project, relation, label) {
  return {
    label,
    do() {
      project.relations.set(relation.id, relation);
      changed(project);
    },
    undo() {
      project.relations.delete(relation.id);
      changed(project);
    },
  };
}

export function removeRelations(project, ids, label) {
  const relations = ids.map((id) => project.relations.get(id)).filter(Boolean);
  return {
    label,
    do() {
      for (const relation of relations) project.relations.delete(relation.id);
      changed(project);
    },
    undo() {
      for (const relation of relations) project.relations.set(relation.id, relation);
      changed(project);
    },
  };
}

export function updateRelation(project, id, patch, label) {
  const relation = project.relations.get(id);
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, relation[key]]));
  return {
    label,
    do() {
      Object.assign(relation, patch);
      changed(project);
    },
    undo() {
      Object.assign(relation, previous);
      changed(project);
    },
  };
}

// Altera configurações do projeto (ex.: autoloads, mapa de entrada).
export function updateSettings(project, patch, label) {
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, structuredClone(project.settings[key])]));
  const next = structuredClone(patch);
  return {
    label,
    do() {
      Object.assign(project.settings, structuredClone(next));
      changed(project);
    },
    undo() {
      Object.assign(project.settings, structuredClone(previous));
      changed(project);
    },
  };
}
