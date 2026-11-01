// Alça no canto inferior direito de pastas e arquivos expandidos (tamanho só na memória).
export default {
  id: 'item.resize',
  area: ['folder', 'file'],
  priority: 10,
  press: {
    when: (c) => c.part === 'resize',
    run(c) {
      const id = c.item.id;
      const start = { w: c.hit.entry.rect.w, h: c.hit.entry.rect.h };
      const startWorld = c.world;
      return {
        move(m) {
          m.editor.areaSizes.set(id, { w: start.w + m.world.x - startWorld.x, h: start.h + m.world.y - startWorld.y });
          m.editor.refresh();
        },
      };
    },
  },
  hover: {
    when: (c) => c.part === 'resize',
    run: () => 'nwse-resize',
  },
};
