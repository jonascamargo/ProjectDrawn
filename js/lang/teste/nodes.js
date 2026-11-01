// Nós da linguagem de teste: só para experimentar nós, pinos, fios e o inspetor.
// category: nome do grupo, mostrado no menu de criar nó.
// Pino: { id, label, kind: 'flow' | 'data' | 'condition' | 'config', type, max }.
// tag: tipo mostrado como etiqueta no cabeçalho; icon: ícone na etiqueta (ver icons.js);
// compact: nó de uma linha só.
// area: contém outros nós (pasta, arquivo, classe, função); contains: o que aceita dentro
//   (ids de definição, ou '@script' = qualquer nó comum). script: o arquivo é um ambiente de script
//   (só nele existem nós de script); pathable: solto num script vira um nó de caminho.
// fields: propriedades editadas no inspetor:
//   { id, label, input: 'text' | 'type' | 'checkbox' | 'color', default,
//     sets: 'title' | 'type'  (o valor vira o título do nó, ou o tipo dos pinos em `pins` e da tag),
//     infer: { field, from }  (marcado: o campo `field` vem do tipo do fio ligado na entrada `from`) }
const name = (value) => ({ id: 'name', label: 'Name', input: 'text', default: value, sets: 'title' });

export const nodes = [
  {
    id: 'folder', title: 'folder', category: 'Project', icon: 'folder', area: true, pathable: true, contains: ['folder', 'file'],
    fields: [name('folder'), { id: 'color', label: 'Color', input: 'color', default: null }],
  },
  {
    id: 'file', title: 'script.gd', category: 'Project', icon: 'file', area: true, script: true, pathable: true,
    contains: ['class', 'function', '@script'],
    fields: [name('script.gd')],
  },
  {
    id: 'class', title: 'MyClass', category: 'Script', icon: 'class', area: true, contains: ['function', '@script'],
    fields: [name('MyClass')],
  },
  {
    id: 'function', title: '_ready', category: 'Script', icon: 'function', area: true, contains: ['@script'],
    fields: [name('_ready')],
    outputs: [{ id: 'next', kind: 'flow' }],
  },
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
    // Endereço de uma pasta/arquivo, criado ao soltar a pasta/arquivo num script.
    id: 'path', title: 'res://', category: 'Data', tag: 'text', compact: true,
    fields: [{ id: 'path', label: 'Path', input: 'text', default: 'res://', sets: 'title' }],
    outputs: [{ id: 'path', kind: 'data', type: 'text' }],
  },
  {
    id: 'to_text', title: 'To Text', category: 'Data',
    inputs: [{ id: 'value', label: 'value', kind: 'data', type: 'any' }],
    outputs: [{ id: 'text', label: 'text', kind: 'data', type: 'text' }],
  },
];
