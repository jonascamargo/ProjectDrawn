import { theme } from '../theme/themeLoader.js';

// Fundo + grade. Desenhado em espaço de tela para manter linhas nítidas em qualquer zoom.
export function createGridLayer({ enabled = () => true } = {}) {
  return {
    id: 'grid',
    order: -100,
    space: 'screen',
    draw(ctx, view) {
      const config = theme()?.canvas ?? {};
      const grid = config.grid ?? {};
      ctx.fillStyle = config.background ?? '#111';
      ctx.fillRect(0, 0, view.width, view.height);
      if (!enabled()) return;

      const { camera, zoom } = view;
      const size = grid.size ?? 20;
      const majorEvery = grid.majorEvery ?? 5;
      const minSpacing = grid.minScreenSpacing ?? 8;

      // Abaixo do espaçamento mínimo, a grade menor some e só a maior é desenhada.
      const showMinor = size * zoom >= minSpacing;
      const step = showMinor ? size : size * majorEvery;
      if (step * zoom < minSpacing) return;

      const startX = Math.floor(camera.x / step) * step;
      const startY = Math.floor(camera.y / step) * step;
      const endX = camera.x + view.width / zoom;
      const endY = camera.y + view.height / zoom;
      const major = size * majorEvery;

      const minor = new Path2D();
      const majorPath = new Path2D();
      const axis = new Path2D();

      for (let x = startX; x <= endX; x += step) {
        const sx = Math.round((x - camera.x) * zoom) + 0.5;
        const target = x === 0 ? axis : isMultiple(x, major) ? majorPath : minor;
        target.moveTo(sx, 0);
        target.lineTo(sx, view.height);
      }
      for (let y = startY; y <= endY; y += step) {
        const sy = Math.round((y - camera.y) * zoom) + 0.5;
        const target = y === 0 ? axis : isMultiple(y, major) ? majorPath : minor;
        target.moveTo(0, sy);
        target.lineTo(view.width, sy);
      }

      ctx.lineWidth = 1;
      if (showMinor) {
        ctx.strokeStyle = grid.minorColor;
        ctx.stroke(minor);
      }
      ctx.strokeStyle = grid.majorColor;
      ctx.stroke(majorPath);
      ctx.strokeStyle = grid.axisColor ?? grid.majorColor;
      ctx.stroke(axis);
    },
  };
}

function isMultiple(value, of) {
  return Math.abs(value % of) < 1e-6;
}
