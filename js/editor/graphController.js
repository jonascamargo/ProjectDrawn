import { bus } from '../core/events.js';
import { uid } from '../core/ids.js';
import {
  canConnect,
  connect,
  createNode,
  createScope,
  findPin,
  nodePins,
  opensScope,
  pinType,
  pruneWires,
  readGraph,
  removeNodes,
  removeReroute,
  removeScopes,
  resolveTypes,
  scopeParams,
  setFileResolver,
} from '../core/graph.js';
import { editGraph } from '../core/graphOps.js';
import { removeRelations } from '../core/projectOps.js';
import { getDef, sceneNodeClasses, typesCompatible } from '../lang/nodeRegistry.js';
import { currentProfile, fileTypeOf } from '../lang/profileLoader.js';
import { t } from '../i18n/i18n.js';
import { theme } from '../theme/themeLoader.js';
import { contains } from '../canvas/itemLayout.js';
import { hitGraph, layoutGraph } from '../canvas/graphLayout.js';
import { nearestAlong } from '../canvas/wireGeometry.js';
import { showContextMenu } from '../ui/contextMenu.js';
import { openNodeSearch } from '../ui/nodeSearch.js';
import { toast } from '../ui/toast.js';

// Seleção e ações sobre os grafos de nós dos scripts. Usado pelo Editor (cliques,
// menus, atalhos) e pela ferramenta de interação (GraphTool).
export class GraphController {
  constructor(editor) {
    this.editor = editor;
    this.fileId = null; // arquivo da seleção atual
    this.nodes = new Set();
    this.scopes = new Set();
    this.wire = null;
    this.hoverPin = null;
    this.clipboard = null;
    // Tamanho ajustado das sub-áreas pela alça (só na memória, não vai para o projeto).
    this.scopeSizes = new Map();
    // const (arquivo): caminho res:// e tipo do arquivo referenciado, sempre atuais.
    setFileResolver((id) => {
      const item = this.project?.get(id);
      return item ? { path: this.project.path(id, currentProfile()?.rootLabel ?? ''), category: fileTypeOf(item.name).category } : null;
    });
  }

  get project() {
    return this.editor.project;
  }

  get history() {
    return this.editor.history;
  }

  strict() {
    return this.project?.settings.strictTypes !== false;
  }

  // Arquivos que têm área de nós (scripts). Cenas entram na 4C.
  // Arquivos com área de nós: scripts (lógica) e cenas (árvore de nós da engine).
  supportsGraph(item) {
    return this.isScript(item) || this.isScene(item);
  }

  isScript(item) {
    return item?.kind === 'file' && fileTypeOf(item.name).graph === 'script';
  }

  isScene(item) {
    return item?.kind === 'file' && fileTypeOf(item.name).graph === 'scene';
  }

  // Usado pelo layout de itens para medir o grafo dos arquivos expandidos.
  layoutFor(item) {
    if (!item.expanded || !this.supportsGraph(item) || !item.graph) return null;
    return layoutGraph(item.graph, theme(), { strict: this.strict(), sizes: this.scopeSizes });
  }

  stateFor(fileId) {
    const mine = fileId === this.fileId;
    return {
      selectedNodes: mine ? this.nodes : EMPTY,
      selectedScopes: mine ? this.scopes : EMPTY,
      raisedNodes: this.raised?.fileId === fileId ? this.raised.nodes : EMPTY,
      raisedScopes: this.raised?.fileId === fileId ? this.raised.scopes : EMPTY,
      selectedWire: mine ? this.wire : null,
      hoverPin: this.hoverPin?.fileId === fileId ? this.hoverPin : null,
    };
  }

  hasSelection() {
    return Boolean(this.nodes.size || this.scopes.size || this.wire);
  }

  // ---------- consulta ----------

  entry(fileId) {
    return this.editor.layout?.entries.get(fileId);
  }

  graph(fileId) {
    return readGraph(this.project.get(fileId));
  }

  // Clique dentro da área de um script expandido.
  hit(entry, p) {
    if (!this.supportsGraph(entry.item)) return null;
    const zoom = this.editor.camera.zoom;
    const h = entry.graph
      ? hitGraph(entry.graph, p, { pinRadius: Math.max(8 / zoom, 6), wireTolerance: 6 / zoom, theme: theme(), ...this.stateFor(entry.item.id) })
      : null;
    return { ...(h ?? { kind: 'garea' }), fileId: entry.item.id, entry };
  }

