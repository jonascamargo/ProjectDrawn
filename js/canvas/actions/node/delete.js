// Excluir a seleção do grafo (nós, fio ou sub-área) pelo teclado; no menu do nó.
export default {
  id: 'node.delete',
  area: ['node', 'reroute', 'comment', 'pin'],
  priority: 10,
  key: {
    keys: ['Delete', 'Backspace'],
    when: (c) => c.graph.hasSelection(),
    run: (c) => Boolean(c.graph.deleteSelection()),
  },
  menu: {
    group: 'danger',
    order: 10,
    label: 'graph.menu.deleteNode',
    shortcut: 'Del',
    danger: true,
    run: (c) => c.graph.deleteSelection(),
  },
};
