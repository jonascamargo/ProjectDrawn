import { t } from '../../../i18n/i18n.js';
import { containerAt } from '../../itemLayout.js';
import { getDef } from '../../../lang/nodeRegistry.js';

// Comentário: "Novo comentário" no menu do canvas/pasta. Alt+C: em volta dos itens selecionados;
// sem seleção, no ponto do mouse (dentro de um script, comentário do script).
export default {
  id: 'canvas.createComment',
  area: ['canvas', 'folder'],
  key: {
    keys: ['Alt+C'],
    run(c) {
      const { editor } = c;
      if (editor.selection.size) return editor.commentAroundSelection();
      const hit = editor.hitAt(c.world);
      if (hit?.fileId && getDef('misc.comment')) {
        editor.graph.addNode(hit.fileId, 'misc.comment', c.world);
        return;
      }
      if (!editor.layout) return false;
      editor.createComment(containerAt(editor.layout, editor.project, c.world).id, c.world);
    },
  },
  menu: {
    group: 'create',
    order: 90,
    when: (c) => c.area === 'canvas' || c.editor.selection.size === 1,
    label: () => t('comment.new'),
    run: (c) => c.editor.createComment(c.parentId, c.area === 'canvas' ? c.world : null),
  },
};
