import { theme } from '../theme/themeLoader.js';
import { relationType } from '../lang/profileLoader.js';
import { pointAlong, wirePoints } from './wireGeometry.js';

// Ligações entre arquivos destacadas a partir das Propriedades: a que está sob o mouse
// (editor.linkHover) e as fixadas (editor.linkPinned). Saem do nó que faz a referência
// (ou do card, se a área estiver recolhida) e chegam no destino (função/card); itens dentro
// de pasta recolhida usam a pasta visível mais próxima.
export function createWireLayer(editor) {
  return {
    id: 'links',
    order: 10,
    space: 'world',
    draw(ctx, view) {
      const layout = editor.layout;
      const th = theme();
      if (!layout || !th || !editor.project) return;
      const cfg = th.wires.relation;
      const links = [...editor.linkPinned.values()];
      if (editor.linkHover && !editor.linkPinned.has(editor.linkHover.key)) links.push(editor.linkHover);
      for (const link of links) {
        const a = anchor(editor, layout, link.from);
        const b = anchor(editor, layout, link.to);
        if (!a || !b || a.rect === b.rect) continue;
        const start = { x: a.rect.x + a.rect.w, y: a.rect.y + Math.min(a.rect.h / 2, 20) };
        const end = { x: b.rect.x, y: b.rect.y + Math.min(b.rect.h / 2, 20) };
        const type = relationType(link.kind);
        const color = type.color ?? cfg.color;
        const hover = editor.linkHover?.key === link.key;
        const points = wirePoints(start, end, 'bezier');
        strokeWire(ctx, points, color, ((hover ? cfg.width + 1.5 : cfg.width) + 0.5) / Math.min(1, view.zoom), type.dash ?? [8, 5]);
        drawArrow(ctx, points, color, (cfg.arrowSize ?? 8) / Math.min(1, view.zoom), 0);
        for (const r of [a.rect, b.rect]) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5 / Math.min(1, view.zoom);
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
          ctx.setLineDash([]);
        }
      }
    },
  };
}

// Retângulo de uma ponta da ligação: nó/sub-área se o arquivo estiver expandido, senão o card
// do arquivo ou da pasta visível mais próxima.
function anchor(editor, layout, end) {
  let id = end.fileId;
  let entry = layout.entries.get(id);
  while (!entry && id) {
    id = editor.project.get(id)?.parentId ?? null;
    entry = id ? layout.entries.get(id) : null;
  }
  if (!entry) return null;
  if (entry.item.id === end.fileId && entry.expanded && entry.graph) {
    const node = end.nodeId && entry.graph.nodes.get(end.nodeId);
    if (node) return { rect: node.rect };
    const scope = end.scopeId && entry.graph.scopes.get(end.scopeId);
    if (scope) return { rect: scope.rect };
  }
  return { rect: entry.rect };
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
