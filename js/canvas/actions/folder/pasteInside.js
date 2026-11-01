export default {
  id: 'folder.pasteInside',
  area: 'folder',
  menu: {
    group: 'import',
    order: 30,
    when: (c) => c.editor.selection.size === 1,
    label: 'clipboard.pasteInside',
    disabled: (c) => !c.editor.clipboard,
    run: (c) => c.editor.paste({ parentId: c.item.id }),
  },
};
