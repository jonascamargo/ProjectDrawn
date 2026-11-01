import { graphSnapshot } from '../../../core/graphOps.js';
import { t } from '../../../i18n/i18n.js';

// Alça do comentário: muda o tamanho da caixa (Alt desliga o snap); fica no histórico.
export default {
  id: 'comment.resize',
  area: 'comment',
  priority: 10,
  press: {
    when: (c) => c.hit.kind === 'gcresize',
    run(c) {
      const { editor, fileId } = c;
      const nodeId = c.hit.nodeId;
      const start = { w: c.hit.rect.w, h: c.hit.rect.h };
      const startWorld = c.world;
      const before = structuredClone(editor.project.get(fileId).graph);
      return {
        move(m) {
          const node = editor.project.get(fileId).graph.nodes.find((n) => n.id === nodeId);
          if (!node) return;
          node.w = Math.max(120, editor.snap(start.w + m.world.x - startWorld.x, m.mods.alt));
          node.h = Math.max(60, editor.snap(start.h + m.world.y - startWorld.y, m.mods.alt));
          editor.refresh();
        },
        up() {
          const after = structuredClone(editor.project.get(fileId).graph);
          editor.history.execute(graphSnapshot(editor.project, fileId, before, after, t('graph.history.resizeComment')));
        },
      };
    },
  },
  hover: {
    when: (c) => c.hit.kind === 'gcresize',
    run: () => 'nwse-resize',
  },
};
