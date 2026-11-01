// Clique direito num item fora da seleção seleciona só ele antes de montar o menu.
export default {
  id: 'item.menuSelect',
  area: ['folder', 'file'],
  menu: {
    prepare(c) {
      if (!c.editor.selection.has(c.item.id)) c.editor.select([c.item.id]);
    },
  },
};
