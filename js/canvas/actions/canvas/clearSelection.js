export default {
  id: 'canvas.clearSelection',
  area: 'canvas',
  key: {
    keys: ['Escape'],
    run: (c) => c.editor.clearSelection(),
  },
};
