import { bus } from '../../../core/events.js';

const ZOOM_STEP = 1.0015;

// Roda do mouse: zoom no cursor (vale em qualquer área que não trate a roda antes).
export default {
  id: 'canvas.zoom',
  area: '*',
  priority: -100,
  wheel: {
    run(c) {
      const event = c.event;
      // deltaMode 1 = linhas (Firefox); normaliza para pixels.
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      c.camera.zoomAt(c.screen.x, c.screen.y, c.camera.zoom * Math.pow(ZOOM_STEP, -delta));
      c.editor.renderer.invalidate();
      bus.emit('camera:changed', c.camera);
    },
  },
};
