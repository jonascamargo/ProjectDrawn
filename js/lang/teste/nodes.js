// Nós da linguagem de teste: só para experimentar nós, pinos, fios e o inspetor.
// concept: o conceito que o nó veste (ver js/core/concepts); dele vêm as regras de área, o que a
//   área contém, referências, etc. O nó pode trocar uma regra do conceito (ex.: contains).
// category: nome do grupo, mostrado no menu de criar nó.
// Pino: { id, label, kind: 'flow' | 'data' | 'condition' | 'config', type, max, when }.
// tag: tipo mostrado como etiqueta no cabeçalho; icon: ícone na etiqueta (ver icons.js);
// compact: nó de uma linha só.
// fields: propriedades editadas no inspetor:
//   { id, label, input: 'text' | 'type' | 'checkbox' | 'color' | 'params' | 'filename' | 'class', default,
//     none: (input 'type') texto da opção "sem tipo" (valor null), ex.: 'void';
//     sets: 'title' | 'type'  (o valor vira o título do nó, ou o tipo dos pinos em `pins` e da tag),
//     infer: { field, from }  (marcado: o campo `field` vem do tipo do fio ligado na entrada `from`) }
const name = (value) => ({ id: 'name', label: 'Name', input: 'text', default: value, sets: 'title' });

