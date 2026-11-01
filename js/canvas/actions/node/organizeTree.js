import { getDef } from '../../../lang/nodeRegistry.js';

// "Organizar em árvore" no menu de um nó de cena.
export default {
  id: 'node.organizeTree',
  area: ['node', 'pin'],
  menu: {
    group: 'create',
    order: 50,
    when: (c) => Boolean(getDef(c.node?.type)?.sceneNode),
    label: 'graph.menu.organizeTree',
    run: (c) => c.graph.organizeTree(c.fileId),
  },
};
