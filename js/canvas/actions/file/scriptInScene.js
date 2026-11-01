// .gd solto numa cena expandida: sobre um nó de cena vira o script do nó; no vazio,
// nó de referência ao script (para ligar sinais).
export default {
  id: 'file.scriptInScene',
  area: 'file',
  itemDrop: {
    when: (c) => c.graph.isScene(c.target.entry.item) && c.graph.isScript(c.item),
    run(c) {
      const { graph, target } = c;
      const hit = graph.hit(target.entry, c.world);
      const node = hit?.nodeId ? graph.graph(target.id).nodes.find((n) => n.id === hit.nodeId) : null;
      if (node?.type === 'scene.node') graph.setNodeScript(target.id, node.id, c.item.id);
      else graph.addNode(target.id, 'scene.scriptRef', c.world, { fields: { script: c.item.id } });
    },
  },
};
