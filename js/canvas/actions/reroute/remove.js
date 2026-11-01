// Ctrl + clique no reroute: remove o reroute e religa os fios.
export default {
  id: 'reroute.remove',
  area: 'reroute',
  priority: 10,
  press: {
    when: (c) => c.hit.kind === 'gnode' && c.mods.ctrl,
    run: (c) => c.graph.removeReroute(c.fileId, c.node.id),
  },
};
