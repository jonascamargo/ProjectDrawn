import { findPin, nodePins, readGraph, scopeEntry } from './graph.js';
import { formatNodeCode, inputCode, isPureDef } from './codeFormat.js';
import { getDef } from '../lang/nodeRegistry.js';
import { commentPlan } from './commentCode.js';
import { lineMap, retag, tag } from './codeLines.js';

let comments = commentPlan({ nodes: [], scopes: [] }, '//');

// Monta o .gdshader a partir do grafo (perfil shader):
//   shader_type; render_mode; → uniforms/varyings → consts → funções (vertex, fragment, light e
//   próprias, na ordem das sub-áreas), com chaves e ";". Mesmos avisos do GDScript.

const INDENT = '\t';
const CONTINUE_PINS = new Set(['out', 'then', 'completed']);

export function generateShader(item) {
  const graph = readGraph(item);
  const warnings = [];
  const lines = [];
  const visited = new Set();
  const warn = (nodeId, message, params) => warnings.push({ nodeId, message, params });
  const top = graph.nodes.filter((n) => !n.scopeId).sort(byPosition);
  comments = commentPlan(graph, '//');
  if (comments.top.length) lines.push(...comments.top, '');

  const type = top.find((n) => n.type === 'sh.type');
  if (!type) warn(null, 'shader.warn.noType');
  lines.push(tag(type?.id, `shader_type ${type?.fields?.type || 'canvas_item'};`));
  for (const node of top.filter((n) => n.type === 'sh.render_mode')) if (node.fields?.modes) lines.push(tag(node.id, `render_mode ${node.fields.modes};`));
  lines.push('');
  const raws = top.filter((n) => n.type === 'misc.statement');
  for (const node of raws) lines.push(tag(node.id, withSemicolon(String(node.fields?.expression ?? ''))));
  if (raws.length) lines.push('');
  for (const types of [['var.member'], ['var.const']]) {
    const group = top.filter((n) => types.includes(n.type));
    for (const node of group) lines.push(...comments.take(node.id), tag(node.id, `${declaration(graph, node, warn)};`));
    if (group.length) lines.push('');
  }
  for (const node of top) {
    const def = getDef(node.type);
    if (def && !['sh.type', 'sh.render_mode', 'var.member', 'var.const', 'misc.comment', 'misc.statement'].includes(node.type) && !isPureDef(def)) warn(node.id, 'export.warn.outsideFunction');
  }

  for (const scope of [...graph.scopes].sort(byPosition)) {
    const entry = scopeEntry(graph, scope.id);
    if (!entry) continue;
    const f = entry.fields ?? {};
    const header = entry.type === 'func.entry'
      ? `${f.returnType || 'void'} ${f.name || 'funcao'}(${(entry.params ?? []).map((p) => `${p.type && p.type !== 'Variant' ? p.type : 'float'} ${p.name || '?'}`).join(', ')})`
      : formatNodeCode(graph, entry);
    lines.push(...comments.take(entry.id), tag(entry.id, `${header} {`));
    block(graph, next(graph, entry, 'out'), 1, lines, visited, warn);
    lines.push(tag(entry.id, '}'), '');
  }

  for (const node of graph.nodes) {
    const def = getDef(node.type);
    if (!def) {
      warn(node.id, 'export.warn.unknownNode', { type: node.type });
      continue;
    }
    if (node.scopeId && !visited.has(node.id) && !isPureDef(def) && def.template !== 'event' && node.type !== 'misc.comment') warn(node.id, 'export.warn.unreachable');
    if ((node.type === 'var.get' || node.type === 'var.set' || def.ref) && !node.fields?.ref) warn(node.id, 'export.warn.brokenRef', { title: def.title });
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return { code: `${lines.join('\n')}\n`, warnings, lines: lineMap(graph, lines) };
}

function block(graph, node, depth, out, visited, warn) {
  const pad = INDENT.repeat(depth);
  while (node) {
    if (visited.has(node.id)) {
      warn(node.id, 'export.warn.reused');
      return;
    }
    visited.add(node.id);
    const def = getDef(node.type);
    if (node.type === 'core.reroute') {
      node = next(graph, node, 'out');
      continue;
    }
    if (node.type !== 'var.local') emptyInputs(graph, node, def, warn);
    const flowOuts = nodePins(node, def, graph).outputs.filter((p) => p.kind === 'flow');
    const blocks = flowOuts.filter((p) => !CONTINUE_PINS.has(p.id));
    // for com passo 1 sai como "i++".
    out.push(...comments.take(node.id, pad));
    const line = (node.type === 'var.local' ? declaration(graph, node, warn) : unwrap(formatNodeCode(graph, node))).replace(/; (\w+) \+= 1\)$/, '; $1++)');
    if (node.type === 'flow.if') ifChain(graph, node, line, depth, out, visited, warn);
    else if (blocks.length) {
      out.push(tag(node.id, `${pad}${line} {`));
      for (const pin of blocks) block(graph, next(graph, node, pin.id), depth + 1, out, visited, warn);
      out.push(tag(node.id, `${pad}}`));
    } else {
      out.push(tag(node.id, `${pad}${withSemicolon(line)}`));
    }
    const cont = flowOuts.find((p) => CONTINUE_PINS.has(p.id));
    node = cont ? next(graph, node, cont.id) : null;
  }
}

