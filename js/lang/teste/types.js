// Tipos de dado da linguagem de teste: nome, etiqueta curta (tag no cabeçalho), cor (pino, fio, tag)
// e editor do valor digitado no pino ('int', 'float', 'bool', 'text', 'vector'; sem editor: sem valor).
// components + componentType: o pino pode ser aberto, um pino por componente (ex.: Vector3 → x, y, z).
export const types = {
  any: { label: 'any', tag: 'any', color: '#8f8f8f' },
  int: { label: 'int', tag: 'int', color: '#3d7bfd', editor: 'int' },
  float: { label: 'float', tag: 'flt', color: '#6e5bff', editor: 'float' },
  bool: { label: 'bool', tag: 'bol', color: '#e3a21a', editor: 'bool' },
  text: { label: 'text', tag: 'txt', color: '#4caf50', editor: 'text' },
  vector2: { label: 'Vector2', tag: 'vc2', color: '#c45bd8', editor: 'vector', components: ['x', 'y'], componentType: 'float' },
  vector3: { label: 'Vector3', tag: 'vc3', color: '#a04bd8', editor: 'vector', components: ['x', 'y', 'z'], componentType: 'float' },
};

// Pode ligar uma saída do tipo `from` numa entrada do tipo `to`? Mesmo tipo, "any" de um dos lados,
// ou int numa entrada float (como no GDScript).
export function canAssign(from, to) {
  return from === to || from === 'any' || to === 'any' || (from === 'int' && to === 'float');
}
