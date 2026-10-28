import { theme } from '../theme/themeLoader.js';
import { relationType } from '../lang/profileLoader.js';
import { pointAlong, wirePoints } from './wireGeometry.js';

// Fios de relação entre itens (desenhados acima dos itens).
export function createWireLayer(editor) {
  return {
    id: 'wires',
    order: 10,
    space: 'world',
    draw(ctx, view) {
      const layout = editor.layout;
      const th = theme();
      if (!layout || !th) return;
      const cfg = th.wires.relation;
      const showLabels = view.zoom >= (th.canvas.item.lodTextZoom ?? 0.35);

      for (const wire of layout.wires) {
        const type = relationType(wire.relation.type);
        const selected = editor.selectedRelation === wire.relation.id;
        const color = selected ? th.wires.selectedColor : type.color ?? cfg.color;
        const points = wirePoints(wire.a, wire.b, type.route ?? cfg.route);
        strokeWire(ctx, points, color, (selected ? cfg.width + 1 : cfg.width) / Math.min(1, view.zoom), type.dash ?? cfg.dash);
        drawArrow(ctx, points, color, cfg.arrowSize ?? 8, th.pins?.size ?? 9);

        if (showLabels && type.label) {
          const mid = pointAlong(points, 0.5);
          ctx.font = cfg.labelFont;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const w = ctx.measureText(type.label).width + 8;
          ctx.fillStyle = th.canvas.background;
          ctx.fillRect(mid.x - w / 2, mid.y - 8, w, 16);
          ctx.fillStyle = color;
          ctx.fillText(type.label, mid.x, mid.y);
        }
      }
    },
  };
}

// Camada de sobreposição: fio sendo puxado e retângulo de seleção (laço).
export function createOverlayLayer(editor) {
  return {
    id: 'overlay',
    order: 20,
    space: 'world',
    draw(ctx, view) {
      const th = theme();
      if (!th) return;

      const drag = editor.wireDrag;
      if (drag) {
        const cfg = th.wires.relation;
        const [a, b] = drag.side === 'out' ? [drag.anchor, drag.point] : [drag.point, drag.anchor];
        const points = wirePoints(a, b, cfg.route);
        strokeWire(ctx, points, th.wires.previewColor, cfg.width / Math.min(1, view.zoom), [6, 4]);
      }

      const lasso = editor.lasso;
      if (lasso) {
        const sel = th.canvas.selection;
        ctx.fillStyle = sel.fill;
        ctx.fillRect(lasso.x, lasso.y, lasso.w, lasso.h);
        ctx.strokeStyle = sel.stroke;
        ctx.lineWidth = 1 / view.zoom;
        ctx.strokeRect(lasso.x, lasso.y, lasso.w, lasso.h);
      }
    },
  };
}

function strokeWire(ctx, points, color, width, dash) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(dash ?? []);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawArrow(ctx, points, color, size, pinSize) {
  const end = points[points.length - 1];
  let prev = points[points.length - 2];
  for (let i = points.length - 2; i >= 0 && Math.hypot(end.x - prev.x, end.y - prev.y) < 1; i--) prev = points[i];
  const angle = Math.atan2(end.y - prev.y, end.x - prev.x);
  const tipX = end.x - Math.cos(angle) * (pinSize / 2 + 1);
  const tipY = end.y - Math.sin(angle) * (pinSize / 2 + 1);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - Math.cos(angle - 0.45) * size, tipY - Math.sin(angle - 0.45) * size);
  ctx.lineTo(tipX - Math.cos(angle + 0.45) * size, tipY - Math.sin(angle + 0.45) * size);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
