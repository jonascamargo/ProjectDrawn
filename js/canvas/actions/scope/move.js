import { bus } from '../../../core/events.js';
import { graphSnapshot } from '../../../core/graphOps.js';
import { readGraph } from '../../../core/graph.js';
import { t } from '../../../i18n/i18n.js';

const DRAG_THRESHOLD = 4;

// Arrastar pelo cabeçalho (entrada da função/evento, ou o nó da sub-área recolhida) move a
// sub-área; clicar seleciona. Alt desliga o snap.
export default {
  id: 'scope.move',
  area: 'scope',
  press: {
    when: (c) => c.hit.kind === 'gscope' && c.part === 'header',
    run(c) {
      const { editor, graph: gc, fileId } = c;
      const scopeId = c.hit.scopeId;
      gc.select(fileId, { scopes: [scopeId] });
      const scope = readGraph(c.project.get(fileId)).scopes.find((s) => s.id === scopeId);
      const start = { x: scope.x, y: scope.y };
      const startScreen = c.screen;
      const startWorld = c.world;
      let before = null;
      return {
        move(m) {
          if (!before) {
            if (Math.hypot(m.screen.x - startScreen.x, m.screen.y - startScreen.y) < DRAG_THRESHOLD) return;
            before = structuredClone(editor.project.get(fileId).graph);
            m.canvas.style.cursor = 'grabbing';
          }
          const target = editor.project.get(fileId).graph.scopes.find((s) => s.id === scopeId);
          target.x = editor.snap(start.x + m.world.x - startWorld.x, m.mods.alt);
          target.y = editor.snap(start.y + m.world.y - startWorld.y, m.mods.alt);
          editor.refresh();
        },
        up() {
          if (!before) return;
          bus.emit('status', '');
          gc.detachedNodes = null;
          const after = structuredClone(editor.project.get(fileId).graph);
          editor.history.execute(graphSnapshot(editor.project, fileId, before, after, t('graph.history.moveScope')));
        },
        cancel() {
          gc.detachedNodes = null;
          if (before) {
            editor.project.get(fileId).graph = before;
            bus.emit('project:changed', editor.project);
          }
          editor.renderer.invalidate();
        },
      };
    },
  },
  hover: {
    when: (c) => c.hit.kind === 'gscope' && c.part === 'header',
    run: () => 'move',
  },
};
