// Copiar nós selecionados (Ctrl+C antes da cópia de itens).
export default {
  id: 'node.copy',
  area: ['node', 'reroute', 'comment', 'pin'],
  priority: 10,
  key: {
    keys: ['Ctrl+C'],
    when: (c) => c.graph.hasSelection(),
    run(c) {
      c.editor.lastCopy = 'graph';
      return Boolean(c.graph.copySelection());
    },
  },
  menu: {
    group: 'clipboard',
    order: 10,
    label: 'clipboard.copy',
    shortcut: 'Ctrl+C',
    run: (c) => c.graph.copySelection(),
  },
};