  // Sub-área sob o ponto (null = escopo da classe).
  scopeAt(fileId, p, layout = this.editor.layout) {
    const g = layout?.entries.get(fileId)?.graph;
    if (!g) return null;
    for (const sc of [...g.scopes.values()].reverse()) if (!sc.collapsed && contains(sc.rect, p)) return sc.scope.id;
    return null;
  }

  originFor(fileId, scopeId, layout = this.editor.layout) {
    const entry = layout?.entries.get(fileId);
    if (!entry) return { x: 0, y: 0 };
    if (scopeId) return entry.graph?.scopes.get(scopeId)?.origin ?? entry.origin;
    return entry.origin;
  }

  // ---------- seleção ----------

  select(fileId, { nodes = [], scopes = [], wire = null } = {}, additive = false) {
    if (!additive || fileId !== this.fileId) {
      this.nodes = new Set();
      this.scopes = new Set();
      this.wire = null;
    }
    this.fileId = fileId;
    nodes.forEach((id) => this.nodes.add(id));
    scopes.forEach((id) => this.scopes.add(id));
    if (wire) {
      this.wire = wire;
      this.nodes.clear();
      this.scopes.clear();
    }
    this.#raise();
    if (this.editor.selection.size) this.editor.clearSelection({ keepGraph: true });
    this.editor.renderer.invalidate();
    bus.emit('selection:changed');
  }

  toggleNode(fileId, nodeId) {
    if (fileId !== this.fileId) return this.select(fileId, { nodes: [nodeId] });
    if (this.nodes.has(nodeId)) this.nodes.delete(nodeId);
    else this.nodes.add(nodeId);
    this.#raise();
    this.wire = null;
    this.editor.renderer.invalidate();
    bus.emit('selection:changed');
  }

