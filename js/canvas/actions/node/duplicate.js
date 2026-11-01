export default {
  id: 'node.duplicate',
  area: ['node', 'reroute', 'comment', 'pin'],
  priority: 10,
  key: {
    keys: ['Ctrl+D'],
    when: (c) => c.graph.hasSelection(),
    run(c) {
      c.graph.duplicateSelection();
    },
  },
  menu: {
    group: 'clipboard',
    order: 20,
    label: 'clipboard.duplicate',
    shortcut: 'Ctrl+D',
    run: (c) => c.graph.duplicateSelection(),
  },
};
