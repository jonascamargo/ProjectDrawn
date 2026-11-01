import { importScriptFiles } from '../../../ui/projectImport.js';

export default {
  id: 'canvas.importScripts',
  area: ['canvas', 'folder'],
  menu: {
    group: 'import',
    order: 10,
    when: (c) => c.area === 'canvas' || c.editor.selection.size === 1,
    label: 'import.files',
    run: (c) => importScriptFiles(c.editor, c.parentId, c.area === 'canvas' ? c.world : null),
  },
};