// if / else if / else com chaves (o senão que é só outro if vira "else if").
function ifChain(graph, node, line, depth, out, visited, warn) {
  const pad = INDENT.repeat(depth);
  out.push(tag(node.id, `${pad}${line} {`));
  block(graph, next(graph, node, 'true'), depth + 1, out, visited, warn);
  const other = next(graph, node, 'false');
  if (!other) {
    out.push(tag(node.id, `${pad}}`));
    return;
  }
  const chained = other.type === 'flow.if' && !next(graph, other, 'then') && !visited.has(other.id) && graph.wires.filter((w) => w.to.node === other.id && w.kind === 'flow').length === 1;
  if (chained) {
    visited.add(other.id);
    const lines = [];
    ifChain(graph, other, unwrap(formatNodeCode(graph, other)), depth, lines, visited, warn);
    lines[0] = retag(lines[0], `${pad}} else ${lines[0].trimStart()}`);
    out.push(...lines);
    return;
  }
  out.push(tag(node.id, `${pad}} else {`));
  block(graph, other, depth + 1, out, visited, warn);
  out.push(tag(node.id, `${pad}}`));
}

// "if ((a < b))" → "if (a < b)" (os parênteses extras vêm da expressão composta).
function unwrap(line) {
  const m = line.match(/^(if|while|return) \((\(.*\))\)$/);
  return m && balanced(m[2].slice(1, -1)) ? `${m[1]} ${m[2]}` : line.replace(/^return \((.*)\)$/, (s, inner) => (balanced(inner) ? `return ${inner}` : s));
}

function balanced(text) {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

function declaration(graph, node, warn) {
  const f = node.fields ?? {};
  const type = f.type && f.type !== 'Variant' ? f.type : 'float';
  const value = initialValue(graph, node);
  if (node.type === 'var.member') {
    const qualifier = f.qualifier || 'uniform';
    if (qualifier === 'varying') return `varying ${type} ${f.name || '?'}`;
    return `${qualifier} ${type} ${f.name || '?'}${f.hint ? ` : ${f.hint}` : ''}${value ? ` = ${value}` : ''}`;
  }
  if (node.type === 'var.const' && !value) warn(node.id, 'export.warn.constWithoutValue', { name: f.name });
  return `${node.type === 'var.const' ? 'const ' : ''}${type} ${f.name || '?'}${value ? ` = ${value}` : ''}`;
}

function initialValue(graph, node) {
  if (node.split?.value) return inputCode(graph, node, 'value');
  const pin = findPin(node, 'value', 'in', graph);
  if (!pin) return '';
  const wired = graph.wires.some((w) => w.to.node === node.id && w.to.pin === 'value');
  const typed = node.defaults?.value ?? pin.default;
  if (!wired && (typed === undefined || typed === null || typed === '')) return '';
  return inputCode(graph, node, 'value');
}

function emptyInputs(graph, node, def, warn) {
  const connected = new Set(graph.wires.filter((w) => w.to.node === node.id).map((w) => w.to.pin));
  for (const pin of nodePins(node, def, graph).inputs) {
    if (pin.kind !== 'data' || pin.id.startsWith('x:') || connected.has(pin.id)) continue;
    const value = node.defaults?.[pin.id] ?? pin.default;
    if (value === undefined || value === null || value === '') warn(node.id, 'export.warn.emptyInput', { pin: pin.label || pin.id, title: def.title });
  }
}

// ";" no fim, menos em pré-processador (#…) e em texto que já fecha um bloco.
function withSemicolon(line) {
  return line.startsWith('#') || line.endsWith('}') || line.endsWith(';') ? line : `${line};`;
}

function next(graph, node, pinId) {
  const wire = graph.wires.find((w) => w.kind === 'flow' && w.from.node === node.id && w.from.pin === pinId);
  return wire ? graph.nodes.find((n) => n.id === wire.to.node) ?? null : null;
}

function byPosition(a, b) {
  return a.y - b.y || a.x - b.x;
}
