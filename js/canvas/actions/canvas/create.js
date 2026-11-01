import { t } from '../../../i18n/i18n.js';
import { quickCreateTypes } from '../../../lang/profileLoader.js';

// Criar pasta/arquivo no canvas (ou dentro da pasta clicada).
export default {
  id: 'canvas.create',
  area: ['canvas', 'folder'],
  menu: {
    group: 'create',
    order: 10,
    when: (c) => c.area === 'canvas' || c.editor.selection.size === 1,
    items(c) {
      const { editor, parentId } = c;
      const world = c.area === 'canvas' ? c.world : null;
      return [
        { label: t('items.newFolder'), action: () => editor.createItem({ kind: 'folder', parentId, world }) },
        ...quickCreateTypes().map((fileType) => ({
          label: fileType.newLabel ?? t('items.newOfType', { type: fileType.label }),
          action: () => editor.createItem({ kind: 'file', parentId, world, fileType }),
        })),
        { label: t('items.newFile'), action: () => editor.createItem({ kind: 'file', parentId, world }) },
      ];
    },
  },
};
