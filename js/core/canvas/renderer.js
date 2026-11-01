import { drawGrid } from './grid.js';
import { boxMode, rectFromPoints } from './selection.js';

// Desenha o canvas em camadas: fundo, grade, elementos, retângulo de seleção, informações.
// Só redesenha quando alguém pede (requestRender), no próximo quadro.
export class Renderer {
  constructor(canvas, { camera, scene, selection, theme }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = camera;
    this.scene = scene;
    this.selection = selection;
    this.theme = theme;
    this.box = null; // { start, end } no mundo, enquanto a seleção por retângulo acontece
    this.width = 0;
    this.height = 0;
    this.ratio = 1;
    this.pending = false;
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
    for (const el of this.scene.elements) this.drawBlock(el);

    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    if (this.box) this.drawBox();
    this.drawZoom();
  }

  drawBlock(el) {
    const { ctx } = this;
    const style = this.theme.block;
    const selected = this.selection.has(el.id);
    ctx.beginPath();
    ctx.roundRect(el.x, el.y, el.w, el.h, style.radius);
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.lineWidth = (selected ? style.selectedWidth : style.borderWidth) / this.camera.zoom;
    ctx.strokeStyle = selected ? style.selectedBorder : style.border;
    ctx.stroke();
    ctx.fillStyle = style.title;
    ctx.font = style.font;
    ctx.textBaseline = 'top';
    ctx.fillText(el.title, el.x + style.padding, el.y + style.padding);
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
