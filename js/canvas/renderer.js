import { bus } from '../core/events.js';

// Renderizador por camadas. Só redesenha quando algo marca o quadro como sujo (invalidate).
// Cada camada: { id, order, space: 'world' | 'screen', draw(ctx, view) }
export class Renderer {
  #layers = [];
  #dirty = true;
  #frame = 0;

  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = camera;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;

    new ResizeObserver(() => this.resize()).observe(canvas);
    bus.on('theme:changed', () => this.invalidate());
    this.resize();
  }

  addLayer(layer) {
    this.#layers.push({ order: 0, space: 'world', ...layer });
    this.#layers.sort((a, b) => a.order - b.order);
    this.invalidate();
  }

  removeLayer(id) {
    this.#layers = this.#layers.filter((layer) => layer.id !== id);
    this.invalidate();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.invalidate();
  }

  invalidate() {
    this.#dirty = true;
    if (!this.#frame) this.#frame = requestAnimationFrame(() => this.#render());
  }

  #render() {
    this.#frame = 0;
    if (!this.#dirty) return;
    this.#dirty = false;

    const { ctx, camera, dpr } = this;
    const view = {
      width: this.width,
      height: this.height,
      zoom: camera.zoom,
      camera,
      visible: camera.visibleRect(this.width, this.height),
    };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    for (const layer of this.#layers) {
      ctx.save();
      if (layer.space === 'world') {
        ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, -camera.x * camera.zoom * dpr, -camera.y * camera.zoom * dpr);
      }
      try {
        layer.draw(ctx, view);
      } catch (error) {
        bus.emit('error', error);
      }
      ctx.restore();
    }
    bus.emit('render:frame', view);
  }
}