export const nodes = [
  {
    id: 'class', concept: 'class', title: 'MyClass', category: 'Script', icon: 'class',
    fields: [name('MyClass'), { id: 'extends', label: 'Extends', input: 'class', default: null }],
  },
  {
    // Função personalizada; os métodos nativos (natives.js) aparecem no menu com o nome deles.
    id: 'function', concept: 'function', title: 'Function', category: 'Script', icon: 'function',
    fields: [
      name('my_function'),
      { id: 'params', label: 'Parameters', input: 'params', default: [] },
      { id: 'returns', label: 'Return type', input: 'type', none: 'void', default: null },
    ],
    outputs: [{ id: 'next', kind: 'flow' }],
  },
  {
    id: 'start', concept: 'event', title: 'Start', category: 'Flow', icon: 'event',
    outputs: [{ id: 'next', kind: 'flow' }],
  },
  {
    // Chamada a uma Function (Ctrl+clique nela): nome, parâmetros e retorno vêm dela.
    id: 'call', concept: 'call', title: 'call', category: 'Flow', icon: 'function',
    inputs: [{ id: 'run', kind: 'flow' }],
    outputs: [{ id: 'next', kind: 'flow' }],
  },
  {
    // Parâmetro da Function (arrastado do inspetor dela): nome e tipo vêm do parâmetro.
    id: 'param', concept: 'parameter', title: 'param', category: 'Data', tag: 'any', compact: true,
    outputs: [{ id: 'value', kind: 'data', type: 'any' }],
  },
  {
    // Só dentro de uma Function; o pino value segue o tipo de retorno dela (void: sem o pino).
    id: 'return', concept: 'return', title: 'Return', category: 'Flow',
    inputs: [{ id: 'run', kind: 'flow' }, { id: 'value', label: 'value', kind: 'data', type: 'any', when: 'returns' }],
  },
  {
    id: 'repeat', concept: 'loop', title: 'Repeat', category: 'Flow', icon: 'loop',
    inputs: [{ id: 'run', kind: 'flow' }, { id: 'count', label: 'count', kind: 'data', type: 'int' }],
    outputs: [{ id: 'next', kind: 'flow' }, { id: 'body', label: 'body', kind: 'flow' }],
  },
  {
    id: 'print', concept: 'builtin', title: 'Print', category: 'Flow',
    inputs: [{ id: 'run', kind: 'flow' }, { id: 'text', label: 'text', kind: 'data', type: 'text' }],
    outputs: [{ id: 'next', kind: 'flow' }],
  },
  {
    id: 'if', concept: 'branch', title: 'If', category: 'Flow',
    inputs: [{ id: 'run', kind: 'flow' }, { id: 'condition', label: 'condition', kind: 'condition' }],
    outputs: [{ id: 'true', label: 'true', kind: 'flow' }, { id: 'false', label: 'false', kind: 'flow' }],
  },
  {
    id: 'greater', concept: 'operator', title: 'Greater', category: 'Logic', icon: 'condition',
    inputs: [{ id: 'a', label: 'a', kind: 'data', type: 'float' }, { id: 'b', label: 'b', kind: 'data', type: 'float' }],
    outputs: [{ id: 'result', label: 'a > b', kind: 'condition' }],
  },
  {
    id: 'and', concept: 'operator', title: 'And', category: 'Logic', icon: 'condition',
    inputs: [{ id: 'a', label: 'a', kind: 'condition' }, { id: 'b', label: 'b', kind: 'condition' }],
    outputs: [{ id: 'result', label: 'a and b', kind: 'condition' }],
  },
  {
    id: 'add', concept: 'operator', title: 'Add', category: 'Math',
    inputs: [{ id: 'a', label: 'a', kind: 'data', type: 'float' }, { id: 'b', label: 'b', kind: 'data', type: 'float' }],
    outputs: [{ id: 'result', label: 'result', kind: 'data', type: 'float' }],
  },
  {
    id: 'variable', concept: 'variable', title: 'Variable', category: 'Data', tag: 'any',
    fields: [
      { id: 'name', label: 'Name', input: 'text', default: 'value', sets: 'title' },
      { id: 'type', label: 'Type', input: 'type', default: 'any', sets: 'type', pins: ['value'] },
      { id: 'infer', label: 'Infer type', input: 'checkbox', default: false, infer: { field: 'type', from: 'value' } },
      // Pinos de fluxo opcionais: controlar quando a variável é criada / recebe o valor.
      { id: 'flow', label: 'Flow pins', input: 'checkbox', default: false },
    ],
    inputs: [
      { id: 'run', kind: 'flow', when: 'flow' },
      { id: 'config', label: 'config', kind: 'config' },
      { id: 'value', label: 'value', kind: 'data', type: 'any' },
    ],
    outputs: [
      { id: 'next', kind: 'flow', when: 'flow' },
      { id: 'value', label: 'value', kind: 'data', type: 'any' },
    ],
  },
  {
    id: 'number', concept: 'literal', title: 'height', category: 'Data', tag: 'float', compact: true,
    inputs: [{ id: 'set', kind: 'data', type: 'float' }],
    outputs: [{ id: 'get', kind: 'data', type: 'float' }],
  },
  {
    id: 'text', concept: 'literal', title: 'user', category: 'Data', tag: 'text', compact: true,
    outputs: [{ id: 'get', kind: 'data', type: 'text' }],
  },
  {
    // Referências à Variable (Ctrl/Alt + clique nela; nome e tipo vêm dela).
    id: 'var_get', concept: 'get', title: 'get', category: 'Data', tag: 'any', compact: true,
    outputs: [{ id: 'value', kind: 'data', type: 'any' }],
  },
  {
    id: 'var_set', concept: 'set', title: 'set', category: 'Data', tag: 'any',
    inputs: [{ id: 'run', kind: 'flow' }, { id: 'value', label: 'value', kind: 'data', type: 'any' }],
    outputs: [{ id: 'next', kind: 'flow' }, { id: 'value', label: 'value', kind: 'data', type: 'any' }],
  },
  {
    // Endereço de uma pasta/arquivo, criado ao soltar a pasta/arquivo num script.
    id: 'path', concept: 'path', title: 'res://', category: 'Data', tag: 'text', compact: true,
    fields: [{ id: 'path', label: 'Path', input: 'text', default: 'res://', sets: 'title' }],
    outputs: [{ id: 'path', kind: 'data', type: 'text' }],
  },
  {
    id: 'to_text', concept: 'operator', title: 'To Text', category: 'Data',
    inputs: [{ id: 'value', label: 'value', kind: 'data', type: 'any' }],
    outputs: [{ id: 'text', label: 'text', kind: 'data', type: 'text' }],
  },
];
