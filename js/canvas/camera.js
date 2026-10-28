// Câmera 2D: (x, y) é o ponto do mundo no canto superior esquerdo da tela.
export class Camera {
  constructor({ minZoom = 0.1, maxZoom = 4 } = {}) {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
  }

  screenToWorld(sx, sy) {
    return { x: sx / this.zoom + this.x, y: sy / this.zoom + this.y };
  }

  worldToScreen(wx, wy) {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }

  panBy(dxScreen, dyScreen) {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
  }

  // Zoom mantendo fixo o ponto do mundo sob (sx, sy).
  zoomAt(sx, sy, nextZoom) {
    const clamped = Math.min(this.maxZoom, Math.max(this.minZoom, nextZoom));
    const before = this.screenToWorld(sx, sy);
    this.zoom = clamped;
    this.x = before.x - sx / clamped;
    this.y = before.y - sy / clamped;
  }

  centerOn(wx, wy, viewWidth, viewHeight) {
    this.x = wx - viewWidth / 2 / this.zoom;
    this.y = wy - viewHeight / 2 / this.zoom;
  }

  // Ajusta zoom e posição para enquadrar um retângulo do mundo.
  fit(rect, viewWidth, viewHeight, padding = 40) {
    const zx = (viewWidth - padding * 2) / Math.max(rect.width, 1);
    const zy = (viewHeight - padding * 2) / Math.max(rect.height, 1);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, Math.min(zx, zy)));
    this.centerOn(rect.x + rect.width / 2, rect.y + rect.height / 2, viewWidth, viewHeight);
  }

  visibleRect(viewWidth, viewHeight) {
    return { x: this.x, y: this.y, width: viewWidth / this.zoom, height: viewHeight / this.zoom };
  }

  toJSON() {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  load({ x = 0, y = 0, zoom = 1 } = {}) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
  }
}
