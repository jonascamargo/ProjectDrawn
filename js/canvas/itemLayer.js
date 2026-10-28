import { theme } from '../theme/themeLoader.js';
import { intersects, resolveColor } from './itemLayout.js';
import { drawPin, fitText, roundRectPath } from './shapes.js';

// Desenha pastas e arquivos: card quando recolhido, área delimitada quando expandido.
export function createItemLayer(editor) {
  return {
    id: 'items',
    order: 0,
    space: 'world',
    draw(ctx, view) {
      const layout = editor.layout;
      const th = theme();
      if (!layout || !th) return;

      const style = buildStyle(th, view.zoom);
      const dragged = editor.dragSubtree;
      const normal = [];
      const onTop = [];
      for (const id of layout.order) (dragged?.has(id) ? onTop : normal).push(id);

      const visible = { x: view.visible.x, y: view.visible.y, w: view.visible.width, h: view.visible.height };
      for (const id of normal.concat(onTop)) {
        const entry = layout.entries.get(id);
        if (!intersects(entry.rect, visible)) continue;
        const state = {
          selected: editor.selection.has(id),
          dropTarget: editor.dropTarget === id,
        };
        if (entry.expanded) drawArea(ctx, entry, state, style);
        else drawCard(ctx, entry, state, style);
        drawPins(ctx, entry, editor, style);
      }
    },
  };
}

function buildStyle(th, zoom) {
  const cfg = th.canvas.item;
  return {
    th,
    cfg,
    zoom,
    showText: zoom >= cfg.lodTextZoom,
    line: Math.max(1, 1 / zoom),
    strongLine: Math.max(2, 2 / zoom),
  };
}

function icon(style, entry) {
  const icons = style.th.icons ?? {};
  if (entry.item.kind === 'folder') return (entry.expanded ? icons.folderOpen : icons.folder) ?? '';
  return icons[entry.fileType.category] ?? icons.other ?? '';
}

function subtitle(entry) {
  if (entry.item.kind === 'folder') return entry.childCount ? String(entry.childCount) : '';
  return entry.fileType.label ?? '';
}

function outline(ctx, entry, state, style, accent) {
  const { cfg } = style;
  const { x, y, w, h } = entry.rect;
  roundRectPath(ctx, x, y, w, h, cfg.radius);
  if (state.dropTarget) {
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = cfg.dropTarget;
    ctx.lineWidth = style.strongLine;
  } else if (state.selected) {
    ctx.strokeStyle = cfg.selected;
    ctx.lineWidth = style.strongLine;
  } else {
    ctx.strokeStyle = accent ?? cfg.border;
    ctx.lineWidth = accent ? style.strongLine : style.line;
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawLabel(ctx, entry, style, x, centerY, maxRight) {
  const { cfg } = style;
  ctx.textBaseline = 'middle';
  ctx.font = cfg.iconFont;
  ctx.textAlign = 'left';
  ctx.fillText(icon(style, entry), x, centerY + 1);

  const sub = subtitle(entry);
  ctx.font = cfg.fontSmall;
  const subWidth = sub ? ctx.measureText(sub).width : 0;
  if (sub) {
    ctx.fillStyle = cfg.textMuted;
    ctx.textAlign = 'right';
    ctx.fillText(sub, maxRight, centerY);
  }

  ctx.font = cfg.font;
  ctx.fillStyle = cfg.text;
  ctx.textAlign = 'left';
  const nameX = x + 24;
  ctx.fillText(fitText(ctx, entry.item.name, maxRight - nameX - subWidth - 8), nameX, centerY);
}

function drawCard(ctx, entry, state, style) {
  const { cfg, th } = style;
  const { x, y, w, h } = entry.rect;
  const accent = resolveColor(th, entry.item.color);

  roundRectPath(ctx, x, y, w, h, cfg.radius);
  ctx.fillStyle = cfg.background;
  ctx.fill();

  if (accent) {
    ctx.save();
    roundRectPath(ctx, x, y, w, h, cfg.radius);
    ctx.clip();
    ctx.fillStyle = accent;
    ctx.fillRect(x, y, cfg.accentWidth, h);
    ctx.restore();
  }

  outline(ctx, entry, state, style, null);
  if (style.showText) drawLabel(ctx, entry, style, x + 12, y + cfg.cardHeight / 2, x + w - 12);
}

function drawArea(ctx, entry, state, style) {
  const { cfg, th } = style;
  const { x, y, w, h } = entry.rect;
  const accent = resolveColor(th, entry.item.color);

  roundRectPath(ctx, x, y, w, h, cfg.radius);
  ctx.fillStyle = cfg.areaBackground;
  ctx.fill();

  ctx.save();
  roundRectPath(ctx, x, y, w, h, cfg.radius);
  ctx.clip();
  ctx.fillStyle = cfg.header;
  ctx.fillRect(x, y, w, cfg.headerHeight);
  if (accent) {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.18;
    ctx.fillRect(x, y, w, cfg.headerHeight);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  outline(ctx, entry, state, style, accent);
  if (style.showText) drawLabel(ctx, entry, style, x + 10, y + cfg.headerHeight / 2, x + w - 12);
}

function drawPins(ctx, entry, editor, style) {
  const pins = style.th.pins ?? {};
  const relation = pins.relation ?? {};
  const size = pins.size ?? 9;
  const hover = editor.hoverPin;
  const color = relation.color ?? style.cfg.text;

  const inHover = hover?.id === entry.item.id && hover.side === 'in';
  const outHover = hover?.id === entry.item.id && hover.side === 'out';
  drawPin(ctx, relation.shape, entry.inPin.x, entry.inPin.y, inHover ? size * 1.3 : size, color, entry.connected.in || inHover);
  drawPin(ctx, relation.shape, entry.outPin.x, entry.outPin.y, outHover ? size * 1.3 : size, color, entry.connected.out || outHover);

  // Pinos por conexão de itens escondidos dentro de uma pasta recolhida.
  const proxySize = size * 0.75;
  for (const proxy of [...entry.proxiesIn, ...entry.proxiesOut]) {
    drawPin(ctx, relation.shape, proxy.x, proxy.y, proxySize, editor.relationColor(proxy.relation), true);
  }
}
