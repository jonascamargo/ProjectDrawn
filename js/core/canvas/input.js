import { buttonCode, isKey, keyAction, modifierHeld } from '../keys.js';
import { snap } from './grid.js';
import { pickInBox } from './selection.js';

const DRAG_THRESHOLD = 3; // pixels da tela antes de um clique virar arraste
const ZOOM_SPEED = 0.0015;

// Mouse e teclado → ações no canvas. Quais teclas e botões fazem o quê vem dos atalhos
// (js/config/shortcuts.js); a roda do mouse é sempre zoom, no ponteiro.
export class CanvasInput {
  // onNodeMenu(screen, world): pedido para abrir o menu de criar nó naquele ponto.
  constructor(canvas, { camera, scene, selection, renderer, theme, shortcuts, onNodeMenu = () => {} }) {
    this.canvas = canvas;
    this.camera = camera;
    this.scene = scene;
    this.selection = selection;
    this.renderer = renderer;
    this.theme = theme;
    this.shortcuts = shortcuts;
    this.onNodeMenu = onNodeMenu;
    this.mode = null; // 'pan' | 'drag' | 'box' | 'click'
    this.space = false;
    this.state = null;
  }

  attach() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    c.addEventListener('pointermove', (e) => this.onPointerMove(e));
    c.addEventListener('pointerup', (e) => this.onPointerUp(e));
    c.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    c.addEventListener('pointerleave', () => this.setHover(null));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.setSpace(false));
  }

  render() {
    this.renderer.requestRender();
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onPointerDown(e) {
    if (this.mode) return;
    const mouse = this.shortcuts.mouse;
    const screen = this.local(e);
    const world = this.camera.toWorld(screen.x, screen.y);
    const hit = this.scene.hitTest(world);
    // Clique sem arrastar no vazio com o botão do menu abre o menu de criar nó.
    const menu = e.button === buttonCode(mouse.nodeMenu.button) && !hit;
    this.setHover(null);
    if (e.button === buttonCode(mouse.panButton.button) || (e.button === 0 && this.space)) {
      this.mode = 'pan';
      this.state = { last: screen, startScreen: screen, startWorld: world, moved: false, menu };
    } else if (menu) {
      this.mode = 'click';
      this.state = { startScreen: screen, startWorld: world, moved: false, menu };
    } else if (e.button === 0) {
      const multi = modifierHeld(mouse.multiSelect.modifier, e);
      if (hit && multi) {
        this.selection.toggle(hit.id);
      } else if (hit) {
        const wasSelected = this.selection.has(hit.id);
        if (!wasSelected) this.selection.set([hit.id]);
        const moving = this.scene.elements.filter((el) => this.selection.has(el.id));
        this.mode = 'drag';
        this.state = {
          hit, wasSelected, moving, startScreen: screen, startWorld: world, moved: false,
          origins: new Map(moving.map((el) => [el.id, { x: el.x, y: el.y }])),
        };
      } else {
        // O retângulo só pega elementos do escopo onde começou.
        const base = multi ? [...this.selection.ids] : [];
        if (!multi) this.selection.clear();
        this.mode = 'box';
        this.state = { base, scope: this.scene.scopeAt(world) };
        this.renderer.box = { start: world, end: world };
      }
    }
    if (this.mode) this.canvas.setPointerCapture(e.pointerId);
    this.updateCursor();
    this.render();
  }

  onPointerMove(e) {
    const screen = this.local(e);
    const world = this.camera.toWorld(screen.x, screen.y);
    if (!this.mode) {
      this.setHover(this.scene.pinAt(world, this.theme.pin.hitRadius / this.camera.zoom));
      return;
    }
    const s = this.state;
    if (s.startScreen && !s.moved) {
      s.moved = Math.hypot(screen.x - s.startScreen.x, screen.y - s.startScreen.y) >= DRAG_THRESHOLD;
    }
    if (this.mode === 'pan') {
      this.camera.panBy(screen.x - s.last.x, screen.y - s.last.y);
      s.last = screen;
    } else if (this.mode === 'drag') {
      if (!s.moved) return;
      const dx = world.x - s.startWorld.x;
      const dy = world.y - s.startWorld.y;
      for (const el of s.moving) {
        const o = s.origins.get(el.id);
        el.x = o.x + dx;
        el.y = o.y + dy;
      }
    } else if (this.mode === 'box') {
      const box = this.renderer.box;
      box.end = world;
      this.selection.set([...s.base, ...pickInBox(this.scene.elements, box.start, box.end, s.scope)]);
    }
    this.render();
  }

  onPointerUp(e) {
    if (!this.mode) return;
    const s = this.state;
    if (this.mode === 'drag') {
      if (s.moved && !modifierHeld(this.shortcuts.mouse.noSnap.modifier, e)) {
        // Encaixa o elemento clicado e leva os outros junto, mantendo as distâncias.
        const step = this.theme.grid.step;
        const dx = snap(s.hit.x, step) - s.hit.x;
        const dy = snap(s.hit.y, step) - s.hit.y;
        for (const el of s.moving) {
          el.x += dx;
          el.y += dy;
        }
      } else if (!s.moved && s.wasSelected) {
        this.selection.set([s.hit.id]);
      }
    } else if (this.mode === 'box') {
      this.renderer.box = null;
    }
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const openMenu = s.menu && !s.moved;
    this.mode = null;
    this.state = null;
    this.updateCursor();
    this.render();
    if (openMenu) this.onNodeMenu(s.startScreen, s.startWorld);
  }

  onWheel(e) {
    e.preventDefault();
    const screen = this.local(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.camera.zoomAt(screen.x, screen.y, this.camera.zoom * Math.exp(-delta * ZOOM_SPEED));
    this.render();
  }

  onKeyDown(e) {
    if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (isKey(this.shortcuts.mouse.panHoldKey.key, e)) {
      e.preventDefault();
      this.setSpace(true);
      return;
    }
    if (e.key === 'Alt') e.preventDefault(); // evita o foco no menu do navegador
    if (this.mode) return;
    const action = keyAction(this.shortcuts.keys, e);
    if (!action) return;
    e.preventDefault();
    this.actions[action]?.call(this);
    this.render();
  }

  onKeyUp(e) {
    if (isKey(this.shortcuts.mouse.panHoldKey.key, e)) this.setSpace(false);
  }

  // Ações de teclado, pelo nome usado em shortcuts.keys.
  actions = {
    selectAll() {
      this.selection.set(this.scene.inScope(this.scene.scopeAt()).map((el) => el.id));
    },
    clearSelection() {
      this.selection.clear();
    },
    deleteSelection() {
      this.scene.remove(this.selection.ids);
      this.selection.clear();
      this.setHover(null);
    },
    frameAll() {
      const bounds = this.scene.bounds();
      if (bounds) this.camera.frame(bounds, this.renderer.width, this.renderer.height);
    },
    zoomReset() {
      this.camera.zoomAt(this.renderer.width / 2, this.renderer.height / 2, 1);
    },
  };

  setHover(hover) {
    const current = this.renderer.hover;
    if (current?.pin === hover?.pin) return;
    this.renderer.hover = hover;
    this.render();
  }

  setSpace(down) {
    this.space = down;
    this.updateCursor();
  }

  updateCursor() {
    const c = this.canvas.style;
    if (this.mode === 'pan') c.cursor = 'grabbing';
    else if (this.mode === 'drag') c.cursor = 'move';
    else if (this.space) c.cursor = 'grab';
    else c.cursor = 'default';
  }
}
