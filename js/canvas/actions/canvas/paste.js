// Colar itens copiados (Ctrl+V cola no ponto do mouse).
export default {
  id: 'canvas.paste',
  area: 'canvas',
  key: {
    keys: ['Ctrl+V'],
    run: (c) => c.editor.pasteAtPointer(),
  },
  menu: {
    group: 'clipboard',
    order: 10,
    label: 'clipboard.paste',
    shortcut: 'Ctrl+V',
    disabled: (c) => !c.editor.clipboard,
    run: (c) => c.editor.paste({ parentId: c.parentId, world: c.world }),
  },
};
