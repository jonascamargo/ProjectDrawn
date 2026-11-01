import { isVariableDeclaration } from '../../../core/graph.js';

// Ctrl + arrastar uma declaração de variável cria "ler"; Alt + arrastar cria "definir".
export default {
  id: 'node.spawnAccess',
  area: 'node',
  priority: 10,
  press: {
    when: (c) => c.hit.kind === 'gnode' && (c.mods.ctrl || c.mods.alt) && isVariableDeclaration(c.node),
    run(c) {
      const { fileId } = c;
      const declId = c.node.id;
      const mode = c.mods.alt ? 'set' : 'get';
      c.canvas.style.cursor = 'copy';
      return {
        up: (u) => u.graph.spawnVariableAccess(fileId, declId, u.world, mode),
      };
    },
  },
};
