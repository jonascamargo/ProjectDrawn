import { blurBehind, drawPin, drawResizeGrip, fitText, roundRectPath } from './shapes.js';
import { hasHeader, literalText, paintOrder } from './graphLayout.js';

// Desenha o grafo de um script (sub-áreas, fios e nós) já posicionado no mundo.
// O último selecionado fica por cima dentro da área pai (ordem de paintOrder).
// state: { selectedNodes: Set, selectedScopes: Set, selectedWire, hoverPin: { nodeId, pinId, side } }
// opts: { blur } raio do desfoque atrás das sub-áreas (px de tela; 0 = sem).
export function drawGraph(ctx, g, theme, state, zoom, { blur = 0 } = {}) {
  const s = theme.node;
  const sc = theme.scope;
  const showText = zoom >= (s.lodTextZoom ?? 0.4);
  const line = Math.max(1, 1 / zoom);
  const { back, layers, freeWires } = paintOrder(g, state.raisedNodes ?? state.selectedNodes, state.raisedScopes ?? state.selectedScopes);

  for (const c of back) drawComment(ctx, c, s, state, showText, line, zoom);
  drawWires(ctx, freeWires, theme, state, zoom, showText);
  for (const layer of layers) {
    if (layer.node) {
      drawNode(ctx, layer.node, s, theme, state, showText, line);
      continue;
    }
    const scope = layer.scope;
    const selected = state.selectedScopes.has(scope.scope.id);
    if (scope.collapsed) {
      drawCollapsedScope(ctx, scope, s, selected, showText, line);
      continue;
    }
    drawScope(ctx, scope, sc, selected, line, blur);
    drawResizeGrip(ctx, scope.resize.x, scope.resize.y, scope.color ?? sc.border, zoom);
    for (const c of layer.comments) drawComment(ctx, c, s, state, showText, line, zoom);
    drawWires(ctx, layer.wires, theme, state, zoom, showText);
    for (const node of layer.nodes) drawNode(ctx, node, s, theme, state, showText, line);
  }
}

// Caixa de comentário: fundo translúcido na cor escolhida, faixa de título, texto e alça.
function drawComment(ctx, c, s, state, showText, line, zoom) {
  const { x, y, w, h } = c.rect;
  const selected = state.selectedNodes.has(c.node.id);
  roundRectPath(ctx, x, y, w, h, s.radius);
  ctx.fillStyle = c.color;
  ctx.globalAlpha = 0.14;
  ctx.fill();
  ctx.save();
  roundRectPath(ctx, x, y, w, h, s.radius);
  ctx.clip();
  ctx.globalAlpha = 0.7;
  ctx.fillRect(x, y, w, s.headerHeight);
  ctx.restore();
  ctx.globalAlpha = 1;
  roundRectPath(ctx, x, y, w, h, s.radius);
  ctx.strokeStyle = selected ? s.selected : c.color;
  ctx.lineWidth = selected ? Math.max(2, line * 2) : line;
  ctx.setLineDash(c.group ? [] : [5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (showText) {
    ctx.font = s.titleFont;
    ctx.fillStyle = s.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, c.title, w - s.padding * 2), x + s.padding, y + s.headerHeight / 2);
    if (c.text) {
      ctx.font = s.font;
      ctx.fillStyle = s.textMuted;
      ctx.textBaseline = 'top';
      const lineH = s.rowHeight * 0.8;
      c.text.split('\n').forEach((row, i) => {
        const ty = y + s.headerHeight + 8 + i * lineH;
        if (ty + lineH < y + h - 4) ctx.fillText(fitText(ctx, row, w - s.padding * 2), x + s.padding, ty);
      });
    }
  }
  drawResizeGrip(ctx, c.resize.x, c.resize.y, c.color, zoom);
}