  // O último selecionado continua por cima (mesmo depois de desmarcar) até outro ser selecionado.
  #raise() {
    if (!this.nodes.size && !this.scopes.size) return;
    this.raised = { fileId: this.fileId, nodes: new Set(this.nodes), scopes: new Set(this.scopes) };
  }

  clear() {
    if (!this.hasSelection() && !this.fileId) return;
    this.nodes = new Set();
    this.scopes = new Set();
    this.wire = null;
    this.fileId = null;
    this.editor.renderer.invalidate();
    bus.emit('selection:changed');
  }

  // Remove da seleção o que não existe mais (após desfazer, por exemplo).
  prune() {
    if (!this.fileId) return;
    const item = this.project?.get(this.fileId);
    if (!item) return this.clear();
    const g = readGraph(item);
    const nodeIds = new Set(g.nodes.map((n) => n.id));
    const scopeIds = new Set(g.scopes.map((s) => s.id));
    for (const id of [...this.nodes]) if (!nodeIds.has(id)) this.nodes.delete(id);
    for (const id of [...this.scopes]) if (!scopeIds.has(id)) this.scopes.delete(id);
    if (this.wire && !g.wires.some((w) => w.id === this.wire)) this.wire = null;
  }

  // Nó mostrado no painel de propriedades: o nó selecionado ou a entrada da função selecionada.
  selectedNode() {
    const graph = this.graph(this.fileId);
    if (this.nodes.size === 1) {
      const id = [...this.nodes][0];
      return graph.nodes.find((n) => n.id === id) ?? null;
    }
    if (!this.nodes.size && this.scopes.size === 1) {
      const scopeId = [...this.scopes][0];
      return graph.nodes.find((n) => n.scopeId === scopeId && getDef(n.type)?.template === 'event') ?? null;
    }
    return null;
  }

  // Recolhe/expande um nó (esconde pinos sem fio) ou uma sub-área (vira um nó).
  toggleCollapse(fileId, { nodeId, scopeId }) {
    editGraph(this.history, this.project, fileId, t('graph.history.collapse'), (graph) => {
      const target = nodeId ? graph.nodes.find((n) => n.id === nodeId) : graph.scopes.find((sc) => sc.id === scopeId);
      if (!target) return false;
      target.collapsed = !target.collapsed;
    });
    // Recolher/expandir descarta o tamanho ajustado da sub-área.
    if (scopeId) this.scopeSizes.delete(scopeId);
  }

  nodesInRect(fileId, rect, scopeId) {
    const g = this.entry(fileId)?.graph;
    if (!g) return [];
    const out = [];
    for (const n of g.nodes.values()) {
      if ((n.node.scopeId ?? null) !== (scopeId ?? null)) continue;
      const r = n.rect;
      if (r.x <= rect.x + rect.w && r.x + r.w >= rect.x && r.y <= rect.y + rect.h && r.y + r.h >= rect.y) out.push(n.node.id);
    }
    return out;
  }

  // ---------- criar nós ----------

  // Cria um nó no ponto do mundo. pending: { nodeId, pinId, side } para já conectar.
  addNode(fileId, defId, world, { pending = null, fields = null } = {}) {
    const def = getDef(defId);
    if (!def) return null;
    const grid = this.project.settings.gridSize;
    const snap = (v) => this.editor.snap(v);
    let created = null;

    editGraph(this.history, this.project, fileId, t('graph.history.addNode', { name: def.title }), (graph) => {
      if (opensScope(def)) {
        const origin = this.originFor(fileId, null);
        const scope = createScope(defId === 'func.entry' ? 'function' : 'event', { x: snap(world.x - origin.x), y: snap(world.y - origin.y) });
        graph.scopes.push(scope);
        created = createNode(defId, { x: 0, y: 0, scopeId: scope.id });
      } else {
        const scopeId = pending ? graph.nodes.find((n) => n.id === pending.nodeId)?.scopeId ?? null : this.scopeAt(fileId, world);
        const origin = this.originFor(fileId, scopeId);
        created = createNode(defId, { x: snap(world.x - origin.x), y: snap(world.y - origin.y - grid / 2), scopeId });
      }
      if (fields) Object.assign(created.fields, fields);
      graph.nodes.push(created);
      if (pending) this.#connectPending(graph, created, pending);
    });
    if (created) this.select(fileId, { nodes: [created.id] });
    return created;
  }

  #connectPending(graph, node, pending) {
    const source = graph.nodes.find((n) => n.id === pending.nodeId);
    const sourcePin = source && findPin(source, pending.pinId, pending.side, graph);
    if (!sourcePin) return;
    const types = resolveTypes(graph);
    const pins = nodePins(node, getDef(node.type), graph);
    const candidates = pending.side === 'out' ? pins.inputs : pins.outputs;
    const sourceType = pinType(source, sourcePin, types);
    const match = candidates.find((p) => p.kind === sourcePin.kind && (sourcePin.kind !== 'data' || !this.strict() || (pending.side === 'out' ? typesCompatible(sourceType, p.type) : typesCompatible(p.type, sourceType))));
    if (!match) return;
    const from = pending.side === 'out' ? { node: source.id, pin: sourcePin.id } : { node: node.id, pin: match.id };
    const to = pending.side === 'out' ? { node: node.id, pin: match.id } : { node: source.id, pin: sourcePin.id };
    connect(graph, from, to, sourcePin.kind);
  }

  async openSearch(fileId, world, client, pending = null) {
    let filter = null;
    if (pending) {
      const graph = this.graph(fileId);
      const node = graph.nodes.find((n) => n.id === pending.nodeId);
      const pin = node && findPin(node, pending.pinId, pending.side, graph);
      if (pin) filter = { side: pending.side, kind: pin.kind, type: pinType(node, pin, resolveTypes(graph)), strict: this.strict() };
    }
    // Parâmetros da função sob o ponteiro aparecem primeiro (criam "ler parâmetro").
    const scopeId = pending ? this.graph(fileId).nodes.find((n) => n.id === pending.nodeId)?.scopeId : this.scopeAt(fileId, world);
    const extra = scopeParams(this.graph(fileId), scopeId).map((p) => ({
      id: 'param.get',
      title: p.name,
      subtitle: p.type,
      category: t('graph.search.params'),
      keywords: ['param', 'parametro'],
      pins: { in: [], out: [{ kind: 'data', type: p.type }] },
      fields: { ref: p.id },
    }));
    // Cena: só classes de nó da engine (e comentário).
    if (this.isScene(this.project.get(fileId))) {
      const classes = sceneNodeClasses().map((cls) => ({
        id: 'scene.node',
        title: cls.name,
        subtitle: cls.inherits,
        category: t('graph.search.sceneNodes'),
        keywords: [cls.inherits],
        pins: { in: [{ kind: 'tree' }], out: [{ kind: 'tree' }] },
        fields: { class: cls.name, name: cls.name },
      }));
      const ref = getDef('scene.scriptRef');
      if (ref) classes.push({ id: ref.id, title: ref.title, category: ref.category, keywords: ref.keywords ?? [], pins: { in: [{ kind: 'signal' }], out: [] } });
      const comment = getDef('misc.comment');
      if (comment) classes.push({ id: comment.id, title: comment.title, category: comment.category, keywords: comment.keywords ?? [], pins: { in: [], out: [] } });
      const choice = await openNodeSearch({ x: client.x, y: client.y, filter, extra: classes, base: false });
      if (choice) this.addNode(fileId, choice.id, world, { pending, fields: choice.fields });
      return;
    }
    const choice = await openNodeSearch({ x: client.x, y: client.y, filter, extra });
    if (choice) this.addNode(fileId, choice.id, world, { pending, fields: choice.fields });
  }

  // Ctrl/Alt + arrastar declaração: cria "ler"/"definir" que referencia a declaração.
  spawnVariableAccess(fileId, declId, world, mode) {
    const graph = this.graph(fileId);
    const decl = graph.nodes.find((n) => n.id === declId);
    if (!decl) return;
    const scopeId = this.scopeAt(fileId, world);
    if (decl.type === 'var.local' && (decl.scopeId ?? null) !== (scopeId ?? null)) {
      toast.warning(t('graph.localOutOfScope'));
      return;
    }
    if (mode === 'set' && decl.type === 'var.const') {
      toast.warning(t('graph.constReadOnly'));
      return;
    }
    this.addNode(fileId, mode === 'set' ? 'var.set' : 'var.get', world, { fields: { ref: declId } });
  }

  // Item arrastado da aba Projeto ou de Propriedades: variável (ler; Alt = definir), função
  // (chamar), sinal (emitir) ou parâmetro (ler parâmetro, só dentro da própria função).
  dropSymbol(fileId, symbol, world, altKey) {
    if (symbol.fileId !== fileId || !this.isScript(this.project.get(fileId))) {
      toast.info(t('graph.symbolOtherScript'));
      return;
    }
    if (symbol.kind === 'var') this.spawnVariableAccess(fileId, symbol.id, world, altKey ? 'set' : 'get');
    else if (symbol.kind === 'func') this.addNode(fileId, 'func.call', world, { fields: { ref: symbol.id } });
    else if (symbol.kind === 'signal') this.addNode(fileId, 'signal.emit', world, { fields: { ref: symbol.id } });
    else if (symbol.kind === 'param') {
      if (this.scopeAt(fileId, world) !== symbol.scopeId) {
        toast.warning(t('graph.paramOutOfScope'));
        return;
      }
      this.addNode(fileId, 'param.get', world, { fields: { ref: symbol.id } });
    }
  }

  // ---------- conexões ----------

  connectPins(fileId, a, b) {
    // a e b: { nodeId, pinId, side }; normaliza para saída → entrada.
    if (a.side === b.side) return;
    const [out, inp] = a.side === 'out' ? [a, b] : [b, a];
    const from = { node: out.nodeId, pin: out.pinId };
    const to = { node: inp.nodeId, pin: inp.pinId };
    const check = canConnect(this.graph(fileId), from, to, { strict: this.strict() });
    if (!check.ok) {
      toast.warning(t(`graph.cannotConnect.${check.reason}`));
      return;
    }
    editGraph(this.history, this.project, fileId, t('graph.history.connect'), (graph) => {
      connect(graph, from, to, check.kind);
    });
  }

  breakPin(fileId, nodeId, pinId, side) {
    editGraph(this.history, this.project, fileId, t('graph.history.disconnect'), (graph) => {
      const before = graph.wires.length;
      graph.wires = graph.wires.filter((w) => !(side === 'out' ? w.from.node === nodeId && w.from.pin === pinId : w.to.node === nodeId && w.to.pin === pinId));
      return graph.wires.length !== before ? true : false;
    });
  }

  // Duplo clique no fio: insere um reroute que herda tipo e direção.
  insertReroute(fileId, wireId, world) {
    editGraph(this.history, this.project, fileId, t('graph.history.reroute'), (graph) => {
      const wire = graph.wires.find((w) => w.id === wireId);
      if (!wire) return false;
      const fromNode = graph.nodes.find((n) => n.id === wire.from.node);
      const scopeId = fromNode?.scopeId ?? null;
      const origin = this.originFor(fileId, scopeId);
      const node = createNode('core.reroute', { x: world.x - origin.x - 7, y: world.y - origin.y - 7, scopeId });
      node.rerouteKind = wire.kind;
      graph.nodes.push(node);
      graph.wires = graph.wires.filter((w) => w.id !== wireId);
      graph.wires.push({ id: uid('wr'), kind: wire.kind, from: wire.from, to: { node: node.id, pin: 'in' } });
      graph.wires.push({ id: uid('wr'), kind: wire.kind, from: { node: node.id, pin: 'out' }, to: wire.to });
    });
  }

  // Ctrl + clique no fio: remove a conexão.
  removeWire(fileId, wireId) {
    editGraph(this.history, this.project, fileId, t('graph.history.disconnect'), (graph) => {
      const before = graph.wires.length;
      graph.wires = graph.wires.filter((w) => w.id !== wireId);
      return graph.wires.length !== before;
    });
    if (this.wire === wireId) this.clear();
  }

  // Ctrl + clique no reroute: remove o reroute religando os fios que passavam por ele.
  removeReroute(fileId, nodeId) {
    editGraph(this.history, this.project, fileId, t('graph.history.removeReroute'), (graph) => {
      if (!graph.nodes.some((n) => n.id === nodeId && n.type === 'core.reroute')) return false;
      removeReroute(graph, nodeId);
    });
    this.prune();
  }

  // ---------- etiquetas de fio ----------

  addWireLabel(fileId, wireId, world) {
    const placed = this.entry(fileId)?.graph?.wires.find((w) => w.wire.id === wireId);
    const at = placed ? nearestAlong(placed.points, world) : 0.5;
    this.setWireLabel(fileId, wireId, { text: t('graph.label.default'), at });
    this.select(fileId, { wire: wireId });
    this.editor.showSidebarTab?.('properties');
  }

  // label: { text, typeChange: { from, to }, icon, color, at } ou null para remover.
  setWireLabel(fileId, wireId, label, history = t('graph.history.label')) {
    editGraph(this.history, this.project, fileId, history, (graph) => {
      const wire = graph.wires.find((w) => w.id === wireId);
      if (!wire) return false;
      if (label) wire.label = label;
      else delete wire.label;
    });
  }

  // ---------- cenas ----------

  // Reposiciona os nós da cena em árvore (pai à esquerda, filhos empilhados à direita).
  organizeTree(fileId) {
    const placed = this.entry(fileId)?.graph?.nodes;
    if (!placed) return;
    const GAP_X = 80;
    const GAP_Y = 24;
    editGraph(this.history, this.project, fileId, t('graph.history.organizeTree'), (graph) => {
      const scene = graph.nodes.filter((n) => getDef(n.type)?.sceneNode);
      if (!scene.length) return false;
      const ids = new Set(scene.map((n) => n.id));
      const children = new Map();
      const hasParent = new Set();
      for (const w of graph.wires) {
        if (w.kind !== 'tree' || !ids.has(w.from.node) || !ids.has(w.to.node)) continue;
        if (!children.has(w.from.node)) children.set(w.from.node, []);
        children.get(w.from.node).push(w.to.node);
        hasParent.add(w.to.node);
      }
      const byId = new Map(scene.map((n) => [n.id, n]));
      // Filhos na ordem vertical atual (quem está mais acima vem primeiro).
      for (const list of children.values()) list.sort((a, b) => byId.get(a).y - byId.get(b).y);
      const size = (id) => placed.get(id)?.rect ?? { w: 200, h: 60 };
      const depthWidth = [];
      const measure = (id, depth, seen) => {
        if (seen.has(id)) return;
        seen.add(id);
        depthWidth[depth] = Math.max(depthWidth[depth] ?? 0, size(id).w);
        for (const c of children.get(id) ?? []) measure(c, depth + 1, seen);
      };
      const roots = scene.filter((n) => !hasParent.has(n.id)).sort((a, b) => a.y - b.y);
      const seen = new Set();
      for (const r of roots) measure(r.id, 0, seen);
      const columnX = [];
      let x = Math.min(...roots.map((r) => r.x));
      for (let d = 0; d < depthWidth.length; d++) {
        columnX[d] = x;
        x += depthWidth[d] + GAP_X;
      }
      let cursor = Math.min(...roots.map((r) => r.y));
      const visited = new Set();
      const place = (id, depth) => {
        if (visited.has(id)) return;
        visited.add(id);
        const node = byId.get(id);
        node.x = this.editor.snap(columnX[depth]);
        node.y = this.editor.snap(cursor);
        const kids = children.get(id) ?? [];
        if (!kids.length) cursor += size(id).h + GAP_Y;
        else for (const c of kids) place(c, depth + 1);
        cursor = Math.max(cursor, node.y + size(id).h + GAP_Y);
      };
      for (const r of roots) place(r.id, 0);
    });
  }

  // Define o script de um nó de cena (só o ícone 📜 no nó; não cria fio de relação).
  setNodeScript(fileId, nodeId, scriptId) {
    this.history.transaction(t('graph.history.nodeScript'), () => {
      this.updateNode(fileId, nodeId, (node) => {
        node.fields = { ...node.fields, script: scriptId || '' };
      });
      // Remove relações "script" automáticas criadas por versões anteriores.
      const auto = [...this.project.relations.values()].filter((r) => r.from === fileId && r.auto).map((r) => r.id);
      if (auto.length) this.history.execute(removeRelations(this.project, auto, t('history.disconnect')));
    });
  }

  // Instância de outra cena: nó com a classe da raiz daquela cena e o ícone 🔗.
  addSceneInstance(fileId, sceneId, world) {
    if (fileId === sceneId) {
      toast.warning(t('graph.instanceSelf'));
      return;
    }
    const scene = this.project.get(sceneId);
    if (!scene) return;
    const graph = readGraph(scene);
    const parents = new Set(graph.wires.filter((w) => w.kind === 'tree').map((w) => w.to.node));
    const root = graph.nodes.find((n) => getDef(n.type)?.sceneNode && !parents.has(n.id));
    const name = pascalCase(scene.name.replace(/\.[^.]+$/, ''));
    this.addNode(fileId, 'scene.node', world, { fields: { name, class: root?.fields?.class || 'Node', instance: sceneId } });
  }

  // Pinos da cena recolhida: propriedades e sinais expostos, agrupados pelo nó da cena.
  // Retorna [{ name, inputs: [{ label, type }], outputs: [{ label }] }] (só nós com algo exposto).
  scenePins(item) {
    if (!this.isScene(item) || item.expanded) return null;
    const graph = readGraph(item);
    const groups = [];
    for (const node of graph.nodes) {
      const def = getDef(node.type);
      if (!def?.sceneNode) continue;
      const pins = nodePins(node, def, graph);
      const inputs = pins.inputs.filter((p) => p.id.startsWith('prop:')).map((p) => ({ label: p.label, type: p.type }));
      const outputs = pins.outputs.filter((p) => p.id.startsWith('sig:')).map((p) => ({ label: p.label }));
      if (inputs.length || outputs.length) groups.push({ name: node.fields?.name || node.fields?.class || 'Node', inputs, outputs });
    }
    return groups.length ? groups : null;
  }

  // ---------- arquivo arrastado para o script ----------

  // Cria um const ligado ao arquivo: preload para cena/script/recurso, caminho em texto para o resto.
  addFileReference(fileId, itemId, world) {
    const item = this.project.get(itemId);
    if (!item || item.kind !== 'file') return;
    const category = fileTypeOf(item.name).category;
    const mode = PRELOAD_CATEGORIES.has(category) ? 'preload' : 'path';
    const base = item.name.replace(/\.[^.]+$/, '');
    const name = mode === 'preload' ? pascalCase(base) : `${snakeUpper(base)}_PATH`;
    this.addNode(fileId, 'var.path', world, { fields: { name, ref: itemId, mode } });
  }

  // ---------- editar ----------

  updateNode(fileId, nodeId, mutate, label) {
    editGraph(this.history, this.project, fileId, label ?? t('graph.history.edit'), (graph) => {
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (!node) return false;
      const result = mutate(node, graph);
      pruneWires(graph);
      return result;
    });
  }

  addDynamicPin(fileId, nodeId, side) {
    this.updateNode(fileId, nodeId, (node) => {
      if (side === 'in') node.dynIn = (node.dynIn ?? 0) + 1;
      else node.dynOut = (node.dynOut ?? 0) + 1;
    }, t('graph.history.addPin'));
  }

  removeDynamicPin(fileId, nodeId, side) {
    const def = getDef(this.graph(fileId).nodes.find((n) => n.id === nodeId)?.type);
    const min = (side === 'in' ? def?.dynamicInputs?.min : def?.dynamicOutputs?.min) ?? 0;
    this.updateNode(fileId, nodeId, (node) => {
      const key = side === 'in' ? 'dynIn' : 'dynOut';
      if ((node[key] ?? 0) <= min) return false;
      node[key] -= 1;
    }, t('graph.history.removePin'));
  }

  deleteSelection() {
    if (!this.fileId || !this.hasSelection()) return false;
    const fileId = this.fileId;
    const { nodes, scopes, wire } = this;
    this.history.transaction(t('graph.history.delete'), () => {
      editGraph(this.history, this.project, fileId, t('graph.history.delete'), (graph) => {
        if (wire) graph.wires = graph.wires.filter((w) => w.id !== wire);
        removeScopes(graph, [...scopes]);
        // Excluir o nó de entrada de uma sub-área exclui a sub-área inteira.
        const entryScopes = graph.nodes.filter((n) => nodes.has(n.id) && opensScope(getDef(n.type)) && n.scopeId).map((n) => n.scopeId);
        removeScopes(graph, entryScopes);
        // Nós de ler/definir que apontam para declarações excluídas perdem a referência.
        removeNodes(graph, [...nodes]);
        const alive = new Set([...graph.nodes.map((n) => n.id), ...graph.scopes.map((sc) => sc.id)]);
        for (const node of graph.nodes) if (node.fields?.ref && !alive.has(node.fields.ref)) node.fields.ref = null;
      });
    });
    this.clear();
    return true;
  }

  // ---------- copiar / colar ----------

  copySelection() {
    if (!this.fileId || !this.nodes.size) return false;
    const graph = this.graph(this.fileId);
    const nodes = graph.nodes.filter((n) => this.nodes.has(n.id) && !opensScope(getDef(n.type)));
    if (!nodes.length) return false;
    const ids = new Set(nodes.map((n) => n.id));
    this.clipboard = {
      nodes: structuredClone(nodes),
      wires: structuredClone(graph.wires.filter((w) => ids.has(w.from.node) && ids.has(w.to.node))),
    };
    bus.emit('status', t('graph.copied', { count: nodes.length }));
    return true;
  }

  paste(fileId, world) {
    const clip = this.clipboard;
    if (!clip) return false;
    const scopeId = this.scopeAt(fileId, world);
    const origin = this.originFor(fileId, scopeId);
    const minX = Math.min(...clip.nodes.map((n) => n.x));
    const minY = Math.min(...clip.nodes.map((n) => n.y));
    const idMap = new Map(clip.nodes.map((n) => [n.id, uid('nd')]));
    const pasted = [];
    editGraph(this.history, this.project, fileId, t('graph.history.paste', { count: clip.nodes.length }), (graph) => {
      for (const source of clip.nodes) {
        const node = structuredClone(source);
        node.id = idMap.get(source.id);
        node.scopeId = scopeId;
        node.x = this.editor.snap(world.x - origin.x + (source.x - minX));
        node.y = this.editor.snap(world.y - origin.y + (source.y - minY));
        // Referência a declaração de outro arquivo não vale aqui.
        if (node.fields?.ref && !idMap.has(node.fields.ref) && !graph.nodes.some((n) => n.id === node.fields.ref)) node.fields.ref = null;
        else if (node.fields?.ref && idMap.has(node.fields.ref)) node.fields.ref = idMap.get(node.fields.ref);
        graph.nodes.push(node);
        pasted.push(node.id);
      }
      for (const wire of clip.wires) {
        graph.wires.push({ ...structuredClone(wire), id: uid('wr'), from: { ...wire.from, node: idMap.get(wire.from.node) }, to: { ...wire.to, node: idMap.get(wire.to.node) } });
      }
    });
    this.select(fileId, { nodes: pasted });
    return true;
  }

  duplicateSelection() {
    if (!this.copySelection()) return false;
    const entry = this.entry(this.fileId);
    const first = entry?.graph?.nodes.get([...this.nodes][0]);
    if (!first) return false;
    return this.paste(this.fileId, { x: first.rect.x + 40, y: first.rect.y + 40 });
  }

  // ---------- menus ----------

  contextMenu(hit, world, client) {
    const fileId = hit.fileId;
    if (hit.kind === 'gwire' || hit.kind === 'glabel') {
      this.select(fileId, { wire: hit.wireId });
      const hasLabel = Boolean(this.graph(fileId).wires.find((w) => w.id === hit.wireId)?.label);
      showContextMenu(client.x, client.y, [
        { label: t('graph.menu.addReroute'), action: () => this.insertReroute(fileId, hit.wireId, world) },
        hasLabel
          ? { label: t('graph.menu.removeLabel'), action: () => this.setWireLabel(fileId, hit.wireId, null) }
          : { label: t('graph.menu.addLabel'), action: () => this.addWireLabel(fileId, hit.wireId, world) },
        'separator',
        { label: t('graph.menu.deleteWire'), shortcut: 'Del', danger: true, action: () => this.deleteSelection() },
      ]);
      return true;
    }
    if (hit.kind === 'gnode' || hit.kind === 'gpin' || hit.kind === 'gdefault' || hit.kind === 'gadd' || hit.kind === 'gscript') {
      const nodeId = hit.nodeId;
      if (!this.nodes.has(nodeId) || this.fileId !== fileId) this.select(fileId, { nodes: [nodeId] });
      const node = this.graph(fileId).nodes.find((n) => n.id === nodeId);
      const def = getDef(node?.type);
      const entries = [];
      if (hit.kind === 'gpin') entries.push({ label: t('graph.menu.disconnectPin'), action: () => this.breakPin(fileId, nodeId, hit.pinId, hit.side) }, 'separator');
      if (def?.dynamicInputs) entries.push({ label: t('graph.menu.addInput'), action: () => this.addDynamicPin(fileId, nodeId, 'in') }, { label: t('graph.menu.removeInput'), action: () => this.removeDynamicPin(fileId, nodeId, 'in') });
      if (def?.dynamicOutputs) entries.push({ label: t('graph.menu.addOutput'), action: () => this.addDynamicPin(fileId, nodeId, 'out') }, { label: t('graph.menu.removeOutput'), action: () => this.removeDynamicPin(fileId, nodeId, 'out') });
      if (def?.sceneNode) entries.push({ label: t('graph.menu.organizeTree'), action: () => this.organizeTree(fileId) });
      if (entries.length && entries[entries.length - 1] !== 'separator') entries.push('separator');
      entries.push(
        { label: t('clipboard.copy'), shortcut: 'Ctrl+C', action: () => this.copySelection() },
        { label: t('clipboard.duplicate'), shortcut: 'Ctrl+D', action: () => this.duplicateSelection() },
        'separator',
        { label: t('graph.menu.deleteNode'), shortcut: 'Del', danger: true, action: () => this.deleteSelection() },
      );
      showContextMenu(client.x, client.y, entries);
      return true;
    }
    if (hit.kind === 'gscope' && hit.part === 'header') {
      this.select(fileId, { scopes: [hit.scopeId] });
      showContextMenu(client.x, client.y, [{ label: t('graph.menu.deleteScope'), danger: true, action: () => this.deleteSelection() }]);
      return true;
    }
    // Área vazia do script (ou corpo de sub-área): busca de nós direto.
    this.openSearch(fileId, world, client);
    return true;
  }

  // Menu secundário da área (clique direito com Shift): opções da área do script.
  areaOptions(fileId, world, client) {
    const scene = this.isScene(this.project.get(fileId));
    showContextMenu(client.x, client.y, [
      { label: t('graph.menu.addNode'), shortcut: 'Tab', action: () => this.openSearch(fileId, world, client) },
      { label: t('clipboard.paste'), shortcut: 'Ctrl+V', disabled: !this.clipboard, action: () => this.paste(fileId, world) },
      ...(scene ? [{ label: t('graph.menu.organizeTree'), action: () => this.organizeTree(fileId) }] : []),
      'separator',
      {
        label: t('graph.menu.strictTypes'),
        checked: this.strict(),
        action: () => {
          this.project.settings.strictTypes = !this.strict();
          bus.emit('project:changed', this.project);
        },
      },
    ]);
  }
}

const EMPTY = new Set();
const PRELOAD_CATEGORIES = new Set(['scene', 'script', 'resource', 'shader']);

function words(text) {
  return String(text).split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean);
}

function pascalCase(text) {
  const out = words(text).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
  return /^\d/.test(out) ? `_${out}` : out || 'Arquivo';
}

function snakeUpper(text) {
  const out = words(text).map((w) => w.toUpperCase()).join('_');
  return /^\d/.test(out) ? `_${out}` : out || 'ARQUIVO';
}

