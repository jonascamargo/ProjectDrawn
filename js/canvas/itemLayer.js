import { theme } from '../theme/themeLoader.js';
import { intersects, resolveColor } from './itemLayout.js';
import { blurBehind, drawPin, drawResizeGrip, fitText, roundRectPath } from './shapes.js';
import { settings } from '../core/settings.js';
import { typeColor } from '../lang/nodeRegistry.js';
import { bus } from '../core/events.js';
import { drawChevron, drawGraph } from './graphRenderer.js';

// Desenha pastas e arquivos: card quando recolhido, área delimitada quando expandido.
export function createItemLayer(editor) {
  bus.on('settings:changed', () => editor.renderer?.invalidate());
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
        if (entry.toggle) drawChevron(ctx, entry.toggle.x, entry.toggle.y, !entry.expanded, style.cfg.textMuted);
        if (entry.resize) drawResizeGrip(ctx, entry.resize.x, entry.resize.y, style.cfg.textMuted, view.zoom);
        if (entry.graph) drawGraph(ctx, entry.graph, th, editor.graphStateFor(id), view.zoom, { blur: style.blur });
        drawPins(ctx, entry, editor, style);
        if (entry.scenePins && style.showText) drawScenePins(ctx, entry, style);
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
    // Desfoque do que fica atrás das áreas expandidas (configurações do app).
    blur: Math.max(0, Number(settings().areaBlur) || 0),
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
  if (style.showText) drawLabel(ctx, entry, style, x + 12, y + cfg.cardHeight / 2, x + w - (entry.toggle ? 34 : 12));
}

function drawArea(ctx, entry, state, style) {
  const { cfg, th } = style;
  const { x, y, w, h } = entry.rect;
  const accent = resolveColor(th, entry.item.color);

  blurBehind(ctx, x, y, w, h, cfg.radius, style.blur);
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
  if (style.showText) drawLabel(ctx, entry, style, x + 10, y + cfg.headerHeight / 2, x + w - (entry.toggle ? 34 : 12));
}

// Cena recolhida: nome de cada nó com propriedades (entrada, à esquerda) e sinais (saída, à direita) expostos.
function drawScenePins(ctx, entry, style) {
  const { cfg, th } = style;
  const { x, w } = entry.rect;
  const signal = th.wires?.signal?.color ?? cfg.textMuted;
  ctx.textBaseline = 'middle';
  for (const row of entry.scenePins) {
    if (row.title) {
      ctx.font = cfg.fontSmall;
      ctx.fillStyle = cfg.text;
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, row.title, w - 24), x + 12, row.y);
      continue;
    }
    ctx.font = cfg.fontSmall;
    ctx.fillStyle = cfg.textMuted;
    if (row.input) {
      drawPin(ctx, 'circle', x, row.y, 7, typeColor(row.input.type), false);
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, row.input.label, w / 2 - 14), x + 10, row.y);
    }
    if (row.output) {
      drawPin(ctx, 'square', x + w, row.y, 7, signal, false);
      ctx.textAlign = 'right';
      ctx.fillText(fitText(ctx, row.output.label, w / 2 - 14), x + w - 10, row.y);
    }
  }
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
