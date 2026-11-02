// Nós da GDScript: os escritos aqui (classe, função, variável, controle de fluxo, operadores) e um
// por função global da Godot (api/core.js: print, lerp, randi…). Formato como em lang/teste/nodes.js.
import { functions } from './api/core.js';

const name = (value) => ({ id: 'name', label: 'Name', input: 'text', default: value, sets: 'title' });

const written = [
  {
    id: 'class', concept: 'class', title: 'Class', category: 'Script', icon: 'class',
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
    // Chamada a uma Function (Ctrl+clique nela): nome, parâmetros e retorno vêm dela.
    id: 'call', concept: 'call', title: 'call', category: 'Flow', icon: 'function',
    inputs: [{ id: 'run', kind: 'flow' }],
    outputs: [{ id: 'next', kind: 'flow' }],
  },
  {
    // Parâmetro da Function (arrastado do inspetor dela): nome e tipo vêm do parâmetro.
    id: 'param', concept: 'parameter', title: 'param', category: 'Data', tag: 'Variant', compact: true,
    outputs: [{ id: 'value', kind: 'data', type: 'Variant' }],
  },
  {
    id: 'return', concept: 'return', title: 'Return', category: 'Flow',
    inputs: [{ id: 'run', kind: 'flow' }, { id: 'value', label: 'value', kind: 'data', type: 'Variant', when: 'returns' }],
  },
  {
    id: 'if', concept: 'branch', title: 'If', category: 'Flow',
    inputs: [{ id: 'run', kind: 'flow' }, { id: 'condition', label: 'condition', kind: 'condition' }],
    outputs: [{ id: 'true', label: 'true', kind: 'flow' }, { id: 'false', label: 'false', kind: 'flow' }],
  },
  {
    // for i in range(count)
    id: 'for', concept: 'loop', title: 'For', category: 'Flow', icon: 'loop',
    inputs: [{ id: 'run', kind: 'flow' }, { id: 'count', label: 'count', kind: 'data', type: 'int' }],
    outputs: [
      { id: 'next', kind: 'flow' }, { id: 'body', label: 'body', kind: 'flow' },
      { id: 'index', label: 'index', kind: 'data', type: 'int' },
    ],
  },
  {
    id: 'while', concept: 'loop', title: 'While', category: 'Flow', icon: 'loop',
    inputs: [{ id: 'run', kind: 'flow' }, { id: 'condition', label: 'condition', kind: 'condition' }],
    outputs: [{ id: 'next', kind: 'flow' }, { id: 'body', label: 'body', kind: 'flow' }],
  },
  ...operators(),
  {
    id: 'variable', concept: 'variable', title: 'Variable', category: 'Data', tag: 'Variant',
    fields: [
      { id: 'name', label: 'Name', input: 'text', default: 'value', sets: 'title' },
      { id: 'type', label: 'Type', input: 'type', default: 'Variant', sets: 'type', pins: ['value'] },
      { id: 'infer', label: 'Infer type', input: 'checkbox', default: false, infer: { field: 'type', from: 'value' } },
      { id: 'flow', label: 'Flow pins', input: 'checkbox', default: false },
    ],
    inputs: [
      { id: 'run', kind: 'flow', when: 'flow' },
      { id: 'config', label: 'config', kind: 'config' },
      { id: 'value', label: 'value', kind: 'data', type: 'Variant' },
    ],
    outputs: [
      { id: 'next', kind: 'flow', when: 'flow' },
      { id: 'value', label: 'value', kind: 'data', type: 'Variant' },
    ],
  },
  {
    id: 'var_get', concept: 'get', title: 'get', category: 'Data', tag: 'Variant', compact: true,
    outputs: [{ id: 'value', kind: 'data', type: 'Variant' }],
  },
  {
    id: 'var_set', concept: 'set', title: 'set', category: 'Data', tag: 'Variant',
    inputs: [{ id: 'run', kind: 'flow' }, { id: 'value', label: 'value', kind: 'data', type: 'Variant' }],
    outputs: [{ id: 'next', kind: 'flow' }, { id: 'value', label: 'value', kind: 'data', type: 'Variant' }],
  },
  {
    // Endereço de uma pasta/arquivo, criado ao soltar a pasta/arquivo num script.
    id: 'path', concept: 'path', title: 'res://', category: 'Data', tag: 'String', compact: true,
    fields: [{ id: 'path', label: 'Path', input: 'text', default: 'res://', sets: 'title' }],
    outputs: [{ id: 'path', kind: 'data', type: 'String' }],
  },
];

