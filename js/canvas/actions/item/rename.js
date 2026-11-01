export default {
  id: 'item.rename',
  area: ['folder', 'file', 'note'],
  key: {
    keys: ['F2'],
    when: (c) => c.editor.selection.size === 1,
    run: (c) => c.editor.renameItem([...c.editor.selection][0]),
  },
  menu: {
    group: 'main',
    order: 20,
    label: 'items.rename',
    shortcut: 'F2',
    disabled: (c) => c.editor.selection.size > 1,
    run: (c) => c.editor.renameItem(c.item.id),
  },
};
