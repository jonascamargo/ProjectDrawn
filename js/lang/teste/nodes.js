// Nós da linguagem de teste: só para experimentar nós, pinos e (na 1c) fios.
// Pino: { id, label, kind: 'flow' | 'data' | 'condition' | 'config', type, max }.
export const categories = {
  Fluxo: { color: '#7a3b3b' },
  Lógica: { color: '#7a5a2f' },
  Matemática: { color: '#2f5d7a' },
  Dados: { color: '#3d6b45' },
};

export const nodes = [
  {
    id: 'start', title: 'Início', category: 'Fluxo',
    outputs: [{ id: 'next', kind: 'flow' }],
  },
  {
    id: 'print', title: 'Imprimir', category: 'Fluxo',
    inputs: [{ id: 'run', kind: 'flow' }, { id: 'text', label: 'texto', kind: 'data', type: 'text' }],
    outputs: [{ id: 'next', kind: 'flow' }],
  },
  {
    id: 'if', title: 'Se', category: 'Fluxo',
    inputs: [{ id: 'run', kind: 'flow' }, { id: 'condition', label: 'condição', kind: 'condition' }],
    outputs: [{ id: 'true', label: 'verdadeiro', kind: 'flow' }, { id: 'false', label: 'falso', kind: 'flow' }],
  },
  {
    id: 'greater', title: 'Maior que', category: 'Lógica',
    inputs: [{ id: 'a', label: 'a', kind: 'data', type: 'number' }, { id: 'b', label: 'b', kind: 'data', type: 'number' }],
    outputs: [{ id: 'result', label: 'a > b', kind: 'condition' }],
  },
  {
    id: 'and', title: 'E', category: 'Lógica',
    inputs: [{ id: 'a', label: 'a', kind: 'condition' }, { id: 'b', label: 'b', kind: 'condition' }],
    outputs: [{ id: 'result', label: 'a e b', kind: 'condition' }],
  },
  {
    id: 'add', title: 'Somar', category: 'Matemática',
    inputs: [{ id: 'a', label: 'a', kind: 'data', type: 'number' }, { id: 'b', label: 'b', kind: 'data', type: 'number' }],
    outputs: [{ id: 'result', label: 'resultado', kind: 'data', type: 'number' }],
  },
  {
    id: 'variable', title: 'Variável', category: 'Dados',
    inputs: [{ id: 'config', label: 'configuração', kind: 'config' }],
    outputs: [{ id: 'value', label: 'valor', kind: 'data', type: 'any' }],
  },
  {
    id: 'to_text', title: 'Para texto', category: 'Dados',
    inputs: [{ id: 'value', label: 'valor', kind: 'data', type: 'any' }],
    outputs: [{ id: 'text', label: 'texto', kind: 'data', type: 'text' }],
  },
];
