import { uid } from './ids.js';
import { classPropertyType, getDef, typesCompatible } from '../lang/nodeRegistry.js';

// Grafo de nós de um arquivo (script):
// graph = {
//   scopes: [{ id, kind: 'function' | 'event', x, y }]       sub-áreas (posição local à área do arquivo)
//   nodes:  [{ id, type, scopeId, x, y, fields, defaults, dynIn, dynOut, pinLabels, rerouteKind }]
//   wires:  [{ id, kind: 'flow' | 'data', from: { node, pin }, to: { node, pin } }]
// }
// Nó com scopeId fica em coordenadas locais da sub-área; sem scopeId, no escopo da classe.

export const EMPTY_GRAPH = Object.freeze({ scopes: [], nodes: [], wires: [] });

export function emptyGraph() {
  return { scopes: [], nodes: [], wires: [] };
}

export function readGraph(item) {
  return item?.graph ?? EMPTY_GRAPH;
}

export function createNode(defId, { x = 0, y = 0, scopeId = null } = {}) {
  const def = getDef(defId);
  const node = { id: uid('nd'), type: defId, scopeId, x, y, fields: {}, defaults: {} };
  for (const field of def?.fields ?? []) {
    if (field.default !== undefined) node.fields[field.id] = structuredClone(field.default);
  }
  if (def?.dynamicInputs) node.dynIn = def.dynamicInputs.min ?? 0;
  if (def?.params) node.params = [];
  if (def?.dynamicOutputs) node.dynOut = def.dynamicOutputs.min ?? 0;
  return node;
}

export function createScope(kind, { x = 0, y = 0 } = {}) {
  return { id: uid('sc'), kind, x, y };
}

// Nós que abrem uma sub-área ao serem criados (eventos e entrada de função).
export function opensScope(def) {
  return def?.template === 'event';
}

// ---------- pinos ----------

function withOverrides(pin, node) {
  const label = node.pinLabels?.[pin.id];
  return label !== undefined ? { ...pin, label } : pin;
}

// Expande pinos dinâmicos: os pinos-modelo aparecem `count` vezes (ids pin, pin#1, pin#2…).
function expand(pins, dynamic, count, node) {
  if (!dynamic) return pins.map((p) => withOverrides(p, node));
  const templates = new Set(dynamic.pins ?? []);
  const group = pins.filter((p) => templates.has(p.id));
  const n = count ?? dynamic.min ?? 0;
  const repeated = [];
  for (let i = 0; i < n; i++) {
    for (const pin of group) {
      const id = i === 0 ? pin.id : `${pin.id}#${i}`;
      const label = n > 1 && pin.label ? `${pin.label} ${i + 1}` : pin.label;
      repeated.push(withOverrides({ ...pin, id, label, dynamic: true }, node));
    }
  }
  const out = [];
  let inserted = false;
  for (const pin of pins) {
    if (templates.has(pin.id)) {
      if (!inserted) out.push(...repeated);
      inserted = true;
    } else {
      out.push(withOverrides(pin, node));
    }
  }
  if (!inserted) out.push(...repeated);
  return out;
}

function paramPin(param) {
  const pin = { id: param.id, kind: 'data', type: param.type || 'Variant', label: param.name, dynamic: true };
  if (param.default !== undefined && param.default !== '') pin.default = param.default;
  return pin;
}

// ---------- nó Expressão ----------

const EXPRESSION_RESERVED = new Set([
  'and', 'or', 'not', 'in', 'is', 'as', 'if', 'else', 'true', 'false', 'null', 'self', 'super',
  'PI', 'TAU', 'INF', 'NAN', 'await', 'func', 'var', 'const', 'return',
]);

