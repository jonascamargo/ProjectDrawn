import { bus } from '../../../core/events.js';

// Arrastar no vazio do script (ou no corpo de uma sub-área): laço com os nós do mesmo nível.
export default {
  id: 'script.lasso',
  area: ['script', 'scope'],
  priority: -100,
  press: {
    run(c) {
      const { editor, graph: gc, fileId } = c;
      const level = c.hit.kind === 'gscope' ? c.hit.scopeId : null;
      if (!(c.mods.ctrl || c.mods.shift)) gc.select(fileId, {});
      const start = c.world;
      const base = new Set(gc.fileId === fileId ? gc.nodes : []);
      return {
        move(m) {
          const rect = {
            x: Math.min(start.x, m.world.x),
            y: Math.min(start.y, m.world.y),
            w: Math.abs(m.world.x - start.x),
            h: Math.abs(m.world.y - start.y),
          };
          editor.lasso = rect;
          gc.nodes = new Set([...base, ...gc.nodesInRect(fileId, rect, level)]);
          gc.fileId = fileId;
          editor.renderer.invalidate();
        },
        up() {
          editor.lasso = null;
          editor.renderer.invalidate();
          bus.emit('selection:changed');
        },
        cancel() {
          editor.lasso = null;
          editor.renderer.invalidate();
        },
      };
    },
  },
};
