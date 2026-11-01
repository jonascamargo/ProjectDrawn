import { openCodeImport } from '../../../ui/codeImport.js';

export default {
  id: 'file.importCode',
  area: 'file',
  menu: {
    group: 'main',
    order: 50,
    when: (c) => c.editor.selection.size === 1 && c.graph.isScript(c.item),
    label: 'import.menu',
    run: (c) => openCodeImport(c.editor, c.item.id),
  },
};
