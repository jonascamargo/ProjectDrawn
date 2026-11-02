// Tipos da GDScript: Variant (qualquer), os tipos básicos e as classes da Godot (da API gerada em
// api/core.js). group: grupo no seletor de tipo; inherits: classe pai (para ligar Node2D em Node).
import { builtins, classes } from './api/core.js';

// Cor (pino, fio, etiqueta) e etiqueta curta dos tipos mais usados; os outros usam as padrão.
const COLORS = {
  bool: '#e3a21a', int: '#3d7bfd', float: '#6e5bff', String: '#4caf50', StringName: '#4caf50', NodePath: '#4caf50',
  Vector2: '#c45bd8', Vector2i: '#c45bd8', Vector3: '#a04bd8', Vector3i: '#a04bd8', Vector4: '#8a3fc4', Vector4i: '#8a3fc4',
  Color: '#e05a8a', Array: '#d9775a', Dictionary: '#c9a227',
};
const TAGS = {
  bool: 'bol', int: 'int', float: 'flt', String: 'str', StringName: 'sn', NodePath: 'np',
  Vector2: 'v2', Vector2i: 'v2i', Vector3: 'v3', Vector3i: 'v3i', Vector4: 'v4', Vector4i: 'v4i',
  Color: 'col', Array: 'arr', Dictionary: 'dic',
};
const EDITORS = { bool: 'bool', int: 'int', float: 'float', String: 'text', StringName: 'text', NodePath: 'text' };
const OTHER = '#7a8a99';
const OBJECT = '#3fa9a0';

export const types = { Variant: { label: 'Variant', tag: 'var', color: '#8f8f8f', group: 'Basic' } };
for (const b of builtins) {
  types[b.name] = {
    label: b.name,
    tag: TAGS[b.name] ?? b.name.slice(0, 3).toLowerCase(),
    color: COLORS[b.name] ?? OTHER,
    group: 'Basic',
    editor: b.components ? 'vector' : EDITORS[b.name],
    components: b.components,
    componentType: b.componentType,
  };
}
for (const [name, inherits] of classes) {
  types[name] = { label: name, tag: 'obj', color: OBJECT, group: 'Godot classes', inherits };
}

// Pode ligar `from` em `to`? Mesmo tipo, Variant de um dos lados, int em float, ou uma classe numa
// entrada de uma classe pai dela (Node2D → Node).
export function canAssign(from, to) {
  if (from === to || from === 'Variant' || to === 'Variant') return true;
  if (from === 'int' && to === 'float') return true;
  for (let c = types[from]?.inherits; c; c = types[c]?.inherits) if (c === to) return true;
  return false;
}
