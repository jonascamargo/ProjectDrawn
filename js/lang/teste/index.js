// Linguagem de teste: reúne tipos e nós num objeto que o registro de linguagens lê
// (js/core/languages.js). Arquivos .gd são dela.
import { extensions, icons } from './icons.js';
import { natives } from './natives.js';
import { nodes } from './nodes.js';
import { canAssign, types } from './types.js';

export const language = {
  id: 'teste',
  name: 'Teste',
  extensions,
  fileContains: ['class', 'function', '@script'], // direto no arquivo
  types,
  canAssign,
  icons,
  nodes,
  natives,
};
