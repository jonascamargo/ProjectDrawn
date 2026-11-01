// Seta ▸/▾ na entrada de função/evento: recolhe ou expande a sub-área.
export default {
  id: 'scope.toggle',
  area: 'scope',
  priority: 10,
  press: {
    when: (c) => c.hit.kind === 'gtoggle',
    run: (c) => c.graph.toggleCollapse(c.fileId, { nodeId: c.hit.nodeId, scopeId: c.hit.scopeId }),
  },
  hover: {
    when: (c) => c.hit.kind === 'gtoggle',
    run: () => 'pointer',
  },
};
