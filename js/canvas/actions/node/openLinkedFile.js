// Ícones 📜/🔗 no cabeçalho do nó de cena: leva ao script ou à cena instanciada.
export default {
  id: 'node.openLinkedFile',
  area: 'node',
  press: {
    when: (c) => c.hit.kind === 'gscript',
    run: (c) => c.editor.navigateTo(c.hit.itemId),
  },
};
