export default {
  id: 'wire.delete',
  area: ['wire', 'label'],
  menu: {
    group: 'danger',
    order: 10,
    label: 'graph.menu.deleteWire',
    shortcut: 'Del',
    danger: true,
    run: (c) => c.graph.deleteSelection(),
  },
};
