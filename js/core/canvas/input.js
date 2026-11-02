import { buttonCode, isKey, keyAction, modifierHeld } from '../keys.js';
import { ROOT } from '../scene.js';
import { canConnect } from '../wires.js';
import { snap } from './grid.js';
import { pickInBox } from './selection.js';

const DRAG_THRESHOLD = 3; // pixels da tela antes de um clique virar arraste
const ZOOM_SPEED = 0.0015;

// Mouse e teclado → ações no canvas. Quais teclas e botões fazem o quê vem dos atalhos
// (js/config/shortcuts.js); a roda do mouse é sempre zoom, no ponteiro.
export class CanvasInput {
  // onNodeMenu(screen, world, origin): pedido para abrir o menu de criar nó naquele ponto;
  // origin ({ node, pin }) quando veio de um fio solto no vazio. onToggleInspector(): atalho do inspetor.
  // onPinMenu(screen, { node, pin }): clique direito sem arrastar num pino (abrir/fechar componentes).
  constructor(canvas, {
    camera, scene, selection, renderer, theme, shortcuts, onNodeMenu = () => {}, onToggleInspector = () => {}, onPinMenu = () => {},
  }) {
    this.canvas = canvas;
    this.camera = camera;
    this.scene = scene;
    this.selection = selection;
    this.renderer = renderer;
    this.theme = theme;
    this.shortcuts = shortcuts;
    this.onNodeMenu = onNodeMenu;
    this.onToggleInspector = onToggleInspector;
    this.onPinMenu = onPinMenu;
    this.mode = null; // 'pan' | 'drag' | 'box' | 'click' | 'wire' | 'rewire' | 'resize'
    this.space = false;
    this.state = null;
  }

  attach() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    c.addEventListener('pointermove', (e) => this.onPointerMove(e));
    c.addEventListener('pointerup', (e) => this.onPointerUp(e));
    c.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    c.addEventListener('pointerleave', () => { if (!this.mode) this.setHover(null); });
    c.addEventListener('dblclick', (e) => this.onDoubleClick(e));
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

  pinAt(world) {
    return this.scene.pinAt(world, this.theme.pin.hitRadius / this.camera.zoom);
  }

  wireAt(world) {
    return this.scene.wireAt(world, this.theme.wire.hitWidth / this.camera.zoom);
  }

