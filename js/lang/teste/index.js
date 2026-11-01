// Linguagem de teste: reúne tipos e nós num objeto que o núcleo lê.
import { extensions, icons, nodeColor } from './icons.js';
import { nodes } from './nodes.js';
import { canAssign, types } from './types.js';

export const language = {
  id: 'teste',
  name: 'Teste',
  rootContains: ['folder', 'file'], // na raiz do canvas: só pastas e arquivos
  pathNode: 'path', // nó criado quando uma pasta/arquivo é solto num script
  // Tipo do script: a extensão do nome do arquivo (nós de script só vão para script do mesmo tipo).
  scriptType(file) {
    return String(file.values.name).split('.').pop().toLowerCase();
  },
  types,
  canAssign,
  icons,
  extensions,
  nodeColor,
  nodes,
  node(id) {
    return nodes.find((n) => n.id === id);
  },
};
