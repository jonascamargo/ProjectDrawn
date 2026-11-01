export default {
  id: 'item.delete',
  area: ['folder', 'file', 'note'],
  key: {
    keys: ['Delete', 'Backspace'],
    run: (c) => c.editor.deleteSelection(),
  },
  menu: {
    group: 'danger',
    order: 10,
    label: 'items.delete',
    shortcut: 'Del',
    danger: true,
    run: (c) => c.editor.deleteSelection(),
  },
};
