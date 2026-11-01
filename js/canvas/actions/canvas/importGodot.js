import { importGodotFolder } from '../../../ui/projectImport.js';

export default {
  id: 'canvas.importGodot',
  area: ['canvas', 'folder'],
  menu: {
    group: 'import',
    order: 20,
    when: (c) => c.area === 'canvas' || c.editor.selection.size === 1,
    label: 'import.godotFolder',
    run: (c) => importGodotFolder(c.editor, c.parentId, c.area === 'canvas' ? c.world : null),
  },
};
