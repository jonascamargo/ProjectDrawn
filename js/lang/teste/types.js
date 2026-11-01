// Tipos de dado da linguagem de teste e suas cores (a cor do pino vem daqui).
export const types = {
  any: { label: 'qualquer', color: '#a0a4ad' },
  number: { label: 'número', color: '#5fb3f9' },
  text: { label: 'texto', color: '#f07fa8' },
  bool: { label: 'bool', color: '#e35d5d' },
};

// Pode ligar uma saída do tipo `from` numa entrada do tipo `to`? Mesmo tipo, ou "qualquer" de um dos lados.
export function canAssign(from, to) {
  return from === to || from === 'any' || to === 'any';
}
