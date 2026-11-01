// Clique direito num nó (ou pino dele) fora da seleção seleciona só ele antes do menu.
export default {
  id: 'node.menuSelect',
  area: ['node', 'reroute', 'comment', 'pin'],
  menu: {
    prepare(c) {
      const { graph: gc, fileId } = c;
      if (!gc.nodes.has(c.hit.nodeId) || gc.fileId !== fileId) gc.select(fileId, { nodes: [c.hit.nodeId] });
    },
  },
};
