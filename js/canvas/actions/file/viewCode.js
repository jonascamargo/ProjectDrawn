import { openCodeView } from '../../../ui/codeView.js';

export default {
  id: 'file.viewCode',
  area: 'file',
  menu: {
    group: 'main',
    order: 40,
    when: (c) => c.editor.selection.size === 1 && c.graph.isScript(c.item),
    label: 'export.viewCode',
    run: (c) => openCodeView(c.editor, c.item.id),
  },
};
