import { bus } from '../core/events.js';
import { findPin, isVariableDeclaration, opensScope, pruneWires, readGraph } from '../core/graph.js';
import { getDef } from '../lang/nodeRegistry.js';
import { graphSnapshot } from '../core/graphOps.js';
import { t } from '../i18n/i18n.js';
import { openInlineEditor } from '../ui/inlineEditor.js';
import { nearestAlong } from './wireGeometry.js';
import { contains } from './itemLayout.js';

// Interação com o botão esquerdo dentro da área de um script:
// - clicar/arrastar nós e sub-áreas (Alt desliga o snap; Ctrl ao soltar muda o nó de sub-área)
// - arrastar de um pino: conectar; soltar no vazio abre a busca filtrada (Alt+clique desconecta)
// - Ctrl/Alt + arrastar uma declaração de variável: cria "ler"/"definir"
// - laço no vazio: seleciona nós do mesmo nível (sub-área ou classe)
// - clicar no valor de um pino edita o valor padrão; "+" adiciona pino dinâmico
const DRAG_THRESHOLD = 4;

export class GraphTool {
  #state = null;

  constructor(canvas, editor, camera) {
    this.canvas = canvas;
    this.editor = editor;
    this.camera = camera;
    // Ctrl pressionado/solto sem mover o mouse também atualiza o arraste de nós.
    window.addEventListener('keydown', (e) => this.#onModifierKey(e));
    window.addEventListener('keyup', (e) => this.#onModifierKey(e));
  }

  #onModifierKey(event) {
    const state = this.#state;
    if (state?.type !== 'nodes' || !['Control', 'Meta'].includes(event.key)) return;
    event.preventDefault();
    this.#detach(state, event.ctrlKey || event.metaKey);
    this.editor.refresh();
  }

  // Com Ctrl, os nós arrastados não entram no tamanho da função (a área "congela"),
  // como acontece com arquivos e pastas; ao soltar com Ctrl eles saem da função.
  #detach(state, ctrl) {
    this.gc.detachedNodes = ctrl ? new Set(state.starts.keys()) : null;
    bus.emit('status', t(ctrl ? 'graph.dropLeaveScope' : 'graph.dropToScope'));
  }

  get gc() {
    return this.editor.graph;
  }

  get active() {
    return this.#state !== null;
  }

  down(hit, event, { screen, world }) {
    const gc = this.gc;
    const fileId = hit.fileId;
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const graph = readGraph(this.editor.project.get(fileId));

    switch (hit.kind) {
      case 'gtoggle':
        gc.toggleCollapse(fileId, { nodeId: hit.nodeId, scopeId: hit.scopeId });
        return;
      case 'gresize':
        this.#state = { type: 'scope-resize', fileId, scopeId: hit.scopeId, start: { w: hit.rect.w, h: hit.rect.h }, startWorld: world };
        return;
      case 'gscript':
        this.editor.navigateTo(hit.itemId);
        return;
      case 'gadd':
        gc.addDynamicPin(fileId, hit.nodeId, hit.side);
        return;
      case 'gdefault':
        this.#editDefault(fileId, hit);
        return;
      case 'gpin': {
        if (event.altKey) {
          gc.breakPin(fileId, hit.nodeId, hit.pinId, hit.side);
          return;
        }
        const pin = hit.pin;
        this.editor.wireDrag = { side: hit.side, anchor: { x: pin.x, y: pin.y }, point: world };
        this.#state = { type: 'wire', fileId, from: { nodeId: hit.nodeId, pinId: hit.pinId, side: hit.side } };
        return;
      }
      case 'gwire':
        // Ctrl + clique remove a conexão.
        if (event.ctrlKey || event.metaKey) gc.removeWire(fileId, hit.wireId);
        else gc.select(fileId, { wire: hit.wireId });
        return;
      case 'glabel': {
        gc.select(fileId, { wire: hit.wireId });
        const item = this.editor.project.get(fileId);
        this.#state = { type: 'pending-label', fileId, wireId: hit.wireId, startScreen: screen, before: structuredClone(item.graph) };
        return;
      }
      case 'gcresize': {
        const item = this.editor.project.get(fileId);
        this.#state = { type: 'comment-resize', fileId, nodeId: hit.nodeId, start: { w: hit.rect.w, h: hit.rect.h }, startWorld: world, before: structuredClone(item.graph) };
        return;
      }
      case 'gnode': {
        const node = graph.nodes.find((n) => n.id === hit.nodeId);
        // Ctrl + clique no reroute: remove o reroute e religa os fios.
        if ((event.ctrlKey || event.metaKey) && node?.type === 'core.reroute') {
          gc.removeReroute(fileId, node.id);
          return;
        }
        if ((event.ctrlKey || event.altKey) && isVariableDeclaration(node)) {
          this.#state = { type: 'spawn', fileId, declId: node.id, mode: event.altKey ? 'set' : 'get' };
          this.canvas.style.cursor = 'copy';
          return;
        }
        let deselectOnClick = false;
        if (additive && gc.fileId === fileId && gc.nodes.has(node.id)) deselectOnClick = true;
        else if (additive) gc.toggleNode(fileId, node.id);
        else if (!(gc.fileId === fileId && gc.nodes.has(node.id))) gc.select(fileId, { nodes: [node.id] });
        bus.emit('selection:changed');
        this.#state = { type: 'pending-nodes', fileId, startScreen: screen, startWorld: world, clickedId: node.id, deselectOnClick, additive };
        return;
      }
      case 'gscope':
        if (hit.part === 'header') {
          gc.select(fileId, { scopes: [hit.scopeId] });
          const scope = graph.scopes.find((s) => s.id === hit.scopeId);
          this.#state = { type: 'pending-scope', fileId, scopeId: hit.scopeId, start: { x: scope.x, y: scope.y }, startScreen: screen, startWorld: world };
          return;
        }
      // corpo da sub-área: laço
      // falls through
      default: {
        const level = hit.kind === 'gscope' ? hit.scopeId : null;
        if (!additive) gc.select(fileId, {});
        this.#state = { type: 'lasso', fileId, level, start: world, base: new Set(gc.fileId === fileId ? gc.nodes : []) };
      }
    }
  }

