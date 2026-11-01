// Clique no fio seleciona; Ctrl + clique remove a conexão.
export default {
  id: 'wire.select',
  area: 'wire',
  press: {
    run(c) {
      if (c.mods.ctrl) c.graph.removeWire(c.fileId, c.hit.wireId);
      else c.graph.select(c.fileId, { wire: c.hit.wireId });
    },
  },
  hover: {
    run: () => 'pointer',
  },
  menu: {
    prepare: (c) => c.graph.select(c.fileId, { wire: c.hit.wireId }),
  },
};
