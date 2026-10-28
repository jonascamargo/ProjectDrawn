import { bus } from '../core/events.js';
import { t } from '../i18n/i18n.js';
import { GraphTool } from './graphTool.js';
import { toast } from '../ui/toast.js';
import { SYMBOL_DRAG_TYPE } from '../ui/projectOutline.js';

export const NODE_DRAG_TYPE = 'application/x-projectdrawn-node';

// Interação com o botão esquerdo no canvas:
// - clique em item: seleciona (Ctrl/Shift alterna); arrastar move (Alt desliga o snap)
// - arrastar no vazio: laço restrito ao nível onde começou
// - arrastar de um pino: cria relação (Alt+clique no pino remove as relações dele)
// - soltar com Ctrl fora da área do pai: move o item para o nível onde foi solto
// - duplo clique: expande/recolhe
const DRAG_THRESHOLD = 4;

export class ItemTool {
  #state = null;

  constructor(canvas, editor, camera, viewport) {
    this.canvas = canvas;
    this.editor = editor;
    this.camera = camera;
    this.viewport = viewport;

    canvas.addEventListener('pointerdown', (e) => this.#onDown(e));
    canvas.addEventListener('pointermove', (e) => this.#onMove(e));
    canvas.addEventListener('pointerup', (e) => this.#onUp(e));
    canvas.addEventListener('pointercancel', () => this.#cancel());
    canvas.addEventListener('dblclick', (e) => this.#onDoubleClick(e));
    // Nós arrastados da paleta lateral.
    canvas.addEventListener('dragover', (e) => {
      const types = e.dataTransfer?.types ?? [];
      if (types.includes(NODE_DRAG_TYPE) || types.includes(SYMBOL_DRAG_TYPE)) e.preventDefault();
    });
    canvas.addEventListener('drop', (e) => this.#onDropNode(e));
    this.graphTool = new GraphTool(canvas, editor, camera);
    window.addEventListener('keydown', (e) => this.#onModifierKey(e));
    window.addEventListener('keyup', (e) => this.#onModifierKey(e));
  }

  #points(event) {
    const rect = this.canvas.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return { screen, world: this.camera.screenToWorld(screen.x, screen.y), client: { x: event.clientX, y: event.clientY } };
  }

  #onDown(event) {
    if (event.button !== 0 || this.viewport.isSpaceDown || !this.editor.project) return;
    const { screen, world } = this.#points(event);
    const editor = this.editor;
    const hit = editor.hitAt(world);
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;

    this.canvas.setPointerCapture(event.pointerId);

    if (hit?.kind === 'item' && hit.part === 'toggle') {
      editor.toggleExpand(hit.entry.item.id);
      return;
    }

    if (hit?.kind === 'item' && hit.part === 'resize') {
      const rect = hit.entry.rect;
      this.#state = { type: 'resize', id: hit.entry.item.id, start: { w: rect.w, h: rect.h }, startWorld: world };
      return;
    }

    if (hit?.kind?.startsWith('g')) {
      this.graphTool.down(hit, event, { screen, world });
      this.#state = this.graphTool.active ? { type: 'graph' } : null;
      return;
    }

    if (hit?.kind === 'pin') {
      if (event.altKey) {
        editor.breakPin(hit.entry.item.id, hit.side);
        return;
      }
      const anchor = hit.side === 'out' ? hit.entry.outPin : hit.entry.inPin;
      editor.wireDrag = { fromId: hit.entry.item.id, side: hit.side, anchor, point: world };
      this.#state = { type: 'wire' };
      return;
    }

    if (hit?.kind === 'wire') {
      // Ctrl + clique remove a relação.
      if (event.ctrlKey || event.metaKey) editor.removeRelation(hit.wire.relation.id);
      else editor.selectRelation(hit.wire.relation.id);
      return;
    }

    const item = hit?.entry.item;
    const isDraggable = hit && (hit.part === 'card' || hit.part === 'header' || (hit.part === 'body' && item.kind !== 'folder'));
    if (isDraggable) {
      // Com modificador, item já selecionado só é desmarcado ao soltar sem arrastar,
      // para que Ctrl/Shift pressionados antes do clique não impeçam o arraste.
      let deselectOnClick = false;
      if (additive && editor.selection.has(item.id)) {
        deselectOnClick = true;
        editor.setFocus(item.id);
      } else if (additive) {
        editor.toggleSelect(item.id);
      } else if (!editor.selection.has(item.id)) {
        editor.select([item.id]);
      } else {
        editor.setFocus(item.id);
      }
      editor.raise([...editor.selection]);
      const starts = new Map(editor.selectedItems().map((i) => [i.id, { x: i.x, y: i.y, parentId: i.parentId, z: i.z }]));
      this.#state = {
        type: 'pending-drag',
        startScreen: screen,
        startWorld: world,
        starts,
        clickedId: item.id,
        additive,
        deselectOnClick,
        dragByBody: hit.part === 'body',
      };
      return;
    }

    // Vazio ou corpo de uma pasta expandida: laço no nível correspondente.
    const level = hit ? item.id : null;
    if (!additive) editor.clearSelection();
    if (hit) editor.setFocus(item.id);
    this.#state = { type: 'lasso', start: world, level, base: new Set(editor.selection) };
  }

  #onMove(event) {
    const { screen, world, client } = this.#points(event);
    const editor = this.editor;
    const state = this.#state;

    if (!state) {
      this.#updateHover(world);
      return;
    }

    if (state.type === 'graph') {
      this.graphTool.move(event, { screen, world, client });
      return;
    }

    if (state.type === 'resize') {
      editor.areaSizes.set(state.id, { w: state.start.w + world.x - state.startWorld.x, h: state.start.h + world.y - state.startWorld.y });
      editor.refresh();
      return;
    }

    if (state.type === 'wire') {
      editor.wireDrag.point = world;
      const hit = editor.hitAt(world);
      editor.hoverPin = hit?.kind === 'pin' ? { id: hit.entry.item.id, side: hit.side } : null;
      editor.renderer.invalidate();
      return;
    }

    if (state.type === 'pending-drag') {
      if (state.dragByBody) return;
      if (Math.hypot(screen.x - state.startScreen.x, screen.y - state.startScreen.y) < DRAG_THRESHOLD) return;
      state.type = 'drag';
      const subtree = new Set();
      for (const id of state.starts.keys()) {
        subtree.add(id);
        for (const d of editor.project.descendants(id)) subtree.add(d.id);
      }
      editor.dragSubtree = subtree;
      editor.dragLayout = editor.layout;
      this.canvas.style.cursor = 'grabbing';
    }

    if (state.type === 'drag') {
      state.last = { world, client };
      this.#applyDrag(state, { alt: event.altKey, ctrl: event.ctrlKey || event.metaKey });
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
      editor.selection = new Set([...state.base, ...editor.itemsInRect(rect, state.level)]);
      editor.renderer.invalidate();
    }
  }

  // Com Ctrl, os itens arrastados ficam "destacados": a área do pai para de acompanhá-los.
  #applyDrag(state, { alt, ctrl }) {
    const editor = this.editor;
    const { world, client } = state.last;
    const dx = world.x - state.startWorld.x;
    const dy = world.y - state.startWorld.y;
    for (const [id, start] of state.starts) {
      const item = editor.project.get(id);
      item.x = editor.snap(start.x + dx, alt);
      item.y = editor.snap(start.y + dy, alt);
    }
    editor.detached = ctrl ? new Set(state.starts.keys()) : null;
    editor.refresh();
    this.#updateDrop(world, client, ctrl);
  }

  // Pressionar/soltar Ctrl ou Alt sem mover o mouse também atualiza o arraste.
  #onModifierKey(event) {
    const state = this.#state;
    if (state?.type !== 'drag' || !state.last) return;
    if (!['Control', 'Meta', 'Alt'].includes(event.key)) return;
    event.preventDefault();
    this.#applyDrag(state, { alt: event.altKey, ctrl: event.ctrlKey || event.metaKey });
  }

  #onUp(event) {
    const { world, client } = this.#points(event);
    const editor = this.editor;
    const state = this.#state;
    this.#state = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (!state) return;

    if (state.type === 'graph') {
      this.graphTool.up(event, { world, client });
      return;
    }

    if (state.type === 'wire') {
      const drag = editor.wireDrag;
      const hit = editor.hitAt(world);
      editor.wireDrag = null;
      editor.hoverPin = null;
      const targetId = hit && hit.kind !== 'wire' ? hit.entry.item.id : null;
      if (targetId) {
        if (drag.side === 'out') editor.connect(drag.fromId, targetId);
        else editor.connect(targetId, drag.fromId);
      }
      editor.renderer.invalidate();
      return;
    }

    if (state.type === 'pending-drag') {
      if (state.deselectOnClick) editor.toggleSelect(state.clickedId);
      // Clique simples num item já selecionado (sem modificador) deixa só ele selecionado.
      else if (!state.additive && editor.selection.size > 1) editor.select([state.clickedId]);
      return;
    }

    if (state.type === 'drag') {
      // Arquivo solto dentro de um script expandido vira um const ligado a ele; um .gd solto
      // sobre um nó de cena vira o script do nó. Nos dois casos o arquivo não se move.
      const ids = [...state.starts.keys()];
      const file = ids.length === 1 ? editor.project.get(ids[0]) : null;
      const area = file?.kind === 'file' ? editor.graphAreaAt(world, new Set(ids)) : null;
      const gc = editor.graph;
      if (area && gc.isScript(area.entry.item)) {
        this.#endDragVisuals();
        editor.cancelDrag(state.starts);
        gc.addFileReference(area.id, file.id, world);
        return;
      }
      // .tscn solto dentro de outra cena expandida: instância daquela cena.
      if (area && gc.isScene(area.entry.item) && gc.isScene(file)) {
        this.#endDragVisuals();
        editor.cancelDrag(state.starts);
        gc.addSceneInstance(area.id, file.id, world);
        return;
      }
      if (area && gc.isScene(area.entry.item) && gc.isScript(file)) {
        const hit = gc.hit(area.entry, world);
        const node = hit?.nodeId ? gc.graph(area.id).nodes.find((n) => n.id === hit.nodeId) : null;
        if (node?.type === 'scene.node') {
          this.#endDragVisuals();
          editor.cancelDrag(state.starts);
          gc.setNodeScript(area.id, node.id, file.id);
          return;
        }
      }
      const drop = editor.resolveDrop(world, client, { leave: event.ctrlKey || event.metaKey });
      this.#endDragVisuals();
      editor.commitDrag(state.starts, drop);
      return;
    }

    if (state.type === 'lasso') {
      editor.lasso = null;
      const ids = [...editor.selection];
      editor.select(ids);
    }
  }

  #cancel() {
    const state = this.#state;
    this.#state = null;
    if (state?.type === 'graph') {
      this.graphTool.cancel();
      return;
    }
    const editor = this.editor;
    if (state?.type === 'drag') {
      this.#endDragVisuals();
      editor.commitDrag(state.starts, null);
    }
    editor.wireDrag = null;
    editor.lasso = null;
    editor.renderer.invalidate();
  }

