import { isIgnored, isReal } from '../core/realItems.js';
import { theme } from '../theme/themeLoader.js';
import { intersects, resolveColor } from './itemLayout.js';
import { blurBehind, drawResizeGrip, fitText, roundRectPath } from './shapes.js';
import { settings } from '../core/settings.js';
import { bus } from '../core/events.js';
import { drawChevron, drawGraph } from './graphRenderer.js';
import { CANVAS_COMMENT_LINE, wrapLines } from './commentText.js';

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
        if (entry.item.kind === 'comment') drawComment(ctx, entry, state, style);
        else if (entry.expanded) drawArea(ctx, entry, state, style);
        else drawCard(ctx, entry, state, style);
        if (style.showText && isReal(editor.project, entry.item)) drawRealBadge(ctx, entry, style, isIgnored(editor.project, entry.item));
        if (entry.toggle) drawChevron(ctx, entry.toggle.x, entry.toggle.y, !entry.expanded, style.cfg.textMuted);
        if (entry.resize) drawResizeGrip(ctx, entry.resize.x, entry.resize.y, style.cfg.textMuted, view.zoom);
        if (entry.graph) drawGraph(ctx, entry.graph, th, editor.graphStateFor(id), view.zoom, { blur: style.blur });
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

// Ícone pequeno no canto superior esquerdo: item do diretório real (🔒) ou ignorado (⊘).
function drawRealBadge(ctx, entry, style, ignored) {
  const cx = entry.rect.x + 1;
  const cy = entry.rect.y + 1;
  ctx.fillStyle = style.cfg.background;
  ctx.strokeStyle = style.cfg.textMuted;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  if (ignored) {
    ctx.moveTo(cx - 3, cy + 3);
    ctx.lineTo(cx + 3, cy - 3);
  } else {
    // cadeado: alça + corpo
    ctx.arc(cx, cy - 1, 1.8, Math.PI, 0);
    ctx.rect(cx - 2.5, cy - 0.5, 5, 3.5);
  }
  ctx.stroke();
}

// Caixa de comentário: cor suave, cabeçalho com o título e o texto embaixo.
function drawComment(ctx, entry, state, style) {
  const { cfg, th } = style;
  const { x, y, w, h } = entry.rect;
  const color = resolveColor(th, entry.item.color) ?? cfg.textMuted;
  const header = 26;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, cfg.radius);
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 0.28;
  ctx.fillRect(x, y, w, header);
  ctx.restore();
  roundRectPath(ctx, x, y, w, h, cfg.radius);
  ctx.strokeStyle = state.selected ? cfg.selected : color;
  ctx.lineWidth = state.selected ? style.strongLine : style.line;
  if (entry.item.group === false) ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (!style.showText) return;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = cfg.font;
  ctx.fillStyle = cfg.text;
  ctx.fillText(fitText(ctx, entry.item.name || '', w - 20), x + 10, y + header / 2);
  ctx.font = cfg.fontSmall;
  ctx.fillStyle = cfg.textMuted;
  ctx.textBaseline = 'top';
  ctx.save();
  roundRectPath(ctx, x, y, w, h, cfg.radius);
  ctx.clip();
  wrapLines(ctx, entry.item.description ?? '', w - 20).forEach((line, i) => ctx.fillText(line, x + 10, y + header + 8 + i * CANVAS_COMMENT_LINE));
  ctx.restore();
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
