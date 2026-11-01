// F enquadra a seleção (ou tudo); no menu, enquadra tudo.
export default {
  id: 'canvas.fit',
  area: 'canvas',
  key: {
    keys: ['F'],
    run: (c) => c.editor.fitSelection(),
  },
  menu: {
    group: 'view',
    order: 30,
    label: 'canvas.fitAll',
    shortcut: 'F',
    run: (c) => c.editor.fitAll(),
  },
};
