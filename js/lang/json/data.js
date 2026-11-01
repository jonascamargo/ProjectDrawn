import { uid } from '../../core/ids.js';
import { createNode, emptyGraph, nodePins, readGraph } from '../../core/graph.js';

// Adaptador JSON: nós de dados ↔ arquivo .json.
// Nós: json.root (Documento, um por arquivo), json.object (uma entrada por chave, k:<id>),
// json.array (itens), json.string/number/bool/null. Valor digitado num pino sem fio:
// 10 = número, true/false = bool, null = null, "10" (com aspas) ou outro texto = texto.

const INDENT = 2;
const COLUMN = 280;
const GAP = 24;
const ROW = 24;
const HEAD = 44;

// ---------- nós → .json ----------

export function generateJson(item) {
  const graph = readGraph(item);
  const warnings = [];
  const warn = (nodeId, message, params = {}) => warnings.push({ nodeId, message, params });
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = new Map(graph.wires.map((w) => [`${w.to.node}|${w.to.pin}`, w]));
  const used = new Set();
  const stack = new Set();

  const roots = graph.nodes.filter((n) => n.type === 'json.root');
  if (!roots.length) {
    warn(null, 'json.warn.noRoot');
    return { code: '', warnings };
  }
  for (const extra of roots.slice(1)) warn(extra.id, 'json.warn.extraRoot');

  const input = (node, pinId) => {
    const wire = incoming.get(`${node.id}|${pinId}`);
    if (wire) {
      const source = byId.get(wire.from.node);
      return source ? valueOf(source) : null;
    }
    return literal(node.defaults?.[pinId]);
  };

  function valueOf(node) {
    if (stack.has(node.id)) {
      warn(node.id, 'json.warn.cycle');
      return null;
    }
    used.add(node.id);
    stack.add(node.id);
    try {
      const f = node.fields ?? {};
      switch (node.type) {
        case 'core.reroute':
          return input(node, 'in');
        case 'json.object': {
          const out = {};
          for (const key of node.keys ?? []) {
            if (!key.name) warn(node.id, 'json.warn.emptyKey');
            else if (Object.hasOwn(out, key.name)) warn(node.id, 'json.warn.duplicateKey', { key: key.name });
            out[key.name] = input(node, `k:${key.id}`);
          }
          return out;
        }
        case 'json.array':
          return nodePins(node).inputs.filter((p) => p.kind === 'data').map((p) => input(node, p.id));
        case 'json.string':
          return String(f.value ?? '');
        case 'json.number':
          return Number(f.value) || 0;
        case 'json.bool':
          return Boolean(f.value);
        case 'json.null':
          return null;
        default:
          warn(node.id, 'json.warn.unknownNode', { type: node.type });
          return null;
      }
    } finally {
      stack.delete(node.id);
    }
  }

  used.add(roots[0].id);
  const value = input(roots[0], 'value');
  for (const node of graph.nodes) {
    if (used.has(node.id) || node.type === 'misc.comment' || node.type === 'json.root') continue;
    warn(node.id, 'json.warn.unused');
  }
  return { code: `${JSON.stringify(value, null, INDENT)}\n`, warnings };
}

// Valor digitado: número, true/false, null e texto entre aspas viram o tipo JSON; o resto é texto.
export function literal(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (text === '') return '';
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(text)) return Number(text);
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  return value;
}

// ---------- .json → nós ----------

// Objetos e listas viram nós (à esquerda de quem os usa); valores simples ficam digitados
// no pino. Retorna { graph: null } se o texto não for JSON válido.
export function parseJson(source) {
  let data;
  try {
    data = JSON.parse(source);
  } catch (error) {
    return { graph: null, warnings: [{ nodeId: null, message: 'json.warn.parse', params: { error: error.message } }] };
  }
  const graph = emptyGraph();
  const nextY = [];
  const depthOf = (value) => (isNested(value) ? 1 + Math.max(0, ...children(value).map(depthOf)) : 0);
  const maxDepth = depthOf(data);
  const root = createNode('json.root', { x: (maxDepth + 1) * COLUMN, y: 0 });
  graph.nodes.push(root);

  // Coloca o valor no pino (node, pinId): aninhado vira nó ligado; simples vira texto digitado.
  const place = (value, node, pinId, depth, y) => {
    if (!isNested(value)) {
      node.defaults[pinId] = display(value);
      return;
    }
    const child = build(value, depth, y);
    graph.wires.push({ id: uid('wr'), kind: 'data', from: { node: child.id, pin: 'out' }, to: { node: node.id, pin: pinId } });
  };

  function build(value, depth, hintY) {
    const isArray = Array.isArray(value);
    const node = createNode(isArray ? 'json.array' : 'json.object', { x: (maxDepth - depth) * COLUMN, y: 0 });
    const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
    const height = HEAD + Math.max(1, entries.length) * ROW;
    node.y = Math.max(nextY[depth] ?? 0, hintY);
    nextY[depth] = node.y + height + GAP;
    graph.nodes.push(node);
    if (isArray) node.dynIn = entries.length;
    entries.forEach(([key, v], i) => {
      let pinId;
      if (isArray) pinId = i === 0 ? 'item' : `item#${i}`;
      else {
        const id = uid('k');
        node.keys.push({ id, name: key });
        pinId = `k:${id}`;
      }
      place(v, node, pinId, depth + 1, node.y + i * ROW);
    });
    return node;
  }

  place(data, root, 'value', 0, 0);
  return { graph, warnings: [] };
}

function isNested(value) {
  return value !== null && typeof value === 'object';
}

function children(value) {
  return Array.isArray(value) ? value : Object.values(value);
}

// Texto digitado que volta ao mesmo valor (texto que parece número/bool/null leva aspas).
function display(value) {
  if (typeof value !== 'string') return JSON.stringify(value);
  return literal(value) === value ? value : JSON.stringify(value);
}
