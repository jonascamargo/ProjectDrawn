// Ctrl+V cola os nós copiados no script sob o mouse.
export default {
  id: 'node.paste',
  area: 'script',
  priority: 10,
  key: {
    keys: ['Ctrl+V'],
    when: (c) => c.editor.lastCopy === 'graph',
    run(c) {
      const fileId = c.editor.hitAt(c.world)?.fileId;
      return fileId ? Boolean(c.graph.paste(fileId, c.world)) : false;
    },
  },
};
