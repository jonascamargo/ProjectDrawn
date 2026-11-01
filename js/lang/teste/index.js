// Linguagem de teste: reúne tipos e nós num objeto que o núcleo lê.
import { icons } from './icons.js';
import { nodes } from './nodes.js';
import { canAssign, types } from './types.js';

export const language = {
  id: 'teste',
  name: 'Teste',
  types,
  canAssign,
  icons,
  nodes,
  node(id) {
    return nodes.find((n) => n.id === id);
  },
};
