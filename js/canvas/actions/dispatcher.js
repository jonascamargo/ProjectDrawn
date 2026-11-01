import { bus } from '../../core/events.js';
import { containerAt } from '../itemLayout.js';
import { isModalOpen } from '../../ui/modal.js';
import { isContextMenuOpen, showContextMenu } from '../../ui/contextMenu.js';
import { isNodeSearchOpen } from '../../ui/nodeSearch.js';
import { isInlineEditorOpen } from '../../ui/inlineEditor.js';
import { isTyping } from '../viewportController.js';
import { buildMenu, firstTrigger, keyMatches, runFirst, triggers } from './registry.js';
import { withItemProfile } from '../../lang/profileLoader.js';
import './index.js';

const GRAPH_AREAS = { garea: 'script', gscope: 'scope', gtoggle: 'scope', gresize: 'scope', gcresize: 'comment', gpin: 'pin', gdefault: 'pin', gkey: 'pin', gremove: 'pin', gwire: 'wire', glabel: 'label' };

// Liga os eventos do canvas às ações registradas (ver registry.js): descobre a área sob o
// ponteiro, monta o contexto e chama o primeiro gatilho que aceita.
export class ActionDispatcher {
  #session = null;
  #sessionFile = null;

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
    canvas.addEventListener('wheel', (e) => this.#onWheel(e), { passive: false });
    canvas.addEventListener('dragover', (e) => {
      if (triggers('drop').some(({ trigger }) => trigger.accepts(e.dataTransfer))) e.preventDefault();
    });
    canvas.addEventListener('drop', (e) => this.#onDrop(e));
    window.addEventListener('keydown', (e) => this.#onModifierKey(e));
    window.addEventListener('keyup', (e) => this.#onModifierKey(e));
    window.addEventListener('keydown', (e) => this.#onKeyDown(e));
    bus.on('canvas:contextmenu', (e) => this.#onContextMenu(e));
  }

  // Área de um resultado do teste de clique. Dentro de um script: 'script' (vazio),
  // 'scope' (sub-área), 'node', 'reroute', 'comment', 'pin', 'wire' ou 'label'.
  areaOf(hit) {
    if (!hit) return 'canvas';
    if (hit.kind === 'item') return hit.entry.item.kind === 'folder' ? 'folder' : hit.entry.item.kind === 'comment' ? 'note' : 'file';
    if (!hit.kind?.startsWith('g')) return 'canvas';
    const area = GRAPH_AREAS[hit.kind];
    if (area) return area;
    if (!hit.nodeId) return 'script';
    const placed = this.editor.layout?.entries.get(hit.fileId)?.graph?.nodes.get(hit.nodeId);
    if (placed?.node.type === 'core.reroute') return 'reroute';
    if (placed?.template === 'comment' && hit.kind === 'gnode') return 'comment';
    return 'node';
  }

  #points(event) {
    const rect = this.canvas.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return { screen, world: this.camera.screenToWorld(screen.x, screen.y), client: { x: event.clientX, y: event.clientY } };
  }

  // Contexto entregue às ações.
  context(event, points, hit = this.editor.hitAt(points.world)) {
    const editor = this.editor;
    return {
      editor,
      graph: editor.graph,
      project: editor.project,
      camera: this.camera,
      canvas: this.canvas,
      viewport: this.viewport,
      dispatcher: this,
      event,
      ...points,
      hit,
      area: this.areaOf(hit),
      part: hit?.part ?? null,
      item: hit?.kind === 'item' ? hit.entry.item : null,
      // Nó do grafo sob o ponteiro (só leitura; alterações passam pelo GraphController).
      node: hit?.nodeId ? editor.layout?.entries.get(hit.fileId)?.graph?.nodes.get(hit.nodeId)?.node ?? null : null,
      fileId: hit?.fileId ?? null,
      mods: { ctrl: Boolean(event?.ctrlKey || event?.metaKey), alt: Boolean(event?.altKey), shift: Boolean(event?.shiftKey) },
    };
  }

  // Ponto do ponteiro em coordenadas da janela (centro do canvas se o mouse nunca entrou).
  pointerClient() {
    const rect = this.canvas.getBoundingClientRect();
    const screen = this.editor.pointerScreen ?? { x: rect.width / 2, y: rect.height / 2 };
    return { x: rect.left + screen.x, y: rect.top + screen.y };
  }

  // Arquivo do grafo sob o ponteiro: as ações rodam com o perfil de linguagem dele.
  #file(ctx) {
    return ctx.fileId ? this.editor.project?.get(ctx.fileId) ?? null : null;
  }

  #inFile(item, fn) {
    return withItemProfile(item, fn);
  }

  // ---------- ponteiro ----------

  #onDown(event) {
    if (event.button !== 0 || this.viewport.isSpaceDown || !this.editor.project) return;
    const ctx = this.context(event, this.#points(event));
    this.canvas.setPointerCapture(event.pointerId);
    this.#sessionFile = this.#file(ctx);
    this.#session = this.#inFile(this.#sessionFile, () => firstTrigger('press', ctx.area, ctx)?.trigger.run(ctx)) ?? null;
  }

  #onMove(event) {
    const points = this.#points(event);
    const session = this.#session;
    if (session) {
      this.#inFile(this.#sessionFile, () => session.move?.(this.context(event, points, null)));
      return;
    }
    if (!this.editor.layout) return;
    const ctx = this.context(event, points);
    const cursor = this.#inFile(this.#file(ctx), () => {
      for (const { trigger } of triggers('hover', ctx.area)) {
        if (trigger.when && !trigger.when(ctx)) continue;
        const result = trigger.run(ctx);
        if (result === true) return null;
        if (typeof result === 'string') return result;
      }
      return '';
    });
    if (cursor !== null) this.canvas.style.cursor = cursor;
  }

  #onUp(event) {
    const session = this.#session;
    this.#session = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (session) this.canvas.style.cursor = '';
    this.#inFile(this.#sessionFile, () => session?.up?.(this.context(event, this.#points(event), null)));
  }

  #cancel() {
    const session = this.#session;
    this.#session = null;
    if (session) this.canvas.style.cursor = '';
    this.#inFile(this.#sessionFile, () => session?.cancel?.());
  }

  // Pressionar/soltar Ctrl ou Alt sem mover o mouse também atualiza o arraste.
  #onModifierKey(event) {
    this.#inFile(this.#sessionFile, () => this.#session?.modifiers?.(event));
  }

  #onDoubleClick(event) {
    const ctx = this.context(event, this.#points(event));
    this.#inFile(this.#file(ctx), () => firstTrigger('dblclick', ctx.area, ctx)?.trigger.run(ctx));
  }

  #onWheel(event) {
    event.preventDefault();
    const ctx = this.context(event, this.#points(event));
    this.#inFile(this.#file(ctx), () => runFirst('wheel', ctx.area, ctx));
  }

  #onDrop(event) {
    if (!this.editor.project) return;
    const ctx = this.context(event, this.#points(event));
    const found = triggers('drop', ctx.area).find(({ trigger }) => trigger.accepts(event.dataTransfer));
    if (!found) return;
    event.preventDefault();
    this.#inFile(this.#file(ctx), () => found.trigger.run(ctx));
  }

  // ---------- teclado ----------

  #onKeyDown(event) {
    const editor = this.editor;
    if (!editor.project || isModalOpen() || isContextMenuOpen() || isNodeSearchOpen() || isInlineEditorOpen() || isTyping(event.target)) return;
    const ctx = { ...this.context(event, { world: editor.pointerWorld, screen: editor.pointerScreen, client: this.pointerClient() }, null), area: null };
    // Atalhos agem na seleção de nós (ou no script sob o mouse): usam o perfil desse arquivo.
    const fileId = editor.graph.fileId ?? editor.hitAt(editor.pointerWorld)?.fileId;
    this.#inFile(fileId ? editor.project.get(fileId) : null, () => {
      for (const { trigger } of triggers('key')) {
        if (!keyMatches(trigger, event)) continue;
        if (trigger.when && !trigger.when(ctx)) continue;
        if (trigger.run(ctx) === false) continue;
        event.preventDefault();
        return;
      }
    });
  }

  // ---------- menu de contexto ----------

  #onContextMenu({ world, client, shiftKey }) {
    const editor = this.editor;
    if (isModalOpen() || !editor.project) return;
    const ctx = this.context({ shiftKey }, { world, client, screen: null });
    // Corpo de uma pasta expandida conta como canvas dentro dela.
    if (ctx.area === 'folder' && ctx.part === 'body') ctx.area = 'canvas';
    ctx.parentId = ctx.item && ctx.area !== 'canvas' ? ctx.item.id : containerAt(editor.layout, editor.project, world).id;
    const entries = this.#inFile(this.#file(ctx), () => buildMenu(ctx.area, ctx));
    if (entries?.length) showContextMenu(client.x, client.y, entries);
  }
}
