export default {
  id: 'item.copy',
  area: ['folder', 'file', 'note'],
  key: {
    keys: ['Ctrl+C'],
    run(c) {
      c.editor.lastCopy = 'items';
      return Boolean(c.editor.copySelection());
    },
  },
  menu: {
    group: 'clipboard',
    order: 10,
    label: 'clipboard.copy',
    shortcut: 'Ctrl+C',
    run: (c) => c.editor.copySelection(),
  },
};
