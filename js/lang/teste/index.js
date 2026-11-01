// Linguagem de teste: reúne tipos e nós num objeto que o núcleo lê.
import { categories, nodes } from './nodes.js';
import { canAssign, types } from './types.js';

export const language = {
  id: 'teste',
  name: 'Teste',
  types,
  canAssign,
  categories,
  nodes,
  node(id) {
    return nodes.find((n) => n.id === id);
  },
};
