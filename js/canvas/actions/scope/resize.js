// Alça no canto da sub-área expandida (tamanho só na memória, nunca menor que o conteúdo).
export default {
  id: 'scope.resize',
  area: 'scope',
  priority: 10,
  press: {
    when: (c) => c.hit.kind === 'gresize',
    run(c) {
      const scopeId = c.hit.scopeId;
      const start = { w: c.hit.rect.w, h: c.hit.rect.h };
      const startWorld = c.world;
      return {
        move(m) {
          m.graph.scopeSizes.set(scopeId, { w: start.w + m.world.x - startWorld.x, h: start.h + m.world.y - startWorld.y });
          m.editor.refresh();
        },
      };
    },
  },
  hover: {
    when: (c) => c.hit.kind === 'gresize',
    run: () => 'nwse-resize',
  },
};