  onPointerDown(e) {
    if (this.mode) return;
    const mouse = this.shortcuts.mouse;
    const screen = this.local(e);
    const world = this.camera.toWorld(screen.x, screen.y);
    const hit = this.scene.hitTest(world);
    // Numa área: ⇕ abre/fecha, o canto redimensiona (botão esquerdo), o corpo vazio conta como
    // vazio (dentro dela); o canto também, para o menu e a seleção.
    const part = hit?.area ? this.scene.areaPart(hit, world) : null;
    const empty = !hit || part === 'body' || part === 'handle';
    // Clique sem arrastar no vazio com o botão do menu abre o menu de criar nó.
    const menu = e.button === buttonCode(mouse.nodeMenu.button) && empty;
    const pinMenu = e.button === buttonCode(mouse.pinMenu.button) ? this.pinAt(world) : null;
    this.setHover(null);
    if (e.button === buttonCode(mouse.panButton.button) || (e.button === 0 && this.space)) {
      this.mode = 'pan';
      this.state = { last: screen, startScreen: screen, startWorld: world, moved: false, menu, pinMenu };
    } else if (menu) {
      this.mode = 'click';
      this.state = { startScreen: screen, startWorld: world, moved: false, menu };
    } else if (e.button === buttonCode(mouse.connectWire.button) && this.pinAt(world)) {
      this.startOnPin(this.pinAt(world), world, e);
    } else if (e.button === 0) {
      const multi = modifierHeld(mouse.multiSelect.modifier, e);
      const wire = empty ? this.wireAt(world) : null;
      if (hit) this.scene.bringToFront(hit);
      if (part === 'toggle') {
        this.toggleArea(hit);
      } else if (part === 'handle' && e.button === buttonCode(mouse.resizeArea.button)) {
        this.mode = 'resize';
        this.state = { area: hit, startWorld: world, w: hit.w, h: hit.h };
      } else if (hit && !empty && multi) {
        this.selection.toggle(hit.id);
      } else if (hit && !empty) {
        const wasSelected = this.selection.has(hit.id);
        if (!wasSelected) this.selection.set([hit.id]);
        const moving = this.movingSet();
        const exclude = new Set(moving);
        // Os de cima de cada grupo arrastado (o que têm dentro vai junto) e a área de onde saem.
        const tops = moving.filter((el) => !exclude.has(this.scene.byId(el.scope)));
        const top = tops.find((el) => el === hit || this.scene.ancestors(hit).includes(el)) ?? hit;
        this.mode = 'drag';
        this.state = {
          hit, wasSelected, moving, tops, exclude, origin: top.scope, startScreen: screen, startWorld: world, moved: false,
          origins: new Map(moving.map((el) => [el.id, { x: el.x, y: el.y }])),
        };
      } else if (wire) {
        if (multi) this.selection.toggle(wire.id);
        else this.selection.set([wire.id]);
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

  // Onde o arraste vai soltar: a área aberta sob o ponteiro (sem contar o que está sendo arrastado).
  // Sem Ctrl, a área de origem cresce e o elemento fica nela (ou entra numa área de dentro dela).
  // Com Ctrl (leaveArea), ele sai: a origem encolhe já durante o arraste e, se o ponteiro ainda
  // estiver nela, o destino é a área de fora. Devolve { scope, ok, mode, reason } ou null (fica onde está).
  // Sobre uma área fechada (que não é a origem), o destino é ela: o elemento entra nela.
  updateDrop(s, world, leave) {
    this.scene.fitExclude = leave ? new Set(s.tops) : new Set();
    const closed = this.scene.closedAreaAt(world, s.exclude);
    let scope = closed && closed.id !== s.origin ? closed.id : this.scene.scopeAt(world, s.exclude);
    if (!closed && leave && scope === s.origin && s.origin !== ROOT) scope = this.scene.byId(s.origin).scope;
    if (scope === s.origin) {
      this.renderer.drop = null;
      return null;
    }
    const check = this.scene.canDrop(s.tops, scope);
    this.renderer.drop = { scope, point: world, ...check };
    return this.renderer.drop;
  }

  // Vazio no ponto: nada, ou o corpo vazio (ou o canto) de uma área aberta.
  isEmptyAt(world) {
    const hit = this.scene.hitTest(world);
    return !hit || (hit.area && ['body', 'handle'].includes(this.scene.areaPart(hit, world)));
  }

  // Pasta/arquivo solto num script: nasce um nó de caminho no ponto, dentro da área de destino.
  addPath(item, scope, world) {
    const def = this.scene.language.node?.(this.scene.language.pathNode);
    if (!def) return;
    const node = this.scene.addNode(def, { x: world.x, y: world.y, scope, values: { path: this.scene.pathOf(item) } });
    this.selection.set([node.id]);
  }

  // O que anda junto ao arrastar: os selecionados visíveis e tudo o que está dentro das áreas selecionadas.
  movingSet() {
    const picked = this.scene.elements.filter((el) => this.selection.has(el.id) && this.scene.isVisible(el));
    const moving = new Set(picked);
    for (const el of picked) if (el.area) for (const d of this.scene.descendants(el)) moving.add(d);
    return [...moving];
  }

  // Abre/fecha a área; ao fechar, o que ficou escondido sai da seleção.
  toggleArea(area) {
    this.scene.toggleArea(area);
    const visible = (id) => {
      const node = this.scene.byId(id);
      if (node) return this.scene.isVisible(node);
      const wire = this.scene.wireById(id);
      return !!wire && this.scene.isVisible(this.scene.byId(wire.from.node)) && this.scene.isVisible(this.scene.byId(wire.to.node));
    };
    this.selection.set([...this.selection.ids].filter(visible));
    this.render();
  }

  // Pino: Alt+clique solta os fios; Ctrl+arrastar leva os fios dele; arrastar puxa um fio novo.
  startOnPin(at, world, e) {
    const mouse = this.shortcuts.mouse;
    const wires = this.scene.wiresAt(at.node, at.pin);
    if (modifierHeld(mouse.breakWires.modifier, e)) {
      this.scene.disconnect(wires.map((w) => w.id));
      return;
    }
    let origins = [at];
    if (modifierHeld(mouse.moveWires.modifier, e) && wires.length) {
      // As pontas do outro lado viram as origens; os fios saem até soltar.
      origins = wires.map((w) => (at.pin.direction === 'out' ? this.scene.ends(w).to : this.scene.ends(w).from));
      this.scene.disconnect(wires.map((w) => w.id));
      this.mode = 'rewire';
      this.state = { removed: wires, startScreen: this.local(e) };
    } else {
      this.mode = 'wire';
      this.state = { startScreen: this.local(e) };
    }
    const language = this.scene.language;
    this.renderer.drag = {
      origins,
      point: world,
      target: null,
      check: null,
      compatible: (node, pin) => origins.every((o) => canConnect(o, { node, pin }, language).ok),
    };
  }

  onPointerMove(e) {
    const screen = this.local(e);
    const world = this.camera.toWorld(screen.x, screen.y);
    if (!this.mode) {
      this.setHover(this.pinAt(world));
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
      this.updateDrop(s, world, modifierHeld(this.shortcuts.mouse.leaveArea.modifier, e));
    } else if (this.mode === 'resize') {
      // O puxador só define um mínimo; o conteúdo continua mandando (fitAreas).
      s.area.manual = { w: Math.max(0, s.w + world.x - s.startWorld.x), h: Math.max(0, s.h + world.y - s.startWorld.y) };
    } else if (this.mode === 'box') {
      const box = this.renderer.box;
      box.end = world;
      this.selection.set([...s.base, ...pickInBox(this.scene.elements, box.start, box.end, s.scope)]);
    } else if (this.mode === 'wire' || this.mode === 'rewire') {
      const drag = this.renderer.drag;
      drag.point = world;
      drag.target = this.pinAt(world);
      // Motivo de não ligar: o do primeiro fio que não liga.
      drag.check = drag.target
        ? drag.origins.map((o) => canConnect(o, drag.target, this.scene.language)).find((c) => !c.ok) ?? { ok: true }
        : null;
      this.renderer.hover = drag.target;
    }
    this.render();
  }

  onPointerUp(e) {
    if (!this.mode) return;
    const s = this.state;
    const screen = this.local(e);
    const world = this.camera.toWorld(screen.x, screen.y);
    let menuFor = null;
    if (this.mode === 'drag') {
      const drop = s.moved ? this.updateDrop(s, world, modifierHeld(this.shortcuts.mouse.leaveArea.modifier, e)) : null;
      this.scene.fitExclude = new Set();
      this.renderer.drop = null;
      if (drop && (!drop.ok || drop.mode === 'path')) {
        // Proibido, ou pasta/arquivo que vira caminho: o que foi arrastado volta ao lugar.
        for (const el of s.moving) Object.assign(el, s.origins.get(el.id));
        if (drop.ok) this.addPath(s.tops[0], drop.scope, world);
      } else if (s.moved) {
        if (drop) this.scene.moveInto(s.tops, drop.scope);
        if (!modifierHeld(this.shortcuts.mouse.noSnap.modifier, e)) {
          // Encaixa o elemento clicado e leva os outros junto, mantendo as distâncias.
          const step = this.theme.grid.step;
          const dx = snap(s.hit.x, step) - s.hit.x;
          const dy = snap(s.hit.y, step) - s.hit.y;
          for (const el of s.moving) {
            el.x += dx;
            el.y += dy;
          }
        }
      } else {
        // Clique sem arrastar: Ctrl cria um get e Alt um set do nó (ex.: variável), ao lado dele.
        const mouse = this.shortcuts.mouse;
        const kind = modifierHeld(mouse.refGet.modifier, e) ? 'get' : modifierHeld(mouse.refSet.modifier, e) ? 'set' : null;
        const ref = kind && s.hit.references ? this.scene.addReference(s.hit, kind) : null;
        if (ref) this.selection.set([ref.id]);
        else if (s.wasSelected) this.selection.set([s.hit.id]);
      }
    } else if (this.mode === 'box') {
      this.renderer.box = null;
    } else if (this.mode === 'wire' || this.mode === 'rewire') {
      menuFor = this.finishWire(world);
      this.renderer.drag = null;
      this.renderer.hover = null;
    }
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const openMenu = s.menu && !s.moved;
    const openPinMenu = s.pinMenu && !s.moved ? s.pinMenu : null;
    this.mode = null;
    this.state = null;
    this.updateCursor();
    this.render();
    if (openMenu) this.onNodeMenu(s.startScreen, s.startWorld, null);
    if (openPinMenu) this.onPinMenu(s.startScreen, openPinMenu);
    if (menuFor) this.onNodeMenu(screen, world, menuFor);
  }

  // Solta o fio: num pino compatível liga; no vazio, fio novo abre o menu (devolve a origem)
  // e fios levados com Ctrl são apagados; num pino incompatível nada muda.
  finishWire(world) {
    const { origins, target } = this.renderer.drag;
    const ok = target && origins.every((o) => canConnect(o, target, this.scene.language).ok);
    if (ok) {
      for (const o of origins) this.scene.connect(o, target);
      return null;
    }
    if (this.mode === 'rewire' && target) {
      this.scene.wires.push(...this.state.removed);
      return null;
    }
    if (this.mode === 'wire' && !target && this.state.moved && this.isEmptyAt(world)) return origins[0];
    return null;
  }

  // Duplo clique: no cabeçalho de uma área abre/fecha (no ⇕ o clique simples já fez isso);
  // num fio (fora de nós) cria um reroute.
  onDoubleClick(e) {
    const mouse = this.shortcuts.mouse;
    const screen = this.local(e);
    const world = this.camera.toWorld(screen.x, screen.y);
    const hit = this.scene.hitTest(world);
    const part = hit?.area ? this.scene.areaPart(hit, world) : null;
    if (part === 'header' && e.button === buttonCode(mouse.toggleArea.button)) {
      this.toggleArea(hit);
      return;
    }
    if (e.button !== buttonCode(mouse.addReroute.button)) return;
    if ((hit && part !== 'body') || this.pinAt(world)) return;
    const wire = this.wireAt(world);
    if (!wire) return;
    const reroute = this.scene.addReroute(wire, world);
    this.selection.set([reroute.id]);
    this.render();
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
    toggleInspector() {
      this.onToggleInspector();
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
    else if (this.mode === 'resize') c.cursor = 'nwse-resize';
    else if (this.mode === 'wire' || this.mode === 'rewire') c.cursor = 'crosshair';
    else if (this.space) c.cursor = 'grab';
    else c.cursor = 'default';
  }
}
