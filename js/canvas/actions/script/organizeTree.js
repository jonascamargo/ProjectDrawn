// "Organizar em árvore" no menu da área de uma cena (Shift + clique direito).
export default {
  id: 'script.organizeTree',
  area: ['script', 'scope'],
  menu: {
    group: 'main',
    order: 30,
    when: (c) => c.mods.shift && (c.hit.kind === 'garea' || c.part === 'body') && c.graph.isScene(c.project.get(c.fileId)),
    label: 'graph.menu.organizeTree',
    run: (c) => c.graph.organizeTree(c.fileId),
  },
};
