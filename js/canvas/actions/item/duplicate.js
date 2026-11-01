export default {
  id: 'item.duplicate',
  area: ['folder', 'file'],
  key: {
    keys: ['Ctrl+D'],
    run: (c) => c.editor.duplicateSelection(),
  },
  menu: {
    group: 'clipboard',
    order: 20,
    label: 'clipboard.duplicate',
    shortcut: 'Ctrl+D',
    run: (c) => c.editor.duplicateSelection(),
  },
};