function drawWires(ctx, wires, theme, state, zoom, showText = true) {
  const s = theme.node;
  for (const wire of wires) {
    const selected = state.selectedWire === wire.wire.id;
    const flow = theme.wires.flow;
    const data = theme.wires.data;
    const tree = theme.wires.tree ?? data;
    const signal = theme.wires.signal ?? data;
    let color = wire.kind === 'flow' ? flow.color : wire.kind === 'tree' ? tree.color : wire.kind === 'signal' ? signal.color : wire.color;
    if (wire.invalid) color = s.invalid;
    if (selected) color = theme.wires.selectedColor;
    const width = (wire.kind === 'flow' ? flow.width : wire.kind === 'tree' ? tree.width : wire.kind === 'signal' ? signal.width : data.width) + (selected ? 1.5 : 0);
    ctx.beginPath();
    ctx.moveTo(wire.points[0].x, wire.points[0].y);
    for (let i = 1; i < wire.points.length; i++) ctx.lineTo(wire.points[i].x, wire.points[i].y);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(width, (width / zoom) * 0.6);
    ctx.setLineDash(wire.invalid ? [6, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Etiquetas por cima dos fios.
  if (!showText) return;
  for (const wire of wires) {
    const label = wire.label;
    if (!label) continue;
    const selected = state.selectedWire === wire.wire.id;
    roundRectPath(ctx, label.x, label.y, label.w, label.h, label.h / 2);
    ctx.fillStyle = label.color ?? s.valueBackground;
    ctx.fill();
    ctx.strokeStyle = selected ? theme.wires.selectedColor : wire.kind === 'data' ? wire.color ?? s.border : theme.wires[wire.kind]?.color ?? s.border;
    ctx.lineWidth = Math.max(1, 1 / zoom);
    ctx.stroke();
    ctx.font = s.smallFont;
    ctx.fillStyle = s.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, label.text, label.w - 8), label.x + label.w / 2, label.y + label.h / 2 + 0.5);
  }
}

// Seta de recolher/expandir (▸ recolhido, ▾ expandido).
export function drawChevron(ctx, x, y, collapsed, color) {
  ctx.beginPath();
  if (collapsed) {
    ctx.moveTo(x - 2.5, y - 4);
    ctx.lineTo(x + 3, y);
    ctx.lineTo(x - 2.5, y + 4);
  } else {
    ctx.moveTo(x - 4, y - 2.5);
    ctx.lineTo(x, y + 3);
    ctx.lineTo(x + 4, y - 2.5);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// Sub-área expandida: sem cabeçalho, só fundo e contorno na cor da categoria.
function drawScope(ctx, scope, sc, selected, line, blur) {
  const { x, y, w, h } = scope.rect;
  blurBehind(ctx, x, y, w, h, 8, blur);
  roundRectPath(ctx, x, y, w, h, 8);
  ctx.fillStyle = blur ? sc.blurBackground ?? sc.background : sc.background;
  ctx.fill();
  roundRectPath(ctx, x, y, w, h, 8);
  ctx.strokeStyle = selected ? sc.selected : scope.color ?? sc.border;
  ctx.lineWidth = Math.max(2, line * 2);
  ctx.stroke();
}

function drawCollapsedScope(ctx, scope, s, selected, showText, line) {
  const { x, y, w, h } = scope.rect;
  roundRectPath(ctx, x, y, w, h, s.radius);
  ctx.fillStyle = s.background;
  ctx.fill();
  ctx.save();
  roundRectPath(ctx, x, y, w, h, s.radius);
  ctx.clip();
  ctx.fillStyle = scope.color;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(x, y, w, s.headerHeight);
  ctx.globalAlpha = 1;
  ctx.restore();
  roundRectPath(ctx, x, y, w, h, s.radius);
  ctx.strokeStyle = selected ? s.selected : s.border;
  ctx.lineWidth = selected ? Math.max(2, line * 2) : line;
  ctx.stroke();
  if (showText) {
    ctx.font = s.titleFont;
    ctx.fillStyle = s.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, scope.title, w - s.padding * 2 - 18), x + s.padding, y + s.headerHeight / 2);
  }
  for (const pin of scope.params ?? []) {
    drawPin(ctx, pin.shape, pin.x, pin.y, 9, pin.color, false);
    if (showText) {
      ctx.font = s.font;
      ctx.fillStyle = s.textMuted;
      ctx.textAlign = 'left';
      ctx.fillText(pin.pin.label ?? '', pin.x + s.pinGap, pin.y);
    }
  }
  drawChevron(ctx, scope.toggle.x, scope.toggle.y, true, s.text);
}

function drawNode(ctx, n, s, theme, state, showText, line) {
  const { x, y, w, h } = n.rect;
  // A entrada aparece selecionada junto com a sub-área (ela é o "cabeçalho" da sub-área).
  const selected = state.selectedNodes.has(n.node.id) || (n.template === 'event' && state.selectedScopes.has(n.node.scopeId));

  if (n.template === 'reroute') {
    const pin = n.outputs[0] ?? n.inputs[0];
    const color = pin?.pin.kind === 'flow' ? theme.wires.flow.color : pin?.color ?? s.text;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, w / 2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = s.selected;
      ctx.lineWidth = Math.max(2, line * 2);
      ctx.stroke();
    }
    return;
  }

  const radius = n.template === 'literal' ? Math.min(h / 2, 14) : s.radius;
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = s.background;
  ctx.fill();

  const header = hasHeader(n.template);
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.fillStyle = n.color;
  if (header) {
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, y, w, s.headerHeight);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillRect(x, y, n.template === 'event' ? 4 : 3, h);
  }
  ctx.restore();

  roundRectPath(ctx, x, y, w, h, radius);
  ctx.strokeStyle = !n.def ? s.invalid : selected ? s.selected : s.border;
  ctx.lineWidth = selected || !n.def ? Math.max(2, line * 2) : line;
  ctx.stroke();

  if (showText) {
    ctx.textBaseline = 'middle';
    if (header) {
      ctx.font = s.titleFont;
      ctx.fillStyle = s.text;
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, n.title, w - s.padding * 2 - 16), x + s.padding, y + s.headerHeight / 2);
      if (n.subtitle) {
        ctx.font = s.smallFont;
        ctx.fillStyle = s.textMuted;
        ctx.fillText(fitText(ctx, n.subtitle, w - s.padding * 2), x + s.padding, y + s.headerHeight + s.subtitleHeight / 2);
      }
    } else if (n.template === 'literal') {
      ctx.font = s.titleFont;
      ctx.fillStyle = s.text;
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, literalText(n.node) || n.title, w - s.padding * 2 - 12), x + s.padding + 2, y + 4 + s.rowHeight / 2);
    } else if (n.template === 'compact') {
      if (n.subtitle) {
        ctx.font = s.smallFont;
        ctx.fillStyle = s.textMuted;
        ctx.textAlign = 'center';
        ctx.fillText(fitText(ctx, n.subtitle, w - 8), x + w / 2, y + 4 + s.subtitleHeight / 2);
      }
      ctx.font = s.compactTitleFont;
      ctx.fillStyle = s.text;
      ctx.textAlign = 'center';
      const top = y + 4 + (n.subtitle ? s.subtitleHeight : 0);
      const rows = Math.max(1, Math.max(n.inputs.length, n.outputs.length));
      ctx.fillText(fitText(ctx, n.title, w - 28), x + w / 2, top + (rows * s.rowHeight) / 2);
    }
    if (!n.def) {
      ctx.font = s.smallFont;
      ctx.fillStyle = s.invalid;
      ctx.textAlign = 'left';
      ctx.fillText('?', x + s.padding, y + h - 8);
    }
  }

  const hover = state.hoverPin;
  for (const pin of [...n.inputs, ...n.outputs]) {
    const isHover = hover && hover.nodeId === n.node.id && hover.pinId === pin.pin.id && hover.side === pin.side;
    const color = pin.pin.kind === 'flow' ? theme.wires.flow.color : pin.pin.kind === 'tree' || pin.pin.kind === 'signal' ? theme.wires[pin.pin.kind]?.color ?? pin.color : pin.color;
    const size = (pin.pin.kind === 'flow' ? 10 : 9) * (isHover ? 1.3 : 1);
    drawPin(ctx, pin.shape, pin.x, pin.y, size, color, pin.connected || isHover);

    if (!showText) continue;
    ctx.font = s.font;
    ctx.fillStyle = s.textMuted;
    ctx.textBaseline = 'middle';
    if (pin.side === 'in') {
      ctx.textAlign = 'left';
      if (pin.pin.label && n.template !== 'compact') ctx.fillText(pin.pin.label, pin.x + s.pinGap, pin.y);
      if (pin.box) {
        roundRectPath(ctx, pin.box.x, pin.box.y, pin.box.w, pin.box.h, 3);
        ctx.fillStyle = s.valueBackground;
        ctx.fill();
        ctx.fillStyle = s.valueText;
        ctx.fillText(fitText(ctx, pin.box.text, pin.box.w - 8), pin.box.x + 4, pin.y);
      }
    } else if (pin.pin.label && n.template !== 'compact' && n.template !== 'literal') {
      ctx.textAlign = 'right';
      ctx.fillText(pin.pin.label, pin.x - s.pinGap, pin.y);
    }
  }

  for (const add of [n.addIn, n.addOut]) {
    if (!add) continue;
    ctx.beginPath();
    ctx.arc(add.x, add.y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = s.textMuted;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (showText) {
      ctx.font = s.titleFont;
      ctx.fillStyle = s.textMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+', add.x, add.y + 0.5);
    }
  }

  if (n.toggle) drawChevron(ctx, n.toggle.x, n.toggle.y, n.collapsed, s.text);
  if (n.links?.length && showText) {
    ctx.font = s.font;
    ctx.fillStyle = s.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const link of n.links) ctx.fillText(link.glyph, link.x, link.y + 1);
  }
}
