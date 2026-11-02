// Segunda linguagem de teste (arquivos .gdshader): poucos nós, para conferir duas linguagens no
// mesmo canvas. Cada arquivo só aceita os nós da linguagem dele.
const types = {
  float: { label: 'float', tag: 'flt', color: '#6e5bff', editor: 'float' },
  vec3: { label: 'vec3', tag: 'vc3', color: '#a04bd8', editor: 'vector', components: ['x', 'y', 'z'], componentType: 'float' },
};

const nodes = [
  {
    id: 'function', concept: 'function', title: 'Function', category: 'Shader', icon: 'function',
    fields: [{ id: 'name', label: 'Name', input: 'text', default: 'my_function', sets: 'title' }],
  },
  {
    id: 'uniform', concept: 'variable', title: 'uniform', category: 'Data', tag: 'float',
    fields: [
      { id: 'name', label: 'Name', input: 'text', default: 'value', sets: 'title' },
      { id: 'type', label: 'Type', input: 'type', default: 'float', sets: 'type', pins: ['value'] },
    ],
    inputs: [{ id: 'value', label: 'value', kind: 'data', type: 'float' }],
    outputs: [{ id: 'value', label: 'value', kind: 'data', type: 'float' }],
  },
  {
    id: 'uniform_get', concept: 'get', title: 'get', category: 'Data', tag: 'float', compact: true,
    outputs: [{ id: 'value', kind: 'data', type: 'float' }],
  },
  {
    id: 'uniform_set', concept: 'set', title: 'set', category: 'Data', tag: 'float',
    inputs: [{ id: 'value', label: 'value', kind: 'data', type: 'float' }],
    outputs: [{ id: 'value', label: 'value', kind: 'data', type: 'float' }],
  },
  {
    id: 'mix', concept: 'operator', title: 'Mix', category: 'Math',
    inputs: [
      { id: 'a', label: 'a', kind: 'data', type: 'vec3' },
      { id: 'b', label: 'b', kind: 'data', type: 'vec3' },
      { id: 't', label: 't', kind: 'data', type: 'float' },
    ],
    outputs: [{ id: 'result', label: 'result', kind: 'data', type: 'vec3' }],
  },
];

export const language = {
  id: 'teste2',
  name: 'Teste 2',
  extensions: { gdshader: '#5FB7A4' },
  fileContains: ['function', '@script'],
  types,
  canAssign: (from, to) => from === to,
  icons: { function: { file: 'icons/function.svg', color: '#0A6CC2' } },
  nodes,
  // Funções do shader que a Function sobrescreve pelo nome.
  natives: [
    { name: 'vertex', params: [], returns: null },
    { name: 'fragment', params: [], returns: null },
    { name: 'light', params: [], returns: null },
  ],
};
