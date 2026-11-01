import { describePin } from '../pin.js';
import { drawGrid } from './grid.js';
import { boxMode, rectFromPoints } from './selection.js';
import { drawShape } from './shapes.js';

// Desenha o canvas em camadas: fundo, grade, nós, retângulo de seleção, dica do pino, zoom.
// Só redesenha quando alguém pede (requestRender), no próximo quadro.
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
    for (const node of this.scene.elements) this.drawNode(node);

    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    if (this.box) this.drawBox();
    if (this.hover) this.drawTooltip(this.hover);
    this.drawZoom();
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

  drawPin(node, pin) {
    const { ctx } = this;
    const style = this.theme.node;
    const pinStyle = this.theme.pin;
    const px = node.x + pin.cx;
    const py = node.y + pin.cy;
    const hovered = this.hover?.pin === pin;
    const size = style.pinSize * (hovered ? pinStyle.hoverScale : 1);
    drawShape(ctx, pinStyle.shapes[pin.kind], px, py, size, {
      color: this.pinColor(pin),
      fill: style.fill,
      lineWidth: 1.5,
    });
    if (!pin.label) return;
    const offset = style.pinSize / 2 + style.labelGap;
    ctx.fillStyle = style.label;
    ctx.font = style.labelFont;
    ctx.textBaseline = 'middle';
    ctx.textAlign = pin.direction === 'in' ? 'left' : 'right';
    ctx.fillText(pin.label, pin.direction === 'in' ? px + offset : px - offset, py);
  }

  pinColor(pin) {
    return (pin.type && this.language.types?.[pin.type]?.color) || this.theme.pin.color;
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

  drawTooltip({ node, pin }) {
    const { ctx } = this;
    const style = this.theme.tooltip;
    const text = describePin(pin, this.language.types?.[pin.type]?.label);
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
    ctx.strokeStyle = style.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = style.color;
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
