import { updateItem } from '../../../core/projectOps.js';
import { t } from '../../../i18n/i18n.js';

// Alça do comentário do canvas: muda o tamanho da caixa (Alt desliga o snap); fica no histórico.
export default {
  id: 'note.resize',
  area: 'note',
  priority: 20,
  press: {
    when: (c) => c.part === 'resize',
    run(c) {
      const { editor, item } = c;
      const start = { w: c.hit.entry.rect.w, h: c.hit.entry.rect.h };
      const before = { w: item.w, h: item.h };
      const startWorld = c.world;
      return {
        move(m) {
          item.w = Math.max(160, editor.snap(start.w + m.world.x - startWorld.x, m.mods.alt));
          item.h = Math.max(80, editor.snap(start.h + m.world.y - startWorld.y, m.mods.alt));
          editor.refresh();
        },
        up() {
          const after = { w: item.w, h: item.h };
          Object.assign(item, before);
          const label = t('comment.resizeHistory');
          editor.history.transaction(label, () => {
            editor.history.execute(updateItem(editor.project, item.id, after, label));
            editor.settleCanvasComments([item.parentId], item.id);
          });
        },
        cancel() {
          Object.assign(item, before);
          editor.refresh();
        },
      };
    },
  },
  hover: {
    when: (c) => c.part === 'resize',
    run: () => 'nwse-resize',
  },
};
