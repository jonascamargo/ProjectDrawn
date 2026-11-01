// Arquivo solto dentro de um script expandido vira um const ligado a ele.
export default {
  id: 'file.referenceInScript',
  area: 'file',
  itemDrop: {
    when: (c) => c.graph.isScript(c.target.entry.item),
    run: (c) => c.graph.addFileReference(c.target.id, c.item.id, c.world),
  },
};
