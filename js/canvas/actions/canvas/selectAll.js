// Ctrl+A seleciona tudo no nível da seleção; no menu, tudo do nível clicado.
export default {
  id: 'canvas.selectAll',
  area: 'canvas',
  key: {
    keys: ['Ctrl+A'],
    run: (c) => c.editor.selectAll(),
  },
  menu: {
    group: 'view',
    order: 20,
    label: 'items.selectAll',
    shortcut: 'Ctrl+A',
    run: (c) => c.editor.select(c.project.children(c.parentId).map((i) => i.id)),
  },
};
