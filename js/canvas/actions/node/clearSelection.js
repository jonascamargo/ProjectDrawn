// Esc limpa a seleção do grafo (antes da seleção de itens).
export default {
  id: 'node.clearSelection',
  area: 'node',
  priority: 10,
  key: {
    keys: ['Escape'],
    when: (c) => c.graph.hasSelection(),
    run: (c) => c.graph.clear(),
  },
};
