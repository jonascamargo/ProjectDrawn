import { nodeIcon, pinAnchor, pinDirection, pinScope, tagLabel } from '../node.js';
import { ROOT } from '../scene.js';
import { describePin } from '../pin.js';
import { controlPoints, pointAt } from './curve.js';
import { iconWidth, tintedIcon } from './icons.js';
import { drawGrid } from './grid.js';
import { boxMode, rectFromPoints } from './selection.js';
import { drawShape } from './shapes.js';

// Desenha o canvas em camadas: fundo, grade, fios, nós, fio sendo puxado, retângulo de seleção,
// dica do pino, zoom. Só redesenha quando alguém pede (requestRender), no próximo quadro.
export class Renderer {
  constructor(canvas, { camera, scene, selection, theme, language }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = camera;
    this.scene = scene;
    this.selection = selection;
    this.theme = theme;
    this.language = language;
    this.box = null; // { start, end } no mundo, enquanto a seleção por retângulo acontece
    this.hover = null; // { node, pin } sob o mouse
    this.drag = null; // fio sendo puxado: { origins, point, target, check, compatible(node, pin) }
    this.drop = null; // destino do arraste entre áreas: { scope, ok, reason, point }
    this.width = 0;
    this.height = 0;
    this.ratio = 1;
    this.pending = false;
  }

  // Largura do texto na fonte dada (usada para o tamanho dos nós).
  measure(text, font) {
    this.ctx.font = font;
    return this.ctx.measureText(text).width;
  }

