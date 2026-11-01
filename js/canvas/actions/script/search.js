// Busca de nós: Tab no ponto do mouse, clique direito no vazio do script e "Adicionar nó"
// no menu da área (Shift + clique direito).
const onArea = (c) => c.hit?.kind === 'garea' || (c.hit?.kind === 'gscope' && c.part === 'body');

export default {
  id: 'script.search',
  area: ['script', 'scope'],
  priority: 10,
  key: {
    keys: ['Tab'],
    run(c) {
      const fileId = c.editor.hitAt(c.world)?.fileId;
      if (!fileId) return false;
      c.graph.openSearch(fileId, c.world, c.client);
    },
  },
  menu: {
    group: 'main',
    order: 10,
    // Sem Shift abre a busca direto (menos no cabeçalho da sub-área, que tem menu próprio).
    open: (c) => c.graph.openSearch(c.fileId, c.world, c.client),
    openWhen: (c) => !(c.mods.shift && onArea(c)) && !(c.hit.kind === 'gscope' && c.part === 'header'),
    when: (c) => c.mods.shift && onArea(c),
    label: 'graph.menu.addNode',
    shortcut: 'Tab',
    run: (c) => c.graph.openSearch(c.fileId, c.world, c.client),
  },
};
