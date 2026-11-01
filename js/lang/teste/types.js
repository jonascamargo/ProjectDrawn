// Tipos de dado da linguagem de teste: nome, etiqueta curta (tag no cabeçalho) e cor (pino, fio, tag).
export const types = {
  any: { label: 'any', tag: 'any', color: '#8f8f8f' },
  number: { label: 'number', tag: 'num', color: '#3d7bfd' },
  text: { label: 'text', tag: 'txt', color: '#4caf50' },
  bool: { label: 'bool', tag: 'bol', color: '#e3a21a' },
};

// Pode ligar uma saída do tipo `from` numa entrada do tipo `to`? Mesmo tipo, ou "any" de um dos lados.
export function canAssign(from, to) {
  return from === to || from === 'any' || to === 'any';
}