  // Tamanho em pixels da tela, nítido em monitores de alta densidade.
  resize(width, height) {
    const ratio = window.devicePixelRatio || 1;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.ratio = ratio;
    this.requestRender();
  }

  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.draw();
    });
  }

  draw() {
    const { ctx, theme } = this;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, this.width, this.height);
    drawGrid(ctx, this.camera, this.width, this.height, theme.grid);

    const { zoom, x, y } = this.camera;
    ctx.setTransform(this.ratio * zoom, 0, 0, this.ratio * zoom, -x * zoom * this.ratio, -y * zoom * this.ratio);
    this.scene.refreshLayout();
    this.drawScope(ROOT);
    if (this.drag) this.drawDragWires();

    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    if (this.drop) this.drawDrop();
    if (this.box) this.drawBox();
    if (this.hover) this.drawTooltip(this.hover);
    this.drawZoom();
  }

  // Cor do fio/pino: a do tipo de dado; sem tipo, a do tipo de fio (se o tema tiver) ou a neutra.
  pinColor(pin) {
    return (pin.type && this.language.types?.[pin.type]?.color) || this.theme.pin.kindColors?.[pin.kind] || this.theme.pin.color;
  }

  // Espessura do fio pelo tipo de fio da saída (ex.: fluxo mais grosso).
  wireWidth(pin) {
    return this.theme.wire.kindWidths?.[pin.kind] ?? this.theme.wire.width;
  }

  // Um escopo (raiz ou área aberta): primeiro os fios dele, depois os nós; uma área aberta desenha
  // a moldura, o que tem dentro e, por cima, o cabeçalho.
  drawScope(scope) {
    for (const wire of this.scene.wires) {
      if (pinScope(this.scene.byId(wire.from.node)) === scope) this.drawWire(wire);
    }
    for (const node of this.scene.inScope(scope)) {
      if (node.reroute) this.drawReroute(node);
      else if (node.area) this.drawArea(node);
      else this.drawNode(node);
    }
  }

  // Cor própria do nó: a que a linguagem der (pasta escolhida, extensão do arquivo) ou a do ícone.
  nodeColor(node) {
    return this.language.nodeColor?.(node) || nodeIcon(node, this.language)?.color || null;
  }

  // Borda do nó selecionado: a cor própria (ícone, extensão…) ou a do tipo (tag); sem nenhuma, a padrão.
  selectedBorder(node) {
    return this.nodeColor(node) || (node.tag && this.language.types?.[node.tag]?.color) || this.theme.node.selectedBorder;
  }

  // Borda do nó sem seleção: nós com cor própria já têm a borda nessa cor.
  border(node) {
    return this.nodeColor(node) || this.theme.node.border;
  }

  // da / db: lado para onde o fio sai de cada ponta (ver curve.js).
  curve(a, b, color, width, { dash = [], da = 1, db = -1 } = {}) {
    const { ctx } = this;
    const [p0, p1, p2, p3] = controlPoints(a, b, da, db);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.setLineDash(dash.map((d) => d / this.camera.zoom));
    ctx.lineWidth = width / this.camera.zoom;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawWire(wire) {
    const style = this.theme.wire;
    const { from, to } = this.scene.ends(wire);
    const a = pinAnchor(from.node, from.pin);
    const b = pinAnchor(to.node, to.pin);
    const color = this.pinColor(from.pin);
    const sides = { da: pinDirection(from.node, from.pin), db: pinDirection(to.node, to.pin) };
    const width = this.wireWidth(from.pin);
    if (this.selection.has(wire.id)) this.curve(a, b, style.selectedColor, width + style.selectedExtra, sides);
    this.curve(a, b, color, width, sides);
    // Ícone do tipo de fio no meio (não em fio que entra ou sai de reroute: ficaria repetido).
    if (from.node.reroute || to.node.reroute) return;
    const mid = pointAt(controlPoints(a, b, sides.da, sides.db), 0.5);
    drawShape(this.ctx, this.theme.pin.shapes[from.pin.kind], mid.x, mid.y, style.iconSize, {
      color, fill: color, lineWidth: 1, filled: true,
    });
  }

  // Fio sendo puxado: de cada origem até o ponteiro (ou até o pino alvo, se liga).
  drawDragWires() {
    const style = this.theme.wire;
    const { origins, point, target, check } = this.drag;
    const end = target && check?.ok ? pinAnchor(target.node, target.pin) : point;
    const dash = check && !check.ok ? style.invalidDash : [];
    for (const o of origins) {
      const anchor = pinAnchor(o.node, o.pin);
      const side = pinDirection(o.node, o.pin);
      const width = this.wireWidth(o.pin);
      if (o.pin.direction === 'out') this.curve(anchor, end, this.pinColor(o.pin), width, { dash, da: side });
      else this.curve(end, anchor, this.pinColor(o.pin), width, { dash, db: side });
    }
  }

  drawNode(node) {
    const { ctx } = this;
    const s = this.theme.node;
    const tag = this.theme.tag;
    const { headerY, tagX, tagW, titleX, dividerY } = node.layout;
    const selected = this.selection.has(node.id);

    ctx.beginPath();
    ctx.roundRect(node.x, node.y, node.w, node.h, s.radius);
    ctx.fillStyle = s.fill;
    ctx.fill();
    ctx.lineWidth = (selected ? s.selectedWidth : s.borderWidth) / this.camera.zoom;
    ctx.strokeStyle = selected ? this.selectedBorder(node) : this.border(node);
    ctx.stroke();
    this.drawHeaderContent(node, node.x, node.y);

    if (dividerY != null) {
      ctx.beginPath();
      ctx.moveTo(node.x + s.padding, node.y + dividerY + 0.5);
      ctx.lineTo(node.x + node.w - s.padding, node.y + dividerY + 0.5);
      ctx.lineWidth = 1 / this.camera.zoom;
      ctx.strokeStyle = s.divider;
      ctx.stroke();
    }

    for (const pin of node.inputs) this.drawPin(node, pin);
    for (const pin of node.outputs) this.drawPin(node, pin);
    ctx.textAlign = 'left';
  }

  // Etiqueta e nome do cabeçalho, com o cabeçalho em (ox, oy): pílula com ícone (na cor própria do
  // nó; área sem cor, a padrão) ou com o tipo (na cor do tipo de dado).
  drawHeaderContent(node, ox, oy) {
    const { ctx } = this;
    const s = this.theme.node;
    const tag = this.theme.tag;
    const { headerY, tagX, tagW, titleX } = node.layout;
    const label = tagLabel(node, this.language);
    const icon = nodeIcon(node, this.language);
    if (icon || label) {
      ctx.beginPath();
      ctx.roundRect(ox + tagX, oy + headerY - tag.height / 2, tagW, tag.height, tag.radius);
      ctx.fillStyle = icon
        ? this.nodeColor(node) || this.theme.area.defaultColor
        : this.language.types?.[node.tag]?.color ?? this.theme.pin.color;
      ctx.fill();
    }
    if (icon) this.drawIcon(icon, ox + tagX + tagW / 2, oy + headerY);
    if (label) {
      ctx.fillStyle = tag.text;
      ctx.font = tag.font;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(label, ox + tagX + tagW / 2, oy + headerY);
    }
    ctx.fillStyle = s.title;
    ctx.font = s.titleFont;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(node.title, ox + titleX, oy + headerY);
  }

  // Área: fechada é só o cabeçalho (como um nó compacto); aberta é a moldura com o conteúdo,
  // o cabeçalho no canto superior esquerdo e o puxador no canto inferior direito.
  drawArea(node) {
    const { ctx } = this;
    const s = this.theme.node;
    const a = this.theme.area;
    const l = node.layout;
    const selected = this.selection.has(node.id);
    const target = this.drop?.scope === node.id;
    const stroke = () => {
      // Destino do arraste: tracejado, verde se aceita, vermelho se não.
      const width = target ? a.dropWidth : selected ? s.selectedWidth : s.borderWidth;
      ctx.lineWidth = width / this.camera.zoom;
      ctx.strokeStyle = target ? (this.drop.ok ? a.dropOk : a.dropBad) : selected ? this.selectedBorder(node) : this.border(node);
      ctx.setLineDash(target ? a.dropDash.map((d) => d / this.camera.zoom) : []);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const hx = node.x + l.headerX;
    const hy = node.y + l.headerTop;
    if (node.open) {
      this.blurBehind(node);
      ctx.beginPath();
      ctx.roundRect(node.x, node.y, node.w, node.h, this.areaRadii());
      ctx.fillStyle = a.fill;
      ctx.fill();
      stroke();
      this.drawScope(node.id);
      this.drawHandle(node);
    }
    ctx.beginPath();
    ctx.roundRect(hx, hy, l.headerW, l.headerH, s.radius);
    ctx.fillStyle = s.fill;
    ctx.fill();
    if (node.open) {
      ctx.lineWidth = s.borderWidth / this.camera.zoom;
      ctx.strokeStyle = s.border;
      ctx.stroke();
    } else {
      stroke();
    }
    this.drawHeaderContent(node, hx, hy);
    for (const pin of [...node.inputs, ...node.outputs]) this.drawPin(node, pin);
    const toggle = a.toggleIcons[node.open ? 'open' : 'closed'];
    this.drawIcon(toggle, hx + l.toggleX + l.toggleW / 2, hy + l.headerY, a.toggleSize, a.toggleColor);
  }

  // Destino do arraste: na raiz, uma moldura na tela (verde/vermelha); o motivo perto do ponteiro.
  drawDrop() {
    const { ctx } = this;
    const a = this.theme.area;
    const style = this.theme.tooltip;
    if (this.drop.scope === ROOT) {
      ctx.lineWidth = a.dropWidth;
      ctx.strokeStyle = this.drop.ok ? a.dropOk : a.dropBad;
      ctx.strokeRect(a.dropWidth / 2, a.dropWidth / 2, this.width - a.dropWidth, this.height - a.dropWidth);
    }
    if (!this.drop.reason) return;
    const p = this.camera.toScreen(this.drop.point.x, this.drop.point.y);
    ctx.font = style.font;
    const w = ctx.measureText(this.drop.reason).width + style.padding * 2;
    const h = 12 + style.padding * 2;
    const x = Math.min(p.x + style.offset, this.width - w - 4);
    const y = Math.min(p.y + style.offset, this.height - h - 4);
    ctx.fillStyle = style.fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = this.drop.ok ? a.dropOk : a.dropBad;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = this.drop.ok ? style.color : style.invalidColor;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(this.drop.reason, x + style.padding, y + h / 2);
  }

  // Cantos da moldura da área aberta: o do puxador (inferior direito) é menor.
  areaRadii() {
    const r = this.theme.node.radius;
    return [r, r, this.theme.area.handleRadius, r];
  }

  // Desfoque do que já foi desenhado atrás da área aberta (vidro fosco): copia o pedaço da tela
  // dentro da moldura, desfocado. O fundo semitransparente vem por cima.
  blurBehind(node) {
    const blur = this.theme.area.blur;
    if (!blur) return;
    const { ctx } = this;
    const a = this.camera.toScreen(node.x, node.y);
    const r = this.ratio;
    const pad = blur * 2;
    const sx = Math.max(0, Math.floor((a.x - pad) * r));
    const sy = Math.max(0, Math.floor((a.y - pad) * r));
    const sw = Math.min(this.canvas.width - sx, Math.ceil((node.w * this.camera.zoom + pad * 2) * r));
    const sh = Math.min(this.canvas.height - sy, Math.ceil((node.h * this.camera.zoom + pad * 2) * r));
    if (sw <= 0 || sh <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(node.x, node.y, node.w, node.h, this.areaRadii());
    ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = `blur(${blur * this.camera.zoom * r}px)`;
    ctx.drawImage(this.canvas, sx, sy, sw, sh, sx, sy, sw, sh);
    ctx.restore();
  }

  // Puxador: três risquinhos diagonais no canto inferior direito da área aberta.
  drawHandle(node) {
    const { ctx } = this;
    const size = this.theme.area.pad;
    const right = node.x + node.w - 4;
    const bottom = node.y + node.h - 4;
    ctx.beginPath();
    for (const d of [size * 0.35, size * 0.65, size * 0.95]) {
      ctx.moveTo(right - d, bottom);
      ctx.lineTo(right, bottom - d);
    }
    ctx.lineWidth = 1.5 / this.camera.zoom;
    ctx.strokeStyle = this.theme.area.handleColor;
    ctx.stroke();
  }

  // Ícone SVG centrado em (cx, cy), com a altura h (padrão: a do tema), pintado na cor (padrão: a do tema).
  // A cópia pintada tem a resolução da tela no zoom atual (em degraus de 8px, até 128px).
  drawIcon(icon, cx, cy, h = this.theme.icon.size, color = this.theme.icon.color) {
    if (!icon?.image) return;
    const w = iconWidth(icon, h);
    const pixels = Math.min(128, Math.ceil((h * this.ratio * this.camera.zoom) / 8) * 8);
    this.ctx.drawImage(tintedIcon(icon, color, pixels), cx - w / 2, cy - h / 2, w, h);
  }

  // Enquanto um fio é puxado, os pinos que não ligam com ele ficam apagados.
  dimmed(node, pin) {
    return !!this.drag && !this.drag.origins.some((o) => o.node === node && o.pin === pin) && !this.drag.compatible(node, pin);
  }

  drawPin(node, pin) {
    const { ctx } = this;
    const style = this.theme.node;
    const pinStyle = this.theme.pin;
    const px = node.x + pin.cx;
    const py = node.y + pin.cy;
    const hovered = this.hover?.pin === pin;
    const base = pin.size ?? style.pinSize;
    const size = base * (hovered ? pinStyle.hoverScale : 1);
    ctx.globalAlpha = this.dimmed(node, pin) ? pinStyle.dimAlpha : 1;
    drawShape(ctx, pinStyle.shapes[pin.kind], px, py, size, {
      color: this.pinColor(pin),
      fill: style.fill,
      lineWidth: style.pinStroke,
      filled: this.scene.isConnected(node, pin),
    });
    if (pin.label) {
      const offset = base / 2 + style.labelGap;
      ctx.fillStyle = style.label;
      ctx.font = style.labelFont;
      ctx.textBaseline = 'middle';
      ctx.textAlign = pin.direction === 'in' ? 'left' : 'right';
      ctx.fillText(pin.label, pin.direction === 'in' ? px + offset : px - offset, py);
    }
    ctx.globalAlpha = 1;
  }

  // Reroute: só o ponto visível (a área de clique, maior, não aparece).
  drawReroute(node) {
    const { ctx } = this;
    const style = this.theme.reroute;
    const pin = node.outputs[0];
    const c = pinAnchor(node, pin);
    const hovered = this.hover?.node === node;
    if (this.selection.has(node.id)) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, style.size / 2 + 3, 0, Math.PI * 2);
      ctx.lineWidth = 2 / this.camera.zoom;
      ctx.strokeStyle = this.pinColor(node.outputs[0]); // reroute: na cor do fio
      ctx.stroke();
    }
    ctx.globalAlpha = this.dimmed(node, node.inputs[0]) && this.dimmed(node, pin) ? this.theme.pin.dimAlpha : 1;
    const color = this.pinColor(pin);
    drawShape(ctx, 'circle', c.x, c.y, style.size * (hovered ? this.theme.pin.hoverScale : 1), {
      color, fill: color, lineWidth: 1, filled: true,
    });
    ctx.globalAlpha = 1;
  }

  // Contínuo quando pega só o que fica inteiro dentro; tracejado quando pega o que toca.
  drawBox() {
    const { ctx } = this;
    const style = this.theme.selectionBox;
    const a = this.camera.toScreen(this.box.start.x, this.box.start.y);
    const b = this.camera.toScreen(this.box.end.x, this.box.end.y);
    const r = rectFromPoints(a, b);
    ctx.fillStyle = style.fill;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash(boxMode(this.box.start, this.box.end) === 'inside' ? [] : style.dash);
    ctx.strokeStyle = style.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    ctx.setLineDash([]);
  }

  // Dica do pino; puxando um fio sobre um pino que não liga, mostra o motivo.
  drawTooltip({ node, pin }) {
    const { ctx } = this;
    const style = this.theme.tooltip;
    const check = this.drag?.check;
    const invalid = check && !check.ok;
    const text = invalid ? check.reason : describePin(pin, this.language.types?.[pin.type]?.label);
    const p = this.camera.toScreen(node.x + pin.cx, node.y + pin.cy);
    ctx.font = style.font;
    const w = ctx.measureText(text).width + style.padding * 2;
    const h = 12 + style.padding * 2;
    // À direita do pino de saída, à esquerda do de entrada; sempre dentro da tela.
    let x = pin.direction === 'out' ? p.x + style.offset : p.x - style.offset - w;
    x = Math.min(Math.max(4, x), this.width - w - 4);
    const y = Math.min(Math.max(4, p.y - h / 2), this.height - h - 4);
    ctx.fillStyle = style.fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = invalid ? style.invalidBorder : style.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = invalid ? style.invalidColor : style.color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + style.padding, y + h / 2);
  }

  drawZoom() {
    const { ctx } = this;
    const style = this.theme.zoomLabel;
    ctx.fillStyle = style.color;
    ctx.font = style.font;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(this.camera.zoom * 100)}%`, this.width - 12, this.height - 10);
    ctx.textAlign = 'left';
  }
}
