// Menu do cabeçalho da sub-área: seleciona e oferece excluir.
const onHeader = (c) => c.hit.kind === 'gscope' && c.part === 'header';

export default {
  id: 'scope.delete',
  area: 'scope',
  menu: {
    prepare(c) {
      if (onHeader(c)) c.graph.select(c.fileId, { scopes: [c.hit.scopeId] });
    },
    group: 'danger',
    order: 10,
    when: onHeader,
    label: 'graph.menu.deleteScope',
    danger: true,
    run: (c) => c.graph.deleteSelection(),
  },
};
