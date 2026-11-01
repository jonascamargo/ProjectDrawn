import { openCanvasSearch } from '../../../ui/canvasSearch.js';

// Ctrl+F abre a busca no canvas (pastas, arquivos, funções, variáveis e nós).
export default {
  id: 'canvas.find',
  area: 'canvas',
  key: {
    keys: ['Ctrl+F'],
    run: (c) => openCanvasSearch(c.editor),
  },
  menu: {
    group: 'view',
    order: 5,
    label: 'canvasSearch.menu',
    shortcut: 'Ctrl+F',
    run: (c) => openCanvasSearch(c.editor),
  },
};
