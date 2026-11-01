// Arrastar de um pino: conecta em outro pino; soltar no vazio (ou num fio) abre a busca
// filtrada pelo tipo, com o nó nascendo conectado.
export default {
  id: 'pin.connect',
  area: 'pin',
  press: {
    when: (c) => c.hit.kind === 'gpin',
    run(c) {
      const { editor, graph: gc, fileId, hit } = c;
      const from = { nodeId: hit.nodeId, pinId: hit.pinId, side: hit.side };
      editor.wireDrag = { side: hit.side, anchor: { x: hit.pin.x, y: hit.pin.y }, point: c.world };
      return {
        move(m) {
          editor.wireDrag.point = m.world;
          const over = editor.hitAt(m.world);
          gc.hoverPin = over?.kind === 'gpin' && over.fileId === fileId ? { fileId, nodeId: over.nodeId, pinId: over.pinId, side: over.side } : null;
          editor.renderer.invalidate();
        },
        up(u) {
          editor.wireDrag = null;
          gc.hoverPin = null;
          const over = editor.hitAt(u.world);
          if (over?.kind === 'gpin' && over.fileId === fileId) {
            gc.connectPins(fileId, from, { nodeId: over.nodeId, pinId: over.pinId, side: over.side });
          } else if (over && over.fileId === fileId && (over.kind === 'garea' || over.kind === 'gscope' || over.kind === 'gwire')) {
            gc.openSearch(fileId, u.world, u.client, from);
          }
          editor.renderer.invalidate();
        },
        cancel() {
          editor.wireDrag = null;
          editor.renderer.invalidate();
        },
      };
    },
  },
  hover: {
    when: (c) => c.hit.kind === 'gpin',
    run: () => 'crosshair',
  },
};