// Nomes livres de uma expressão (viram pinos de entrada). Ignora textos entre aspas,
// números, palavras-chave, acesso a membro (depois de ".") e chamadas de função (antes de "(").
export function expressionNames(text) {
  const clean = String(text ?? '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const names = [];
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m;
  while ((m = re.exec(clean))) {
    const name = m[0];
    const before = clean.slice(0, m.index).trimEnd();
    const after = clean.slice(m.index + name.length).trimStart();
    if (before.endsWith('.') || after.startsWith('(') || EXPRESSION_RESERVED.has(name)) continue;
    if (/^\d/.test(name) || names.includes(name)) continue;
    names.push(name);
  }
  return names;
}

// ---------- arquivos referenciados (const de caminho) ----------

// Resolve id de item do projeto → { path, category } (definido pelo editor).
let fileResolver = () => null;
export function setFileResolver(fn) {
  fileResolver = fn;
}
export function resolveFile(id) {
  return id ? fileResolver(id) : null;
}

// Resolve id de ação do Mapa de entrada → { name } (definido pelo editor).
let actionResolver = () => null;
export function setActionResolver(fn) {
  actionResolver = fn;
}
export function resolveAction(id) {
  return id ? actionResolver(id) : null;
}

// ---------- membros de outros scripts ----------

// Resolve id de script → { graph, autoload, className, base } (definido pelo editor).
let scriptResolver = () => null;
export function setScriptResolver(fn) {
  scriptResolver = fn;
}

// Tipo declarado de uma variável/constante.
export function declarationType(decl) {
  if (decl.type === 'var.path') return filePathType(decl);
  return decl.fields?.type || 'Variant';
}

// Como um membro de outro script é acessado. Retorna null se o script/membro não existe, ou
// { name, kind: 'var'|'const'|'func'|'signal', type, params, returns, prefix, targetType }:
//   prefix = nome do autoload ou da class_name (sem alvo); senão targetType = tipo do pino alvo.
export function externalMember(fileId, ref) {
  const script = fileId ? scriptResolver(fileId) : null;
  if (!script || !ref) return null;
  const { graph } = script;
  const scope = graph.scopes.find((sc) => sc.id === ref);
  let member;
  if (scope) {
    const entry = functionEntry(graph, scope.id);
    if (!entry) return null;
    member = { name: entry.fields?.name || '?', kind: 'func', params: entry.params ?? [], returns: entry.fields?.returnType || 'void', isStatic: Boolean(entry.fields?.static) };
  } else {
    const decl = graph.nodes.find((n) => n.id === ref);
    if (!decl) return null;
    if (decl.type === 'signal.declare') member = { name: decl.fields?.name || '?', kind: 'signal', params: decl.params ?? [], isStatic: false };
    else if (isVariableDeclaration(decl)) {
      const constant = decl.type === 'var.const' || decl.type === 'var.path';
      member = { name: decl.fields?.name || '?', kind: constant ? 'const' : 'var', type: declarationType(decl), isStatic: constant };
    } else return null;
  }
  if (script.autoload) member.prefix = script.autoload;
  else if (script.className && member.isStatic) member.prefix = script.className;
  else member.targetType = script.className || script.base || 'Object';
  return member;
}

const PRELOAD_TYPES = { scene: 'PackedScene', script: 'Script', resource: 'Resource', shader: 'Shader', image: 'Texture2D', audio: 'AudioStream', font: 'Font' };

// Tipo do valor de um const (arquivo): texto com o caminho ou o recurso carregado.
export function filePathType(node) {
  if (node.fields?.mode === 'path') return 'String';
  return PRELOAD_TYPES[resolveFile(node.fields?.ref)?.category] ?? 'Resource';
}

// Nó de entrada da sub-área de uma função.
export function functionEntry(graph, scopeId) {
  return graph?.nodes.find((n) => n.scopeId === scopeId && n.type === 'func.entry') ?? null;
}

// Nó de entrada de qualquer sub-área (função própria ou evento).
export function scopeEntry(graph, scopeId) {
  return graph?.nodes.find((n) => n.scopeId === scopeId && getDef(n.type)?.template === 'event') ?? null;
}

// Parâmetros da sub-área: os da função própria (node.params) ou os nativos do evento (ex.: delta).
// Retorna [{ id, name, type, default? }].
export function scopeParams(graph, scopeId) {
  const entry = scopeId ? scopeEntry(graph, scopeId) : null;
  if (!entry) return [];
  const def = getDef(entry.type);
  if (def?.params) return (entry.params ?? []).map((p) => ({ ...p, type: p.type || 'Variant' }));
  return (def?.outputs ?? []).filter((p) => p.kind === 'data').map((p) => ({ id: p.id, name: p.label || p.id, type: p.type || 'Variant' }));
}

// Pinos da instância. `graph` é necessário para nós por referência (chamar função,
// emitir sinal), cujos pinos vêm da definição referenciada.
export function nodePins(node, def = getDef(node.type), graph = null) {
  if (!def) return { inputs: [], outputs: [] };
  let inputs = expand(def.inputs ?? [], def.dynamicInputs, node.dynIn, node);
  let outputs = expand(def.outputs ?? [], def.dynamicOutputs, node.dynOut, node);
  if (def.params === 'outputs') outputs = [...outputs, ...(node.params ?? []).map(paramPin)];
  // Expressão: um pino de entrada por nome livre do texto (id estável pelo nome).
  if (def.expression) {
    inputs = [...inputs, ...expressionNames(node.fields?.expression).map((name) => ({ id: `x:${name}`, kind: 'data', type: 'Variant', label: name, dynamic: true }))];
    const type = node.fields?.type || 'Variant';
    outputs = outputs.map((p) => (p.kind === 'data' ? { ...p, type } : p));
  }
  // Nó de cena: propriedades expostas viram entradas (prop:<nome>) com o tipo do catálogo
  // (ou o tipo informado à mão em node.propTypes, para propriedades fora do catálogo).
  if (def.sceneNode) {
    const cls = node.fields?.class || 'Node';
    inputs = [...inputs, ...(node.props ?? []).map((name) => ({ id: `prop:${name}`, kind: 'data', type: node.propTypes?.[name] ?? classPropertyType(cls, name), label: name, dynamic: true }))];
    // "nó" = referência a este nó, com o tipo da classe, na linha do cabeçalho (header);
    // instância de cena não recebe filhos; sinais expostos viram saídas sig:<nome>.
    outputs = outputs.map((p) => (p.id === 'self' ? { ...p, type: cls, header: true } : p));
    if (node.fields?.instance) outputs = outputs.filter((p) => p.id !== 'children');
    outputs = [...outputs, ...(node.signals ?? []).map((name) => ({ id: `sig:${name}`, kind: 'signal', label: name, dynamic: true }))];
  }
  // Membro de outro script: alvo (se não for autoload/estático), valor, argumentos e retorno.
  if (def.external) {
    const member = externalMember(node.fields?.file, node.fields?.ref);
    const target = member && !member.prefix ? [{ id: 'target', kind: 'data', type: member.targetType, label: 'alvo' }] : [];
    const flow = inputs.filter((p) => p.kind === 'flow');
    const data = inputs.filter((p) => p.kind !== 'flow');
    if (def.external === 'get') outputs = outputs.map((p) => ({ ...p, type: member?.type ?? 'Variant' }));
    if (def.external === 'set') inputs = [...flow, ...target, ...data.map((p) => ({ ...p, type: member?.type ?? 'Variant' }))];
    else if (def.external === 'call' || def.external === 'emit') {
      inputs = [...flow, ...target, ...(member?.params ?? []).map(paramPin)];
      if (def.external === 'call' && member?.returns && member.returns !== 'void') outputs = [...outputs, { id: 'result', kind: 'data', type: member.returns, label: '' }];
    } else inputs = [...target, ...data];
  }
  if (def.inputAction) {
    const type = node.fields?.mode === 'get_action_strength' ? 'float' : 'bool';
    outputs = outputs.map((p) => (p.kind === 'data' ? { ...p, type } : p));
  }
  if (def.filePath) {
    const type = filePathType(node);
    outputs = outputs.map((p) => (p.kind === 'data' ? { ...p, type } : p));
  }
  // Entrada de função/evento: só o fluxo; parâmetros são lidos pelo nó "ler parâmetro".
  if (def.template === 'event') outputs = outputs.filter((p) => p.kind === 'flow');
  // return: o valor tem o tipo de retorno da função (declarado na entrada, `-> int`);
  // em função void (ou evento) o return não leva valor.
  if (def.returns && graph) {
    const entry = scopeEntry(graph, node.scopeId);
    const returns = entry?.type === 'func.entry' ? entry.fields?.returnType || 'Variant' : 'void';
    inputs = returns === 'void' ? inputs.filter((p) => p.kind === 'flow') : inputs.map((p) => (p.kind === 'data' ? { ...p, type: returns } : p));
  }
  if (def.ref === 'param' && graph) {
    const param = scopeParams(graph, node.scopeId).find((p) => p.id === node.fields?.ref);
    outputs = outputs.map((p) => ({ ...p, type: param?.type ?? p.type }));
  }
  if (def.ref === 'function' && graph) {
    const entry = functionEntry(graph, node.fields?.ref);
    inputs = [...inputs, ...(entry?.params ?? []).map(paramPin)];
    const returns = entry?.fields?.returnType;
    if (returns && returns !== 'void') outputs = [...outputs, { id: 'result', kind: 'data', type: returns, label: '' }];
  }
  if (def.ref === 'signal' && graph) {
    const decl = graph.nodes.find((n) => n.id === node.fields?.ref);
    inputs = [...inputs, ...(decl?.params ?? []).map(paramPin)];
  }
  if (node.type === 'core.reroute') {
    const kind = node.rerouteKind ?? 'data';
    inputs = inputs.map((p) => ({ ...p, kind }));
    outputs = outputs.map((p) => ({ ...p, kind }));
  }
  return { inputs, outputs };
}

export function findPin(node, pinId, side, graph = null) {
  const pins = nodePins(node, getDef(node.type), graph);
  return (side === 'in' ? pins.inputs : pins.outputs).find((p) => p.id === pinId) ?? null;
}

// ---------- tipos genéricos ($T) ----------

// Resolve $T de cada nó: tipo declarado, declaração referenciada ou primeiro fio conectado.
export function resolveTypes(graph) {
  const types = new Map();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const raw = (node, pinId, side) => findPin(node, pinId, side, graph)?.type;

  for (let iteration = 0; iteration < 8; iteration++) {
    let changed = false;
    const set = (id, type) => {
      if (type && type !== '$T' && !types.has(id)) {
        types.set(id, type);
        changed = true;
      }
    };
    for (const node of graph.nodes) {
      const def = getDef(node.type);
      if (!def?.generics) continue;
      if (node.fields?.type) set(node.id, node.fields.type);
      if (node.fields?.ref) {
        const decl = byId.get(node.fields.ref);
        if (decl) set(node.id, decl.fields?.type || types.get(decl.id));
      }
    }
    for (const wire of graph.wires) {
      if (wire.kind !== 'data') continue;
      const a = byId.get(wire.from.node);
      const b = byId.get(wire.to.node);
      if (!a || !b) continue;
      const ta = raw(a, wire.from.pin, 'out');
      const tb = raw(b, wire.to.pin, 'in');
      const ra = ta === '$T' ? types.get(a.id) : ta;
      const rb = tb === '$T' ? types.get(b.id) : tb;
      if (ta === '$T' && rb) set(a.id, rb);
      if (tb === '$T' && ra) set(b.id, ra);
    }
    if (!changed) break;
  }
  return types;
}

export function pinType(node, pin, types) {
  return pin.type === '$T' ? types.get(node.id) ?? '$T' : pin.type;
}

// ---------- conexões ----------

// from: { node, pin } (saída) · to: { node, pin } (entrada)
// Retorna { ok, reason } — reason: self | scope | kind | type | missing
export function canConnect(graph, from, to, { strict = true, types = resolveTypes(graph) } = {}) {
  if (from.node === to.node) return { ok: false, reason: 'self' };
  const a = graph.nodes.find((n) => n.id === from.node);
  const b = graph.nodes.find((n) => n.id === to.node);
  const out = a && findPin(a, from.pin, 'out', graph);
  const inp = b && findPin(b, to.pin, 'in', graph);
  if (!out || !inp) return { ok: false, reason: 'missing' };
  if ((a.scopeId ?? null) !== (b.scopeId ?? null)) return { ok: false, reason: 'scope' };
  if (out.kind !== inp.kind) return { ok: false, reason: 'kind' };
  // Árvore da cena: o filho (to) não pode ser ancestral do pai (from).
  if (out.kind === 'tree' && treeAncestors(graph, from.node).has(to.node)) return { ok: false, reason: 'cycle' };
  if (out.kind === 'data' && strict && !typesCompatible(pinType(a, out, types), pinType(b, inp, types))) {
    return { ok: false, reason: 'type' };
  }
  return { ok: true, kind: out.kind };
}

// Saída de fluxo: 1 conexão; entrada de dado: 1 fio. Conectar de novo substitui.
// Nó pai na árvore da cena (fio 'tree': pai.children → filho.parent), ou null.
export function treeParent(graph, nodeId) {
  return graph.wires.find((w) => w.kind === 'tree' && w.to.node === nodeId)?.from.node ?? null;
}

// O próprio nó e todos os seus ancestrais na árvore da cena.
export function treeAncestors(graph, nodeId) {
  const out = new Set();
  let id = nodeId;
  while (id && !out.has(id)) {
    out.add(id);
    id = treeParent(graph, id);
  }
  return out;
}

export function connect(graph, from, to, kind) {
  graph.wires = graph.wires.filter((w) => {
    if (kind === 'flow' && w.kind === 'flow' && w.from.node === from.node && w.from.pin === from.pin) return false;
    if (kind === 'data' && w.kind === 'data' && w.to.node === to.node && w.to.pin === to.pin) return false;
    // Cada nó de cena tem um só pai.
    if (kind === 'tree' && w.kind === 'tree' && w.to.node === to.node && w.to.pin === to.pin) return false;
    return true;
  });
  const wire = { id: uid('wr'), kind, from: { ...from }, to: { ...to } };
  graph.wires.push(wire);
  return wire;
}

export function removeNodes(graph, ids) {
  const set = new Set(ids);
  graph.nodes = graph.nodes.filter((n) => !set.has(n.id));
  graph.wires = graph.wires.filter((w) => !set.has(w.from.node) && !set.has(w.to.node));
}

// Remove um reroute religando quem entrava nele a quem saía dele.
export function removeReroute(graph, nodeId) {
  const incoming = graph.wires.filter((w) => w.to.node === nodeId);
  const outgoing = graph.wires.filter((w) => w.from.node === nodeId);
  removeNodes(graph, [nodeId]);
  for (const a of incoming) {
    for (const b of outgoing) connect(graph, a.from, b.to, a.kind);
  }
}

export function removeScopes(graph, ids) {
  const set = new Set(ids);
  removeNodes(graph, graph.nodes.filter((n) => set.has(n.scopeId)).map((n) => n.id));
  graph.scopes = graph.scopes.filter((s) => !set.has(s.id));
}

// Remove fios cujos pinos deixaram de existir (ex.: pino dinâmico removido).
export function pruneWires(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  graph.wires = graph.wires.filter((w) => {
    const a = byId.get(w.from.node);
    const b = byId.get(w.to.node);
    return a && b && findPin(a, w.from.pin, 'out', graph) && findPin(b, w.to.pin, 'in', graph);
  });
}

// Declarações de variável visíveis para um nó (classe + locais da mesma sub-área).
export function variableDeclarations(graph, scopeId) {
  return graph.nodes.filter((n) => {
    if (n.type === 'var.member' || n.type === 'var.const' || n.type === 'var.path') return true;
    return n.type === 'var.local' && (n.scopeId ?? null) === (scopeId ?? null);
  });
}

export function isVariableDeclaration(node) {
  return ['var.member', 'var.const', 'var.local', 'var.path'].includes(node?.type);
}
