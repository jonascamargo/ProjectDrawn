// Alt + clique no pino (ou menu do pino) remove os fios dele.
export default {
  id: 'pin.disconnect',
  area: 'pin',
  priority: 10,
  press: {
    when: (c) => c.hit.kind === 'gpin' && c.mods.alt,
    run: (c) => c.graph.breakPin(c.fileId, c.hit.nodeId, c.hit.pinId, c.hit.side),
  },
  menu: {
    group: 'main',
    order: 10,
    when: (c) => c.hit.kind === 'gpin',
    label: 'graph.menu.disconnectPin',
    run: (c) => c.graph.breakPin(c.fileId, c.hit.nodeId, c.hit.pinId, c.hit.side),
  },
};