  move(event, { screen, world }) {
    const state = this.#state;
    const editor = this.editor;
    if (!state) return;

    if (state.type === 'wire') {
      editor.wireDrag.point = world;
      const hit = editor.hitAt(world);
      this.gc.hoverPin = hit?.kind === 'gpin' && hit.fileId === state.fileId ? { fileId: hit.fileId, nodeId: hit.nodeId, pinId: hit.pinId, side: hit.side } : null;
      editor.renderer.invalidate();
      return;
    }

    if (state.type === 'pending-label' || state.type === 'label') {
      if (state.type === 'pending-label' && Math.hypot(screen.x - state.startScreen.x, screen.y - state.startScreen.y) < DRAG_THRESHOLD) return;
      state.type = 'label';
      const placed = editor.layout?.entries.get(state.fileId)?.graph?.wires.find((w) => w.wire.id === state.wireId);
      const wire = editor.project.get(state.fileId).graph.wires.find((w) => w.id === state.wireId);
      if (placed && wire?.label) {
        wire.label.at = Math.round(nearestAlong(placed.points, world) * 1000) / 1000;
        editor.refresh();
      }
      return;
    }

    if (state.type === 'comment-resize') {
      const node = editor.project.get(state.fileId).graph.nodes.find((n) => n.id === state.nodeId);
      if (node) {
        node.w = Math.max(120, editor.snap(state.start.w + world.x - state.startWorld.x, event.altKey));
        node.h = Math.max(60, editor.snap(state.start.h + world.y - state.startWorld.y, event.altKey));
        editor.refresh();
      }
      return;
    }

    if (state.type === 'scope-resize') {
      this.gc.scopeSizes.set(state.scopeId, { w: state.start.w + world.x - state.startWorld.x, h: state.start.h + world.y - state.startWorld.y });
      editor.refresh();
      return;
    }

    if (state.type === 'pending-nodes' || state.type === 'pending-scope') {
      if (Math.hypot(screen.x - state.startScreen.x, screen.y - state.startScreen.y) < DRAG_THRESHOLD) return;
      const item = editor.project.get(state.fileId);
      state.before = structuredClone(item.graph);
      state.dragLayout = editor.layout;
      if (state.type === 'pending-nodes') {
        state.type = 'nodes';
        state.starts = new Map(item.graph.nodes.filter((n) => this.gc.nodes.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y, scopeId: n.scopeId ?? null }]));
        // Comentário que agrupa leva junto os nós que estão inteiros dentro dele.
        const placed = state.dragLayout?.entries.get(state.fileId)?.graph?.nodes;
        for (const c of placed?.values() ?? []) {
          if (c.template !== 'comment' || !c.group || !state.starts.has(c.node.id)) continue;
          for (const n of placed.values()) {
            if (n === c || state.starts.has(n.node.id) || (n.node.scopeId ?? null) !== (c.node.scopeId ?? null)) continue;
            const r = n.rect;
            if (contains(c.rect, { x: r.x, y: r.y }) && contains(c.rect, { x: r.x + r.w, y: r.y + r.h })) {
              state.starts.set(n.node.id, { x: n.node.x, y: n.node.y, scopeId: n.node.scopeId ?? null });
            }
          }
        }
      } else {
        state.type = 'scope';
      }
      this.canvas.style.cursor = 'grabbing';
    }

    if (state.type === 'nodes' || state.type === 'scope') {
      const dx = world.x - state.startWorld.x;
      const dy = world.y - state.startWorld.y;
      const graph = editor.project.get(state.fileId).graph;
      if (state.type === 'nodes') {
        for (const node of graph.nodes) {
          const start = state.starts.get(node.id);
          if (!start) continue;
          node.x = editor.snap(start.x + dx, event.altKey);
          node.y = editor.snap(start.y + dy, event.altKey);
        }
        this.#detach(state, event.ctrlKey || event.metaKey);
      } else {
        const scope = graph.scopes.find((s) => s.id === state.scopeId);
        scope.x = editor.snap(state.start.x + dx, event.altKey);
        scope.y = editor.snap(state.start.y + dy, event.altKey);
      }
      editor.refresh();
      return;
    }

    if (state.type === 'lasso') {
      const rect = {
        x: Math.min(state.start.x, world.x),
        y: Math.min(state.start.y, world.y),
        w: Math.abs(world.x - state.start.x),
        h: Math.abs(world.y - state.start.y),
      };
      editor.lasso = rect;
      this.gc.nodes = new Set([...state.base, ...this.gc.nodesInRect(state.fileId, rect, state.level)]);
      this.gc.fileId = state.fileId;
      editor.renderer.invalidate();
    }
  }

  up(event, { world, client }) {
    const state = this.#state;
    this.#state = null;
    const editor = this.editor;
    const gc = this.gc;
    this.canvas.style.cursor = '';
    if (!state) return;

    if (state.type === 'wire') {
      editor.wireDrag = null;
      gc.hoverPin = null;
      const hit = editor.hitAt(world);
      if (hit?.kind === 'gpin' && hit.fileId === state.fileId) {
        gc.connectPins(state.fileId, state.from, { nodeId: hit.nodeId, pinId: hit.pinId, side: hit.side });
      } else if (hit && hit.fileId === state.fileId && (hit.kind === 'garea' || hit.kind === 'gscope' || hit.kind === 'gwire')) {
        gc.openSearch(state.fileId, world, client, state.from);
      }
      editor.renderer.invalidate();
      return;
    }

    if (state.type === 'pending-nodes') {
      if (state.deselectOnClick) gc.toggleNode(state.fileId, state.clickedId);
      else if (!state.additive && gc.nodes.size > 1) gc.select(state.fileId, { nodes: [state.clickedId] });
      return;
    }
    if (state.type === 'pending-scope' || state.type === 'pending-label') return;

    if (state.type === 'label' || state.type === 'comment-resize') {
      const after = structuredClone(editor.project.get(state.fileId).graph);
      const label = state.type === 'label' ? t('graph.history.label') : t('graph.history.resizeComment');
      editor.history.execute(graphSnapshot(editor.project, state.fileId, state.before, after, label));
      return;
    }

    if (state.type === 'nodes' || state.type === 'scope') {
      bus.emit('status', '');
      gc.detachedNodes = null;
      const item = editor.project.get(state.fileId);
      if (state.type === 'nodes') this.#moveToScope(state, item.graph, world, event.ctrlKey || event.metaKey);
      const after = structuredClone(item.graph);
      const label = state.type === 'nodes' ? t('graph.history.move') : t('graph.history.moveScope');
      editor.history.execute(graphSnapshot(editor.project, state.fileId, state.before, after, label));
      return;
    }

    if (state.type === 'lasso') {
      editor.lasso = null;
      editor.renderer.invalidate();
      bus.emit('selection:changed');
      return;
    }

    if (state.type === 'spawn') {
      gc.spawnVariableAccess(state.fileId, state.declId, world, state.mode);
    }
  }

  cancel() {
    const state = this.#state;
    this.#state = null;
    this.editor.wireDrag = null;
    this.editor.lasso = null;
    this.canvas.style.cursor = '';
    this.gc.detachedNodes = null;
    if ((state?.type === 'nodes' || state?.type === 'scope') && state.before) {
      this.editor.project.get(state.fileId).graph = state.before;
      bus.emit('project:changed', this.editor.project);
    }
    this.editor.renderer.invalidate();
  }

  // Ctrl ao soltar: os nós passam para a sub-área (ou classe) sob o ponteiro.
  // Fios que passariam a ligar sub-áreas diferentes são removidos.
  // Soltar nós dentro de uma função os move para ela (automático, como entrar numa pasta);
  // tirar da função para o escopo do script pede Ctrl ao soltar (sem Ctrl a área só cresce).
  // Variável muda junto: membro dentro da função vira local, e local fora vira membro.
  #moveToScope(state, graph, world, leave) {
    const gc = this.gc;
    const target = gc.scopeAt(state.fileId, world, state.dragLayout);
    if (target === null && !leave) return;
    const moved = graph.nodes.filter((n) => state.starts.has(n.id) && !opensScope(getDef(n.type)) && (n.scopeId ?? null) !== target);
    if (!moved.length) return;
    const newOrigin = gc.originFor(state.fileId, target, state.dragLayout);
    for (const node of moved) {
      const oldOrigin = gc.originFor(state.fileId, node.scopeId ?? null, state.dragLayout);
      node.x = this.editor.snap(oldOrigin.x + node.x - newOrigin.x);
      node.y = this.editor.snap(oldOrigin.y + node.y - newOrigin.y);
      node.scopeId = target;
      if (node.type === 'var.member' && target) {
        node.type = 'var.local';
        node.fields = { name: node.fields?.name, type: node.fields?.type ?? '' };
      } else if (node.type === 'var.local' && !target) {
        node.type = 'var.member';
        node.fields = { ...node.fields, export: false, onready: false };
      }
    }
    const scopeOf = new Map(graph.nodes.map((n) => [n.id, n.scopeId ?? null]));
    const before = graph.wires.length;
    graph.wires = graph.wires.filter((w) => scopeOf.get(w.from.node) === scopeOf.get(w.to.node));
    pruneWires(graph); // variável convertida (membro ↔ local) perde os pinos de fluxo
    if (graph.wires.length < before) bus.emit('status', t('graph.wiresRemoved', { count: before - graph.wires.length }));
  }

  async #editDefault(fileId, hit) {
    const editor = this.editor;
    const graph = readGraph(editor.project.get(fileId));
    const node = graph.nodes.find((n) => n.id === hit.nodeId);
    const pin = node && findPin(node, hit.pinId, 'in', graph);
    if (!pin) return;
    const current = node.defaults?.[pin.id] ?? pin.default;

    if (pin.type === 'bool') {
      editor.graph.updateNode(fileId, node.id, (n) => {
        n.defaults = { ...n.defaults, [pin.id]: !current };
      }, t('graph.history.default'));
      return;
    }
    const topLeft = this.camera.worldToScreen(hit.box.x, hit.box.y);
    const text = await openInlineEditor({
      container: this.canvas.parentElement,
      rect: { x: topLeft.x, y: topLeft.y - 2, w: hit.box.w * this.camera.zoom + 40, h: hit.box.h * this.camera.zoom + 4 },
      value: current === undefined || current === null ? '' : typeof current === 'string' ? current : JSON.stringify(current),
    });
    if (text === null) return;
    editor.graph.updateNode(fileId, node.id, (n) => {
      n.defaults = { ...n.defaults };
      const value = parseDefault(text, pin.type);
      if (value === undefined) delete n.defaults[pin.id];
      else n.defaults[pin.id] = value;
    }, t('graph.history.default'));
  }

  // Passa o mouse: destaca pinos e ajusta o cursor. Retorna true se estiver sobre o grafo.
  hover(hit) {
    const gc = this.gc;
    const pin = hit?.kind === 'gpin' ? { fileId: hit.fileId, nodeId: hit.nodeId, pinId: hit.pinId, side: hit.side } : null;
    const changed = pin?.nodeId !== gc.hoverPin?.nodeId || pin?.pinId !== gc.hoverPin?.pinId || pin?.side !== gc.hoverPin?.side;
    gc.hoverPin = pin;
    if (changed) this.editor.renderer.invalidate();
    if (!hit?.kind?.startsWith('g')) return false;
    const cursors = { gpin: 'crosshair', gadd: 'pointer', gtoggle: 'pointer', gdefault: 'text', gwire: 'pointer', gnode: 'move', gresize: 'nwse-resize', gcresize: 'nwse-resize', glabel: 'grab' };
    this.canvas.style.cursor = cursors[hit.kind] ?? (hit.kind === 'gscope' && hit.part === 'header' ? 'move' : '');
    return true;
  }

  doubleClick(hit, world) {
    if (hit.kind === 'gwire') this.gc.insertReroute(hit.fileId, hit.wireId, world);
  }
}

function parseDefault(text, type) {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (type === 'int') return Number.isNaN(parseInt(trimmed, 10)) ? trimmed : parseInt(trimmed, 10);
  if (type === 'float') return Number.isNaN(parseFloat(trimmed)) ? trimmed : parseFloat(trimmed);
  return trimmed;
}