  #endDragVisuals() {
    const editor = this.editor;
    editor.dragSubtree = null;
    editor.dropTarget = null;
    editor.dragLayout = null;
    editor.detached = null;
    editor.breadcrumbs.highlight(undefined);
    this.canvas.style.cursor = '';
    bus.emit('status', '');
  }

  #updateDrop(world, client, leave) {
    const editor = this.editor;
    const drop = editor.resolveDrop(world, client, { leave });
    editor.dropTarget = drop && drop.mode !== 'blocked' && !drop.viaBreadcrumb ? drop.parentId : null;
    editor.breadcrumbs.highlight(drop?.viaBreadcrumb ? drop.parentId : undefined);

    let message = '';
    if (drop?.mode === 'blocked') message = t('items.holdCtrlToLeave');
    else if (drop) {
      const name = drop.parentId ? editor.project.get(drop.parentId).name : editor.rootLabel();
      message = t('items.dropInto', { name });
    }
    bus.emit('status', message);
  }

  #updateHover(world) {
    const editor = this.editor;
    if (!editor.layout) return;
    const hit = editor.hitAt(world);
    if (this.graphTool.hover(hit)) {
      if (editor.hoverPin) {
        editor.hoverPin = null;
        editor.renderer.invalidate();
      }
      return;
    }
    const pin = hit?.kind === 'pin' ? { id: hit.entry.item.id, side: hit.side } : null;
    if (pin?.id !== editor.hoverPin?.id || pin?.side !== editor.hoverPin?.side) {
      editor.hoverPin = pin;
      editor.renderer.invalidate();
    }
    if (this.viewport.isSpaceDown) return;
    let cursor = '';
    if (pin) cursor = 'crosshair';
    else if (hit?.kind === 'wire') cursor = 'pointer';
    else if (hit?.kind === 'item' && hit.part === 'toggle') cursor = 'pointer';
    else if ((hit?.kind === 'item' && hit.part === 'resize') || hit?.kind === 'gresize') cursor = 'nwse-resize';
    else if (hit?.kind === 'item' && hit.part !== 'body') cursor = 'move';
    this.canvas.style.cursor = cursor;
  }

  // Soltar vindo do painel: definição de nó ou símbolo da aba Projeto.
  #onDropNode(event) {
    const defId = event.dataTransfer?.getData(NODE_DRAG_TYPE);
    const symbolData = event.dataTransfer?.getData(SYMBOL_DRAG_TYPE);
    if ((!defId && !symbolData) || !this.editor.project) return;
    event.preventDefault();
    const { world } = this.#points(event);
    const hit = this.editor.hitAt(world);
    if (!hit?.fileId) {
      toast.info(t('graph.dropInsideScript'));
      return;
    }
    if (symbolData) this.editor.graph.dropSymbol(hit.fileId, JSON.parse(symbolData), world, event.altKey);
    else this.editor.graph.addNode(hit.fileId, defId, world);
  }

  #onDoubleClick(event) {
    const { world } = this.#points(event);
    const hit = this.editor.hitAt(world);
    if (hit?.kind?.startsWith('g')) {
      this.graphTool.doubleClick(hit, world);
      return;
    }
    if (hit?.kind === 'item' && (hit.part === 'card' || hit.part === 'header')) {
      this.editor.toggleExpand(hit.entry.item.id);
    }
  }
}
