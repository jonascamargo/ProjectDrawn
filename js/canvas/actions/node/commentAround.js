// Alt+C com nós selecionados: comentário do script em volta deles (se a linguagem tiver o nó).
export default {
  id: 'node.commentAround',
  area: 'node',
  priority: 10,
  key: {
    keys: ['Alt+C'],
    when: (c) => c.graph.hasSelection() && c.graph.nodes.size > 0,
    run: (c) => c.graph.commentAround(c.graph.fileId),
  },
};
