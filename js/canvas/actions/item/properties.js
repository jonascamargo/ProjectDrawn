export default {
  id: 'item.properties',
  area: ['folder', 'file'],
  menu: {
    group: 'main',
    order: 30,
    label: 'items.properties',
    disabled: (c) => c.editor.selection.size > 1,
    run: (c) => c.editor.editProperties(c.item.id),
  },
};
