// Arrastar no vazio (ou no corpo de uma pasta expandida): laço restrito ao nível onde começou.
export default {
  id: 'canvas.lasso',
  area: ['canvas', 'folder', 'file'],
  priority: -100,
  press: {
    run(c) {
      const { editor } = c;
      const level = c.item ? c.item.id : null;
      if (!(c.mods.ctrl || c.mods.shift)) editor.clearSelection();
      if (c.item) {
        editor.setFocus(c.item.id);
        editor.raise([c.item.id]);
      }
      const start = c.world;
      const base = new Set(editor.selection);
      return {
        move(m) {
          const rect = {
            x: Math.min(start.x, m.world.x),
            y: Math.min(start.y, m.world.y),
            w: Math.abs(m.world.x - start.x),
            h: Math.abs(m.world.y - start.y),
          };
          editor.lasso = rect;
          editor.selection = new Set([...base, ...editor.itemsInRect(rect, level)]);
          editor.renderer.invalidate();
        },
        up() {
          editor.lasso = null;
          editor.select([...editor.selection]);
        },
        cancel() {
          editor.lasso = null;
          editor.renderer.invalidate();
        },
      };
    },
  },
};
