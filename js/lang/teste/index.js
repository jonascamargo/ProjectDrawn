// Linguagem de teste: reúne tipos e nós num objeto que o núcleo lê.
import { categories, nodes } from './nodes.js';
import { types } from './types.js';

export const language = {
  id: 'teste',
  name: 'Teste',
  types,
  categories,
  nodes,
  node(id) {
    return nodes.find((n) => n.id === id);
  },
};
