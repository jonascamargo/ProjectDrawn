// Duplo clique no fio (ou menu) cria um reroute naquele ponto.
export default {
  id: 'wire.insertReroute',
  area: ['wire', 'label'],
  dblclick: {
    when: (c) => c.hit.kind === 'gwire',
    run: (c) => c.graph.insertReroute(c.fileId, c.hit.wireId, c.world),
  },
  menu: {
    group: 'main',
    order: 10,
    label: 'graph.menu.addReroute',
    run: (c) => c.graph.insertReroute(c.fileId, c.hit.wireId, c.world),
  },
};
