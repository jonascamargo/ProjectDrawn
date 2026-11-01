// Nós da linguagem de teste: só para experimentar nós, pinos, fios e o inspetor.
// category: nome do grupo, mostrado no menu de criar nó.
// Pino: { id, label, kind: 'flow' | 'data' | 'condition' | 'config', type, max }.
// tag: tipo mostrado como etiqueta no cabeçalho; icon: ícone na etiqueta (ver icons.js);
// compact: nó de uma linha só.
// fields: propriedades editadas no inspetor:
//   { id, label, input: 'text' | 'type' | 'checkbox', default,
//     sets: 'title' | 'type'  (o valor vira o título do nó, ou o tipo dos pinos em `pins` e da tag),
//     infer: { field, from }  (marcado: o campo `field` vem do tipo do fio ligado na entrada `from`) }
export const nodes = [
  {
    id: 'start', title: 'Start', category: 'Flow', icon: 'event',
    outputs: [{ id: 'next', kind: 'flow' }],
  },
  {
    id: 'call', title: 'my_function', category: 'Flow', icon: 'function',
    inputs: [{ id: 'run', kind: 'flow' }],
    outputs: [{ id: 'next', kind: 'flow' }],
  },
  {
    id: 'repeat', title: 'Repeat', category: 'Flow', icon: 'loop',
    inputs: [{ id: 'run', kind: 'flow' }, { id: 'count', label: 'count', kind: 'data', type: 'number' }],
    outputs: [{ id: 'next', kind: 'flow' }, { id: 'body', label: 'body', kind: 'flow' }],
  },
  {
    id: 'print', title: 'Print', category: 'Flow',
    inputs: [{ id: 'run', kind: 'flow' }, { id: 'text', label: 'text', kind: 'data', type: 'text' }],
    outputs: [{ id: 'next', kind: 'flow' }],
  },
  {
    id: 'if', title: 'If', category: 'Flow',
    inputs: [{ id: 'run', kind: 'flow' }, { id: 'condition', label: 'condition', kind: 'condition' }],
    outputs: [{ id: 'true', label: 'true', kind: 'flow' }, { id: 'false', label: 'false', kind: 'flow' }],
  },
  {
    id: 'greater', title: 'Greater', category: 'Logic', icon: 'condition',
    inputs: [{ id: 'a', label: 'a', kind: 'data', type: 'number' }, { id: 'b', label: 'b', kind: 'data', type: 'number' }],
    outputs: [{ id: 'result', label: 'a > b', kind: 'condition' }],
  },
  {
    id: 'and', title: 'And', category: 'Logic', icon: 'condition',
    inputs: [{ id: 'a', label: 'a', kind: 'condition' }, { id: 'b', label: 'b', kind: 'condition' }],
    outputs: [{ id: 'result', label: 'a and b', kind: 'condition' }],
  },
  {
    id: 'add', title: 'Add', category: 'Math',
    inputs: [{ id: 'a', label: 'a', kind: 'data', type: 'number' }, { id: 'b', label: 'b', kind: 'data', type: 'number' }],
    outputs: [{ id: 'result', label: 'result', kind: 'data', type: 'number' }],
  },
  {
    id: 'variable', title: 'Variable', category: 'Data', tag: 'any',
    fields: [
      { id: 'name', label: 'Name', input: 'text', default: 'value', sets: 'title' },
      { id: 'type', label: 'Type', input: 'type', default: 'any', sets: 'type', pins: ['value'] },
      { id: 'infer', label: 'Infer type', input: 'checkbox', default: false, infer: { field: 'type', from: 'value' } },
    ],
    inputs: [
      { id: 'config', label: 'config', kind: 'config' },
      { id: 'value', label: 'value', kind: 'data', type: 'any' },
    ],
    outputs: [{ id: 'value', label: 'value', kind: 'data', type: 'any' }],
  },
  {
    id: 'number', title: 'height', category: 'Data', tag: 'number', compact: true,
    inputs: [{ id: 'set', kind: 'data', type: 'number' }],
    outputs: [{ id: 'get', kind: 'data', type: 'number' }],
  },
  {
    id: 'text', title: 'user', category: 'Data', tag: 'text', compact: true,
    outputs: [{ id: 'get', kind: 'data', type: 'text' }],
  },
  {
    id: 'to_text', title: 'To Text', category: 'Data',
    inputs: [{ id: 'value', label: 'value', kind: 'data', type: 'any' }],
    outputs: [{ id: 'text', label: 'text', kind: 'data', type: 'text' }],
  },
];
