// Câmera do canvas: (x, y) é o ponto do mundo no canto superior esquerdo da tela; zoom é a escala.
export class Camera {
  constructor({ minZoom = 0.1, maxZoom = 4 } = {}) {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
  }

  toWorld(sx, sy) {
    return { x: sx / this.zoom + this.x, y: sy / this.zoom + this.y };
  }

  toScreen(wx, wy) {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }

  // Move a vista pelo deslocamento do mouse, em pixels da tela.
  panBy(dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }

  // Muda o zoom mantendo parado o ponto do mundo que está sob (sx, sy).
  zoomAt(sx, sy, zoom) {
    const anchor = this.toWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
    this.x = anchor.x - sx / this.zoom;
    this.y = anchor.y - sy / this.zoom;
  }

  // Enquadra o retângulo do mundo na tela (sem passar de 100%).
  frame(rect, viewWidth, viewHeight, padding = 40) {
    const fit = Math.min((viewWidth - padding * 2) / rect.w, (viewHeight - padding * 2) / rect.h);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, Math.min(1, fit)));
    this.x = rect.x + rect.w / 2 - viewWidth / 2 / this.zoom;
    this.y = rect.y + rect.h / 2 - viewHeight / 2 / this.zoom;
  }
}
