import { bus } from '../core/events.js';
import { uid } from '../core/ids.js';
import {
  canConnect,
  dynamicPinId,
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
  externalMember,
  isVariableDeclaration,
  setActionResolver,
  setFileResolver,
  setScriptResolver,
} from '../core/graph.js';
import { inputActions } from '../ui/projectSettings.js';
import { editGraph } from '../core/graphOps.js';
import { getDef, resourceClasses, sceneNodeClasses, typesCompatible } from '../lang/nodeRegistry.js';
import { fileTypeOfItem, primaryProfile, profileIdFor, profileOf, withItemProfile } from '../lang/profileLoader.js';
import { t } from '../i18n/i18n.js';
import { theme } from '../theme/themeLoader.js';
import { contains } from '../canvas/itemLayout.js';
import { hitGraph, layoutGraph } from '../canvas/graphLayout.js';
import { nearestAlong } from '../canvas/wireGeometry.js';
import { inComment, settleUnderText, textBlockHeight } from '../canvas/commentText.js';
import { openNodeSearch } from '../ui/nodeSearch.js';
import { toast } from '../ui/toast.js';
import { isReal } from '../core/realItems.js';

// Seleção e ações sobre os grafos de nós dos scripts. Usado pelo Editor (cliques,
// menus, atalhos) e pelas ações do canvas (js/canvas/actions).
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
    // Operações num arquivo rodam com o perfil de linguagem dele (definições de nós, tipos).
    const profiled = (name, itemOf) => {
      const fn = this[name];
      this[name] = (...args) => withItemProfile(itemOf(args), () => fn.apply(this, args));
    };
    // Arquivo do diretório real: os nós são somente leitura (posição e recolher continuam).
    const readOnly = (name, itemOf) => {
      const fn = this[name];
      this[name] = (...args) => {
        if (isReal(this.project, itemOf(args))) {
          toast.info(t('real.lockedGraph'));
          return false;
        }
        return fn.apply(this, args);
      };
    };
    for (const name of READ_ONLY_FILE_METHODS) readOnly(name, ([fileId]) => this.project?.get(fileId));
    for (const name of ['deleteSelection', 'duplicateSelection']) readOnly(name, () => this.project?.get(this.fileId));
    for (const name of FILE_METHODS) profiled(name, ([fileId]) => this.project?.get(fileId));
    for (const name of SELECTION_METHODS) profiled(name, () => this.project?.get(this.fileId));
    profiled('layoutFor', ([item]) => item);
    profiled('hit', ([entry]) => entry.item);
    // Membros de outros scripts: grafo, nome de autoload, class_name e extends do script.
    setScriptResolver((id) => {
      const item = this.project?.get(id);
      if (!item || !this.isScript(item)) return null;
      const graph = readGraph(item);
      const field = (type, key) => graph.nodes.find((n) => n.type === type)?.fields?.[key] || null;
      return { graph, autoload: item.autoload || null, className: field('class.class_name', 'name'), base: field('class.extends', 'base') };
    });
    // Ação de entrada: nome atual da ação no Mapa de entrada do projeto.
    setActionResolver((id) => inputActions(this.project).find((a) => a.id === id) ?? null);
    // const (arquivo): caminho res:// e tipo do arquivo referenciado, sempre atuais.
    setFileResolver((id) => {
      const item = this.project?.get(id);
      return item ? { path: this.project.path(id, primaryProfile()?.rootLabel ?? ''), category: fileTypeOfItem(item).category } : null;
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
  // Arquivos de dados (JSON, .tres…): nós de dados, sem funções nem fluxo.
  supportsGraph(item) {
    return this.isScript(item) || this.isScene(item) || this.isData(item);
  }

  isData(item) {
    return item?.kind === 'file' && fileTypeOfItem(item).graph === 'data';
  }

  isScript(item) {
    return item?.kind === 'file' && fileTypeOfItem(item).graph === 'script';
  }

  isScene(item) {
    return item?.kind === 'file' && fileTypeOfItem(item).graph === 'scene';
  }

  // Usado pelo layout de itens para medir o grafo dos arquivos expandidos.
  layoutFor(item) {
    if (!item.expanded || !this.supportsGraph(item) || !item.graph) return null;
    return layoutGraph(item.graph, theme(), { strict: this.strict(), sizes: this.scopeSizes, detached: this.detachedNodes });
  }

  stateFor(fileId) {
    const mine = fileId === this.fileId;
    return {
      selectedNodes: mine ? this.nodes : EMPTY,
      selectedScopes: mine ? this.scopes : EMPTY,
      raisedNodes: this.raised?.fileId === fileId ? this.raised.nodes : EMPTY,
      issues: this.editor.issues?.get(fileId)?.byNode ?? null,
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

  // Clique dentro da área de uma função/evento: ela vem para frente (sem mudar a seleção).
  raiseScope(fileId, scopeId) {
    this.raised = { fileId, nodes: new Set(), scopes: new Set([scopeId]) };
    this.editor.renderer.invalidate();
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
    // Arquivo de dados: só os nós da linguagem (sem parâmetros, membros de scripts nem ações).
    if (this.isData(this.project.get(fileId))) {
      // .tres: classes de recurso do catálogo criam sub-recursos já com a classe.
      const classes = getDef('tres.sub')
        ? resourceClasses().map((cls) => ({
          id: 'tres.sub', title: cls.name, subtitle: cls.inherits, category: t('graph.search.resourceClasses'), keywords: [cls.inherits],
          pins: { in: [], out: [{ kind: 'data', type: cls.name }] }, fields: { class: cls.name },
        }))
        : [];
      const choice = await openNodeSearch({ x: client.x, y: client.y, filter, extra: classes });
      if (choice) this.addNode(fileId, choice.id, world, { pending, fields: choice.fields });
      return;
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
    // Shader: variáveis embutidas da função sob o ponteiro (ler; e escrever quando permitido).
    extra.push(...this.#builtinEntries(fileId, scopeId));
    // Membros acessíveis sem alvo de outros scripts (autoload e constantes/estáticos de class_name).
    extra.push(...this.#globalEntries(fileId));
    // Ações do Mapa de entrada (criam "Ação de entrada" já apontando para a ação).
    for (const action of getDef('input.action') ? inputActions(this.project) : []) {
      extra.push({ id: 'input.action', title: action.name, subtitle: 'Input', category: t('graph.search.inputActions'), keywords: ['input', 'ação'], pins: { in: [], out: [{ kind: 'data', type: 'bool' }] }, fields: { ref: action.id } });
    }
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
      if (getDef('tres.sub')) {
        for (const cls of resourceClasses()) {
          classes.push({ id: 'tres.sub', title: cls.name, subtitle: cls.inherits, category: t('graph.search.resourceClasses'), keywords: [cls.inherits], pins: { in: [], out: [{ kind: 'data', type: cls.name }] }, fields: { class: cls.name } });
        }
      }
      const comment = getDef('misc.comment');
      if (comment) classes.push({ id: comment.id, title: comment.title, category: comment.category, keywords: comment.keywords ?? [], pins: { in: [], out: [] } });
      const choice = await openNodeSearch({ x: client.x, y: client.y, filter, extra: classes, base: false });
      if (choice) this.addNode(fileId, choice.id, world, { pending, fields: choice.fields });
      return;
    }
    const choice = await openNodeSearch({ x: client.x, y: client.y, filter, extra });
    if (choice) this.addNode(fileId, choice.id, world, { pending, fields: choice.fields });
  }

  // Embutidas do shader (perfil com "builtins"): globais + as da função (vertex/fragment/light)
  // conforme o shader_type do arquivo.
  #builtinEntries(fileId, scopeId) {
    const table = profileOf(this.project.get(fileId))?.builtins;
    if (!table) return [];
    const graph = this.graph(fileId);
    const kind = graph.nodes.find((n) => n.type === 'sh.type')?.fields?.type || 'canvas_item';
    const entry = graph.nodes.find((n) => n.scopeId === scopeId && getDef(n.type)?.template === 'event');
    const fn = { 'sh.vertex': 'vertex', 'sh.fragment': 'fragment', 'sh.light': 'light' }[entry?.type];
    const list = [...(table.global ?? []), ...(fn ? table[kind]?.[fn] ?? [] : [])];
    const category = t('graph.search.builtins', { name: fn ? `${fn}()` : 'global' });
    const out = [];
    for (const v of list) {
      if (v.mode !== 'out') out.push({ id: 'sh.in', title: v.name, subtitle: v.type, category, keywords: ['builtin'], pins: { in: [], out: [{ kind: 'data', type: v.type }] }, fields: { name: v.name, type: v.type } });
      if (v.mode !== 'in') out.push({ id: 'sh.out', title: `${v.name} =`, subtitle: v.type, category, keywords: ['builtin'], pins: { in: [{ kind: 'flow' }, { kind: 'data', type: v.type }], out: [{ kind: 'flow' }] }, fields: { name: v.name, type: v.type } });
    }
    return out;
  }

  // Entradas de busca com os membros globais (Game.pontos, Player.MAX, Game.salvar()…).
  // Só de scripts da mesma linguagem.
  #globalEntries(fileId) {
    const entries = [];
    const language = profileIdFor(this.project.get(fileId));
    for (const item of this.project.items.values()) {
      if (item.id === fileId || !this.isScript(item) || profileIdFor(item) !== language) continue;
      const graph = readGraph(item);
      const refs = [
        ...graph.nodes.filter((n) => isVariableDeclaration(n) && n.type !== 'var.local').map((n) => n.id),
        ...graph.nodes.filter((n) => n.type === 'signal.declare').map((n) => n.id),
        ...graph.scopes.filter((sc) => sc.kind === 'function').map((sc) => sc.id),
      ];
      for (const ref of refs) {
        const member = externalMember(item.id, ref);
        if (!member?.prefix) continue;
        const id = member.kind === 'func' ? 'ext.call' : member.kind === 'signal' ? 'ext.emit' : 'ext.get';
        entries.push({
          id,
          title: `${member.prefix}.${member.name}${member.kind === 'func' ? '()' : member.kind === 'signal' ? '.emit()' : ''}`,
          subtitle: member.type ?? '',
          category: t('graph.search.global', { name: member.prefix }),
          keywords: [member.prefix, member.name],
          pins: id === 'ext.get' ? { in: [], out: [{ kind: 'data', type: member.type }] } : { in: [{ kind: 'flow' }], out: [{ kind: 'flow' }] },
          fields: { file: item.id, ref },
        });
      }
    }
    return entries;
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
    if (!this.isScript(this.project.get(fileId))) {
      toast.info(t('graph.symbolOtherScript'));
      return;
    }
    // Membro de outro script: Autoload.membro, Classe.CONST ou alvo.membro.
    if (symbol.fileId !== fileId) {
      const member = externalMember(symbol.fileId, symbol.id);
      if (!member) return;
      if (altKey && member.kind === 'const') {
        toast.warning(t('graph.constReadOnly'));
        return;
      }
      const id = member.kind === 'func' ? 'ext.call' : member.kind === 'signal' ? 'ext.emit' : altKey ? 'ext.set' : 'ext.get';
      this.addNode(fileId, id, world, { fields: { file: symbol.fileId, ref: symbol.id } });
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
      const node = (id) => graph.nodes.find((n) => n.id === id);
      const fromMax = findPin(node(from.node), from.pin, 'out', graph)?.max;
      const toMax = findPin(node(to.node), to.pin, 'in', graph)?.max;
      connect(graph, from, to, check.kind, { fromMax, toMax });
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
    this.updateNode(fileId, nodeId, (node) => {
      node.fields = { ...node.fields, script: scriptId || '' };
    }, t('graph.history.nodeScript'));
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

  // ---------- arquivo arrastado para o script ----------

  // Cria um const ligado ao arquivo: preload para cena/script/recurso, caminho em texto para o resto.
  addFileReference(fileId, itemId, world) {
    const item = this.project.get(itemId);
    if (!item || item.kind !== 'file') return;
    const category = fileTypeOfItem(item).category;
    const mode = PRELOAD_CATEGORIES.has(category) ? 'preload' : 'path';
    const base = item.name.replace(/\.[^.]+$/, '');
    const name = mode === 'preload' ? pascalCase(base) : `${snakeUpper(base)}_PATH`;
    this.addNode(fileId, 'var.path', world, { fields: { name, ref: itemId, mode } });
  }

  // Referências importadas pelo caminho (res://…) cujo arquivo não existia: quando um arquivo
  // com esse caminho aparece no projeto, o nó passa a apontar para ele (fields.ref / script).
  relinkPaths() {
    const project = this.project;
    if (!project) return;
    let byPath = null;
    const find = (path) => {
      if (!byPath) {
        const root = primaryProfile()?.rootLabel ?? '';
        byPath = new Map([...project.items.values()].map((item) => [project.path(item.id, root), item.id]));
      }
      return byPath.get(path) ?? null;
    };
    for (const item of project.items.values()) {
      for (const node of item.graph?.nodes ?? []) {
        const f = node.fields;
        if (!f) continue;
        if (f.path && !f.ref && find(f.path)) f.ref = find(f.path);
        if (f.scriptExt?.path && !f.script && find(f.scriptExt.path)) f.script = find(f.scriptExt.path);
        if (f.instanceExt?.path && !f.instance && find(f.instanceExt.path)) f.instance = find(f.instanceExt.path);
      }
    }
  }

  // Texto do comentário do script; depois o conteúdo é ajeitado sob o texto.
  setCommentText(fileId, nodeId, text) {
    editGraph(this.history, this.project, fileId, t('comment.editHistory'), (graph) => {
      const target = graph.nodes.find((n) => n.id === nodeId);
      if (!target) return false;
      target.fields = { ...target.fields, text };
      this.settleComments(fileId, graph, nodeId);
    });
  }

  // Comentários que agrupam: o que está dentro (mais de 60% da área) não fica sob o texto;
  // quem encosta desce o necessário e a caixa cresce para continuar envolvendo tudo.
  // Altera `graph` direto (chamar dentro de uma edição ou antes de uma fotografia).
  settleComments(fileId, graph, onlyId = null) {
    const placed = this.entry(fileId)?.graph;
    if (!placed) return;
    const s = theme().node;
    const lineH = s.rowHeight * 0.8;
    for (const c of graph.nodes) {
      if (c.type !== 'misc.comment' || c.fields?.group === false || (onlyId && c.id !== onlyId)) continue;
      const box = { x: c.x, y: c.y, w: c.w ?? 320, h: c.h ?? 180 };
      const textBottom = box.y + s.headerHeight + textBlockHeight(c.fields?.text, box.w - s.padding * 2, s.font, lineH) + 8;
      const scope = c.scopeId ?? null;
      const members = [
        ...graph.nodes.filter((n) => n !== c && n.type !== 'misc.comment' && (n.scopeId ?? null) === scope).map((n) => [n, placed.nodes.get(n.id)?.rect]),
        ...(scope === null ? graph.scopes.map((sc) => [sc, placed.scopes.get(sc.id)?.rect]) : []),
      ]
        .filter(([, size]) => size)
        .map(([obj, size]) => ({ rect: { x: obj.x, y: obj.y, w: size.w, h: size.h }, move: (y) => { obj.y = y; } }))
        .filter((m) => inComment(m.rect, box));
      c.h = settleUnderText(box, textBottom, members) - box.y;
    }
  }

  // Alt+C: caixa de comentário (misc.comment) em volta dos nós selecionados.
  commentAround(fileId) {
    const placed = this.entry(fileId)?.graph?.nodes;
    const graph = this.graph(fileId);
    const nodes = graph.nodes.filter((n) => this.nodes.has(n.id) && n.type !== 'misc.comment');
    if (!placed || !nodes.length || !getDef('misc.comment')) return false;
    const scopeId = nodes[0].scopeId ?? null;
    const same = nodes.filter((n) => (n.scopeId ?? null) === scopeId);
    const first = placed.get(same[0].id);
    const dx = first.rect.x - same[0].x;
    const dy = first.rect.y - same[0].y;
    const rects = same.map((n) => placed.get(n.id)?.rect).filter(Boolean);
    const pad = 20;
    const minX = Math.min(...rects.map((r) => r.x)) - pad;
    const minY = Math.min(...rects.map((r) => r.y)) - pad - 30;
    const maxX = Math.max(...rects.map((r) => r.x + r.w)) + pad;
    const maxY = Math.max(...rects.map((r) => r.y + r.h)) + pad;
    editGraph(this.history, this.project, fileId, t('comment.history'), (g) => {
      const node = createNode('misc.comment', { x: minX - dx, y: minY - dy, scopeId });
      node.w = maxX - minX;
      node.h = maxY - minY;
      g.nodes.unshift(node);
    });
    return true;
  }

  // ---------- editar ----------

  // Remove só a repetição `index` dos pinos dinâmicos de entrada (item de lista, par do
  // dicionário…): os seguintes sobem uma posição levando fios, valores e rótulos.
  removeDynamicPinAt(fileId, nodeId, index) {
    this.updateNode(fileId, nodeId, (node, graph) => {
      const def = getDef(node.type);
      const count = node.dynIn ?? 0;
      if (!def?.dynamicInputs || index < 0 || index >= count || count <= (def.dynamicInputs.min ?? 0)) return false;
      const bases = def.dynamicInputs.pins ?? [];
      const rename = new Map();
      for (const base of bases) {
        rename.set(dynamicPinId(base, index), null);
        for (let i = index + 1; i < count; i++) rename.set(dynamicPinId(base, i), dynamicPinId(base, i - 1));
      }
      graph.wires = graph.wires.filter((w) => !(w.to.node === node.id && rename.get(w.to.pin) === null));
      for (const w of graph.wires) if (w.to.node === node.id && rename.has(w.to.pin)) w.to = { ...w.to, pin: rename.get(w.to.pin) };
      for (const key of ['defaults', 'pinLabels']) {
        if (!node[key]) continue;
        const next = {};
        for (const [pin, value] of Object.entries(node[key])) {
          if (!rename.has(pin)) next[pin] = value;
          else if (rename.get(pin) !== null) next[rename.get(pin)] = value;
        }
        node[key] = next;
      }
      node.dynIn = count - 1;
    }, t('graph.history.removePin'));
  }

  // Chave de objeto (JSON): renomear ou remover pela id (o fio da chave é mantido ao renomear).
  setKey(fileId, nodeId, keyId, name) {
    this.updateNode(fileId, nodeId, (node) => {
      const keys = node.keys ?? [];
      const index = keys.findIndex((k) => k.id === keyId);
      if (index < 0) return false;
      node.keys = name === null ? keys.filter((k) => k.id !== keyId) : keys.map((k) => (k.id === keyId ? { ...k, name } : k));
    }, t(name === null ? 'graph.history.removeKey' : 'graph.history.renameKey'));
  }

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
      // Objeto com chaves: nova chave com nome livre (chave, chave_2…).
      if (side === 'in' && getDef(node.type)?.keyed) {
        node.keys = [...(node.keys ?? [])];
        const names = new Set(node.keys.map((k) => k.name));
        let name = 'chave';
        for (let i = 2; names.has(name); i++) name = `chave_${i}`;
        node.keys.push({ id: uid('k'), name });
        return;
      }
      if (side === 'in') node.dynIn = (node.dynIn ?? 0) + 1;
      else node.dynOut = (node.dynOut ?? 0) + 1;
    }, t('graph.history.addPin'));
  }

  removeDynamicPin(fileId, nodeId, side) {
    const def = getDef(this.graph(fileId).nodes.find((n) => n.id === nodeId)?.type);
    const min = (side === 'in' ? def?.dynamicInputs?.min : def?.dynamicOutputs?.min) ?? 0;
    this.updateNode(fileId, nodeId, (node) => {
      if (side === 'in' && def?.keyed) {
        if (!node.keys?.length) return false;
        node.keys = node.keys.slice(0, -1);
        return;
      }
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
        // Nós que apontam para declarações/funções/sinais excluídos perdem a referência.
        removeNodes(graph, [...nodes]);
        const alive = new Set([...graph.nodes.map((n) => n.id), ...graph.scopes.map((sc) => sc.id)]);
        for (const node of graph.nodes) if (refersToGraph(node) && node.fields?.ref && !alive.has(node.fields.ref)) node.fields.ref = null;
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
      profileId: profileIdFor(this.project.get(this.fileId)),
      nodes: structuredClone(nodes),
      wires: structuredClone(graph.wires.filter((w) => ids.has(w.from.node) && ids.has(w.to.node))),
    };
    bus.emit('status', t('graph.copied', { count: nodes.length }));
    return true;
  }

  paste(fileId, world) {
    const clip = this.clipboard;
    if (!clip) return false;
    // Nós de outra linguagem não valem aqui (definições diferentes).
    if (clip.profileId !== profileIdFor(this.project.get(fileId))) {
      toast.info(t('graph.pasteOtherLanguage'));
      return false;
    }
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
        // Referência a declaração/função de outro arquivo não vale aqui.
        const ref = refersToGraph(node) ? node.fields?.ref : null;
        if (ref && idMap.has(ref)) node.fields.ref = idMap.get(ref);
        else if (ref && !graph.nodes.some((n) => n.id === ref) && !graph.scopes.some((sc) => sc.id === ref)) node.fields.ref = null;
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
}

const EMPTY = new Set();

// Métodos com fileId como primeiro argumento / que agem na seleção atual (ver construtor).
const FILE_METHODS = [
  'toggleCollapse', 'nodesInRect', 'addNode', 'spawnVariableAccess', 'dropSymbol', 'connectPins', 'breakPin',
  'insertReroute', 'removeWire', 'removeReroute', 'addWireLabel', 'setWireLabel', 'organizeTree', 'setNodeScript',
  'addSceneInstance', 'addFileReference', 'updateNode', 'addDynamicPin', 'removeDynamicPin', 'paste', 'openSearch',
  'scopeAt', 'originFor', 'select', 'toggleNode', 'setKey', 'removeDynamicPinAt', 'commentAround', 'setCommentText',
];
const READ_ONLY_FILE_METHODS = [
  'setCommentText',
  'addNode', 'spawnVariableAccess', 'dropSymbol', 'connectPins', 'breakPin', 'insertReroute', 'removeWire', 'removeReroute',
  'addWireLabel', 'setWireLabel', 'organizeTree', 'setNodeScript', 'addSceneInstance', 'addFileReference', 'updateNode',
  'addDynamicPin', 'removeDynamicPin', 'removeDynamicPinAt', 'paste', 'setKey',
];
const SELECTION_METHODS = ['deleteSelection', 'copySelection', 'duplicateSelection', 'selectedNode'];

// fields.ref aponta para um nó ou sub-área do próprio grafo (variável, função, sinal)?
// Outras referências (parâmetro, ação de entrada, arquivo) não dependem dos nós do grafo.
function refersToGraph(node) {
  const def = getDef(node.type);
  return node.type === 'var.get' || node.type === 'var.set' || def?.ref === 'function' || def?.ref === 'signal';
}

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

