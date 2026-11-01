import { t } from '../../../i18n/i18n.js';

// Expandir/recolher pasta ou arquivo: seta do card, duplo clique, Enter e menu.
export default {
  id: 'item.toggle',
  area: ['folder', 'file'],
  priority: 10,
  press: {
    when: (c) => c.part === 'toggle',
    run: (c) => c.editor.toggleExpand(c.item.id),
  },
  dblclick: {
    when: (c) => c.part === 'card' || c.part === 'header',
    run: (c) => c.editor.toggleExpand(c.item.id),
  },
  hover: {
    when: (c) => c.part === 'toggle',
    run: () => 'pointer',
  },
  key: {
    keys: ['Enter'],
    when: (c) => c.editor.selection.size > 0,
    run(c) {
      for (const id of c.editor.selection) c.editor.toggleExpand(id);
    },
  },
  menu: {
    group: 'main',
    order: 10,
    when: (c) => c.editor.canExpand(c.item),
    label: (c) => t(c.item.expanded ? 'items.collapse' : 'items.expand'),
    shortcut: 'Enter',
    run: (c) => c.editor.toggleExpand(c.item.id),
  },
};
