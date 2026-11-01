// F enquadra os nós/sub-áreas selecionados.
export default {
  id: 'node.fitSelection',
  area: 'node',
  priority: 10,
  key: {
    keys: ['F'],
    when: (c) => c.graph.hasSelection(),
    run: (c) => c.editor.fitGraphSelection(),
  },
};
