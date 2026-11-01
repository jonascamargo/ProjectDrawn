// "Colar" no menu da área do script (Shift + clique direito).
export default {
  id: 'script.pasteHere',
  area: ['script', 'scope'],
  menu: {
    group: 'main',
    order: 20,
    when: (c) => c.mods.shift && (c.hit.kind === 'garea' || c.part === 'body'),
    label: 'clipboard.paste',
    shortcut: 'Ctrl+V',
    disabled: (c) => !c.graph.clipboard,
    run: (c) => c.graph.paste(c.fileId, c.world),
  },
};
