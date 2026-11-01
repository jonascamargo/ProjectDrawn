import { bus } from '../core/events.js';

// Navegação do canvas:
// - botão do meio, botão direito arrastando ou Espaço + botão esquerdo: pan
// - clique direito sem arrastar: emite 'canvas:contextmenu' (menus virão depois)
const DRAG_THRESHOLD = 4;

export class ViewportController {
  #pan = null;
  #spaceDown = false;

  constructor(canvas, camera, renderer) {
    this.canvas = canvas;
    this.camera = camera;
    this.renderer = renderer;

    canvas.tabIndex = 0;
    canvas.addEventListener('pointerdown', (e) => this.#onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.#onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.#onPointerUp(e));
    canvas.addEventListener('pointercancel', () => this.#endPan());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.#onKey(e, true));
    window.addEventListener('keyup', (e) => this.#onKey(e, false));
    window.addEventListener('blur', () => {
      this.#spaceDown = false;
      this.#endPan();
    });
  }

  get isSpaceDown() {
    return this.#spaceDown;
  }

  #local(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  #changed() {
    this.renderer.invalidate();
    bus.emit('camera:changed', this.camera);
  }

  #onPointerDown(event) {
    this.canvas.focus({ preventScroll: true });
    const isPanButton = event.button === 1 || event.button === 2 || (event.button === 0 && this.#spaceDown);
    if (!isPanButton) return;
    event.preventDefault();
    const start = this.#local(event);
    this.#pan = { button: event.button, start, last: start, moved: false, pointerId: event.pointerId };
    this.canvas.setPointerCapture(event.pointerId);
  }

  #onPointerMove(event) {
    const point = this.#local(event);
    const world = this.camera.screenToWorld(point.x, point.y);
    bus.emit('pointer:move', { screen: point, world });

    const pan = this.#pan;
    if (!pan) return;
    if (!pan.moved && Math.hypot(point.x - pan.start.x, point.y - pan.start.y) < DRAG_THRESHOLD) return;
    if (!pan.moved) {
      pan.moved = true;
      this.canvas.classList.add('is-panning');
    }
    this.camera.panBy(point.x - pan.last.x, point.y - pan.last.y);
    pan.last = point;
    this.#changed();
  }

  #onPointerUp(event) {
    const pan = this.#pan;
    if (pan && pan.button === 2 && !pan.moved) {
      const point = this.#local(event);
      bus.emit('canvas:contextmenu', {
        screen: point,
        client: { x: event.clientX, y: event.clientY },
        shiftKey: event.shiftKey,
        world: this.camera.screenToWorld(point.x, point.y),
      });
    }
    this.#endPan();
  }

  #endPan() {
    if (!this.#pan) return;
    if (this.canvas.hasPointerCapture?.(this.#pan.pointerId)) this.canvas.releasePointerCapture(this.#pan.pointerId);
    this.#pan = null;
    this.canvas.classList.remove('is-panning');
  }

  #onKey(event, down) {
    if (event.code !== 'Space' || isTyping(event.target)) return;
    if (down) event.preventDefault();
    this.#spaceDown = down;
    this.canvas.style.cursor = down ? 'grab' : '';
  }
}

export function isTyping(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}
