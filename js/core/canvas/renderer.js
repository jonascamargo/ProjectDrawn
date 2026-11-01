import { pinAnchor, pinDirection } from '../node.js';
import { describePin } from '../pin.js';
import { controlPoints, pointAt } from './curve.js';
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
    this.scene.refreshReroutes();
    for (const wire of this.scene.wires) this.drawWire(wire);
    for (const node of this.scene.elements) {
      if (node.reroute) this.drawReroute(node);
      else this.drawNode(node);
    }
    if (this.drag) this.drawDragWires();

    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    if (this.box) this.drawBox();
    if (this.hover) this.drawTooltip(this.hover);
    this.drawZoom();
  }

  // Cor do fio/pino: a do tipo de dado; sem tipo, a do tipo de fio (se o tema tiver) ou a neutra.
  pinColor(pin) {
    return (pin.type && this.language.types?.[pin.type]?.color) || this.theme.pin.kindColors?.[pin.kind] || this.theme.pin.color;
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
    if (this.selection.has(wire.id)) this.curve(a, b, style.selectedColor, style.selectedWidth, sides);
    this.curve(a, b, color, style.width, sides);
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
      if (o.pin.direction === 'out') this.curve(anchor, end, this.pinColor(o.pin), style.width, { dash, da: side });
      else this.curve(end, anchor, this.pinColor(o.pin), style.width, { dash, db: side });
    }
  }

  drawNode(node) {
    const { ctx } = this;
    const style = this.theme.node;
    const selected = this.selection.has(node.id);
    const header = this.language.categories?.[node.category]?.color ?? style.header;

    ctx.beginPath();
    ctx.roundRect(node.x, node.y, node.w, node.h, style.radius);
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(node.x, node.y, node.w, style.headerHeight, [style.radius, style.radius, 0, 0]);
    ctx.fillStyle = header;
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(node.x, node.y, node.w, node.h, style.radius);
    ctx.lineWidth = (selected ? style.selectedWidth : style.borderWidth) / this.camera.zoom;
    ctx.strokeStyle = selected ? style.selectedBorder : style.border;
    ctx.stroke();

    ctx.fillStyle = style.title;
    ctx.font = style.titleFont;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(node.title, node.x + style.padding, node.y + style.headerHeight / 2);

    for (const pin of node.inputs) this.drawPin(node, pin);
    for (const pin of node.outputs) this.drawPin(node, pin);
    ctx.textAlign = 'left';
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
    const size = style.pinSize * (hovered ? pinStyle.hoverScale : 1);
    ctx.globalAlpha = this.dimmed(node, pin) ? pinStyle.dimAlpha : 1;
    drawShape(ctx, pinStyle.shapes[pin.kind], px, py, size, {
      color: this.pinColor(pin),
      fill: style.fill,
      lineWidth: 1.5,
      filled: this.scene.isConnected(node, pin),
    });
    if (pin.label) {
      const offset = style.pinSize / 2 + style.labelGap;
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
      ctx.strokeStyle = this.theme.node.selectedBorder;
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
