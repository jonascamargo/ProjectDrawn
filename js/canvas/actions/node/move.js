import { bus } from '../../../core/events.js';
import { graphSnapshot } from '../../../core/graphOps.js';
import { opensScope, pruneWires } from '../../../core/graph.js';
import { getDef } from '../../../lang/nodeRegistry.js';
import { t } from '../../../i18n/i18n.js';
import { inComment } from '../../commentText.js';

const DRAG_THRESHOLD = 4;

// Clicar seleciona (Ctrl/Shift alterna); arrastar move os nós selecionados (Alt desliga o
// snap). Soltar dentro de uma função leva os nós para ela; com Ctrl a área congela e soltar
// tira os nós da função. Comentário que agrupa leva junto os nós inteiros dentro dele.
export default {
  id: 'node.move',
  area: ['node', 'reroute', 'comment'],
  press: {
    when: (c) => c.hit.kind === 'gnode',
    run(c) {
      const { graph: gc, fileId, node } = c;
      const additive = c.mods.ctrl || c.mods.shift;
      const selected = gc.fileId === fileId && gc.nodes.has(node.id);
      let deselectOnClick = false;
      if (additive && selected) deselectOnClick = true;
      else if (additive) gc.toggleNode(fileId, node.id);
      else if (!selected) gc.select(fileId, { nodes: [node.id] });
      bus.emit('selection:changed');
      return new NodeDrag(c, { clickedId: node.id, deselectOnClick, additive });
    },
  },
  hover: {
    when: (c) => c.hit.kind === 'gnode',
    run: () => 'move',
  },
};

class NodeDrag {
  constructor(c, data) {
    Object.assign(this, data);
    this.editor = c.editor;
    this.gc = c.graph;
    this.fileId = c.fileId;
    this.startScreen = c.screen;
    this.startWorld = c.world;
    this.starts = null;
    this.scopeStarts = new Map();
  }

  move(m) {
    const { editor, gc, fileId } = this;
    if (!this.starts) {
      if (Math.hypot(m.screen.x - this.startScreen.x, m.screen.y - this.startScreen.y) < DRAG_THRESHOLD) return;
      const item = editor.project.get(fileId);
      this.before = structuredClone(item.graph);
      this.dragLayout = editor.layout;
      this.starts = new Map(item.graph.nodes.filter((n) => gc.nodes.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y, scopeId: n.scopeId ?? null }]));
      const placed = this.dragLayout?.entries.get(fileId)?.graph?.nodes;
      for (const c of placed?.values() ?? []) {
        if (c.template !== 'comment' || !c.group || !this.starts.has(c.node.id)) continue;
        for (const n of placed.values()) {
          if (n === c || this.starts.has(n.node.id) || (n.node.scopeId ?? null) !== (c.node.scopeId ?? null)) continue;
          const r = n.rect;
          if (inComment(r, c.rect)) {
            this.starts.set(n.node.id, { x: n.node.x, y: n.node.y, scopeId: n.node.scopeId ?? null });
          }
        }
        // Funções/eventos (sub-áreas) inteiros dentro do comentário vão junto.
        if ((c.node.scopeId ?? null) !== null) continue;
        for (const sc of this.dragLayout.entries.get(fileId).graph.scopes.values()) {
          const r = sc.rect;
          if (inComment(r, c.rect)) {
            this.scopeStarts.set(sc.scope.id, { x: sc.scope.x, y: sc.scope.y });
          }
        }
      }
      m.canvas.style.cursor = 'grabbing';
    }
    const dx = m.world.x - this.startWorld.x;
    const dy = m.world.y - this.startWorld.y;
    for (const node of editor.project.get(fileId).graph.nodes) {
      const start = this.starts.get(node.id);
      if (!start) continue;
      node.x = editor.snap(start.x + dx, m.mods.alt);
      node.y = editor.snap(start.y + dy, m.mods.alt);
    }
    for (const scope of editor.project.get(fileId).graph.scopes) {
      const start = this.scopeStarts.get(scope.id);
      if (!start) continue;
      scope.x = editor.snap(start.x + dx, m.mods.alt);
      scope.y = editor.snap(start.y + dy, m.mods.alt);
    }
    this.#detach(m.mods.ctrl);
    editor.refresh();
  }

  // Ctrl pressionado/solto sem mover o mouse também congela/solta a área.
  modifiers(event) {
    if (!this.starts || !['Control', 'Meta'].includes(event.key)) return;
    event.preventDefault();
    this.#detach(event.ctrlKey || event.metaKey);
    this.editor.refresh();
  }

  // Com Ctrl, os nós arrastados não entram no tamanho da função (a área "congela").
  #detach(ctrl) {
    this.gc.detachedNodes = ctrl ? new Set(this.starts.keys()) : null;
    bus.emit('status', t(ctrl ? 'graph.dropLeaveScope' : 'graph.dropToScope'));
  }

  up(u) {
    const { editor, gc, fileId } = this;
    if (!this.starts) {
      if (this.deselectOnClick) gc.toggleNode(fileId, this.clickedId);
      else if (!this.additive && gc.nodes.size > 1) gc.select(fileId, { nodes: [this.clickedId] });
      return;
    }
    bus.emit('status', '');
    gc.detachedNodes = null;
    const item = editor.project.get(fileId);
    this.#moveToScope(item.graph, u.world, u.mods.ctrl);
    gc.settleComments(fileId, item.graph);
    const after = structuredClone(item.graph);
    editor.history.execute(graphSnapshot(editor.project, fileId, this.before, after, t('graph.history.move')));
  }

  cancel() {
    this.gc.detachedNodes = null;
    if (this.starts) {
      this.editor.project.get(this.fileId).graph = this.before;
      bus.emit('project:changed', this.editor.project);
    }
    this.editor.renderer.invalidate();
  }

  // Soltar nós dentro de uma função os move para ela (automático, como entrar numa pasta);
  // tirar da função para o escopo do script pede Ctrl ao soltar (sem Ctrl a área só cresce).
  // Variável muda junto: membro dentro da função vira local, e local fora vira membro.
  // Fios que passariam a ligar sub-áreas diferentes são removidos.
  #moveToScope(graph, world, leave) {
    const { gc, fileId, dragLayout } = this;
    const target = gc.scopeAt(fileId, world, dragLayout);
    if (target === null && !leave) return;
    const moved = graph.nodes.filter((n) => this.starts.has(n.id) && !opensScope(getDef(n.type)) && (n.scopeId ?? null) !== target);
    if (!moved.length) return;
    const newOrigin = gc.originFor(fileId, target, dragLayout);
    for (const node of moved) {
      const oldOrigin = gc.originFor(fileId, node.scopeId ?? null, dragLayout);
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
}
