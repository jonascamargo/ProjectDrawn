import { exportAllScripts } from '../../../ui/codeView.js';

export default {
  id: 'canvas.exportAll',
  area: 'canvas',
  menu: {
    group: 'view',
    order: 10,
    label: 'export.allToFolder',
    run: (c) => exportAllScripts(c.editor),
  },
};