// Operadores. Matemática: a, b e o resultado do tipo do campo Type (padrão float; Infer type pega o
// tipo do que liga em a). Comparação: qualquer valor, resultado condicional. Lógica: condicionais.
function operators() {
  const math = [['add', 'Add', '+'], ['subtract', 'Subtract', '-'], ['multiply', 'Multiply', '*'], ['divide', 'Divide', '/'], ['modulo', 'Modulo', '%']];
  const compare = [['equal', 'Equal', '=='], ['not_equal', 'Not Equal', '!='], ['less', 'Less', '<'], ['less_equal', 'Less Or Equal', '<='], ['greater', 'Greater', '>'], ['greater_equal', 'Greater Or Equal', '>=']];
  const data = (id, type) => ({ id, label: id, kind: 'data', type });
  return [
    ...math.map(([id, title, op]) => ({
      id, concept: 'operator', title, category: 'Math',
      fields: [
        { id: 'type', label: 'Type', input: 'type', default: 'float', sets: 'type', pins: ['a', 'b', 'result'] },
        { id: 'infer', label: 'Infer type', input: 'checkbox', default: false, infer: { field: 'type', from: 'a' } },
      ],
      inputs: [data('a', 'float'), data('b', 'float')],
      outputs: [{ id: 'result', label: `a ${op} b`, kind: 'data', type: 'float' }],
    })),
    ...compare.map(([id, title, op]) => ({
      id, concept: 'operator', title, category: 'Logic', icon: 'condition',
      inputs: [data('a', 'Variant'), data('b', 'Variant')],
      outputs: [{ id: 'result', label: `a ${op} b`, kind: 'condition' }],
    })),
    {
      id: 'and', concept: 'operator', title: 'And', category: 'Logic', icon: 'condition',
      inputs: [{ id: 'a', label: 'a', kind: 'condition' }, { id: 'b', label: 'b', kind: 'condition' }],
      outputs: [{ id: 'result', label: 'a and b', kind: 'condition' }],
    },
    {
      id: 'or', concept: 'operator', title: 'Or', category: 'Logic', icon: 'condition',
      inputs: [{ id: 'a', label: 'a', kind: 'condition' }, { id: 'b', label: 'b', kind: 'condition' }],
      outputs: [{ id: 'result', label: 'a or b', kind: 'condition' }],
    },
    {
      id: 'not', concept: 'operator', title: 'Not', category: 'Logic', icon: 'condition',
      inputs: [{ id: 'a', label: 'a', kind: 'condition' }],
      outputs: [{ id: 'result', label: 'not a', kind: 'condition' }],
    },
  ];
}

// Função global: sem retorno, tem fluxo (ex.: print); com retorno, é um cálculo (ex.: lerp).
// vararg (ex.: print): por enquanto só os argumentos fixos.
const CATEGORY = { general: 'Global', math: 'Global math', random: 'Global random' };
const global = functions.map(([fn, category, returns, args]) => ({
  id: `fn_${fn}`,
  concept: 'builtin',
  title: fn,
  category: CATEGORY[category] ?? 'Global',
  inputs: [
    ...(returns ? [] : [{ id: 'run', kind: 'flow' }]),
    ...args.map(([arg, type]) => ({ id: arg, label: arg, kind: 'data', type })),
  ],
  outputs: [
    ...(returns ? [] : [{ id: 'next', kind: 'flow' }]),
    ...(returns ? [{ id: 'result', label: 'result', kind: 'data', type: returns }] : []),
  ],
}));

export const nodes = [...written, ...global];
