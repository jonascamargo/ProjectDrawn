// .tscn solto dentro de outra cena expandida: instância daquela cena.
export default {
  id: 'file.instanceInScene',
  area: 'file',
  itemDrop: {
    when: (c) => c.graph.isScene(c.target.entry.item) && c.graph.isScene(c.item),
    run: (c) => c.graph.addSceneInstance(c.target.id, c.item.id, c.world),
  },
};
