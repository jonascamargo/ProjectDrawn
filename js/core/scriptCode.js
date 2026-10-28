import { findPin, nodePins, readGraph, scopeEntry } from './graph.js';
import { formatNodeCode, inputCode, isPureDef } from './codeFormat.js';
import { getDef } from '../lang/nodeRegistry.js';

// Monta o código .gd de um script a partir do grafo:
//   extends / class_name → sinais, enums → constantes → variáveis → funções e eventos
//   (na ordem das sub-áreas, de cima para baixo), cada corpo seguindo os fios de fluxo.
// Saídas de fluxo de continuação (out/then/completed) seguem no mesmo nível; as demais
// (verdadeiro, senão, corpo, casos) abrem um bloco indentado.
// Retorna { code, warnings: [{ nodeId, message, params? }] } — message é uma chave de i18n.

const INDENT = '\t';
const CONTINUE_PINS = new Set(['out', 'then', 'completed']);
// Grupos de declarações (linha em branco entre grupos), na ordem do GDScript.
const DECLARATION_GROUPS = [['misc.statement'], ['class.class_name', 'class.extends'], ['signal.declare'], ['class.enum'], ['var.const', 'var.path'], ['var.member'], ['class.inner']];
const DECLARATION_TYPES = DECLARATION_GROUPS.flat();

export function generateScript(item) {
  const graph = readGraph(item);
  const warnings = [];
  const lines = [];
  const visited = new Set();
  const warn = (nodeId, message, params) => warnings.push({ nodeId, message, params });

  // ---------- declarações do escopo da classe ----------
  const top = graph.nodes.filter((n) => !n.scopeId);
  for (const types of DECLARATION_GROUPS) {
    const group = types.flatMap((type) => top.filter((n) => n.type === type).sort(byPosition));
    for (const node of group) {
      lines.push(declaration(graph, node, warn));
      if (node.type === 'class.inner') lines.push(`${INDENT}pass`);
    }
    if (group.length) lines.push('');
  }
  for (const node of top) {
    const def = getDef(node.type);
    if (def && !DECLARATION_TYPES.includes(node.type) && !isPureDef(def) && node.type !== 'misc.comment') warn(node.id, 'export.warn.outsideFunction');
  }

  // ---------- funções e eventos ----------
  const scopes = [...graph.scopes].sort(byPosition);
  for (const scope of scopes) {
    const entry = scopeEntry(graph, scope.id);
    if (!entry) continue;
    let header = formatNodeCode(graph, entry);
    if (entry.type === 'func.entry') {
      if (entry.fields?.static) header = `static ${header}`;
      if (!entry.fields?.returnType || entry.fields.returnType === 'void') header = header.replace(/ -> void:$/, ':');
    }
    lines.push(header);
    const body = [];
    block(graph, next(graph, entry, 'out'), 1, body, visited, warn);
    lines.push(...(body.length ? body : [`${INDENT}pass`]), '');
  }

  // Instruções que nenhum fluxo alcança.
  for (const node of graph.nodes) {
    const def = getDef(node.type);
    if (!node.scopeId || visited.has(node.id) || !def || isPureDef(def) || def.template === 'event' || node.type === 'misc.comment') continue;
    warn(node.id, 'export.warn.unreachable');
  }
  // Referências quebradas e pinos de dado vazios em nós usados.
  for (const node of graph.nodes) {
    const def = getDef(node.type);
    if (!def) {
      warn(node.id, 'export.warn.unknownNode', { type: node.type });
      continue;
    }
    if (needsRef(node, def) && !node.fields?.ref) warn(node.id, 'export.warn.brokenRef', { title: def.title });
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return { code: `${lines.join('\n')}\n`, warnings };
}

// Corpo do if e o senão. Um senão que é só outro if (sem nada depois dele) vira elif.
function ifBranches(graph, node, depth, out, visited, warn) {
  const pad = INDENT.repeat(depth);
  const body = [];
  block(graph, next(graph, node, 'true'), depth + 1, body, visited, warn);
  out.push(...(body.length ? body : [`${pad}${INDENT}pass`]));
  const other = next(graph, node, 'false');
  if (!other) return;
  const chained = other.type === 'flow.if' && !next(graph, other, 'then') && !visited.has(other.id) && graph.wires.filter((w) => w.to.node === other.id && w.kind === 'flow').length === 1;
  if (chained) {
    visited.add(other.id);
    out.push(`${pad}el${statementLine(graph, other)}`);
    ifBranches(graph, other, depth, out, visited, warn);
    return;
  }
  out.push(`${pad}else:`);
  const rest = [];
  block(graph, other, depth + 1, rest, visited, warn);
  out.push(...(rest.length ? rest : [`${pad}${INDENT}pass`]));
}

// Linha de uma instrução, com retoques: range(0, n, 1) → range(n).
function statementLine(graph, node) {
  return unwrapCondition(formatNodeCode(graph, node)).replace(/ in range\(0, (.+), 1\):$/, ' in range($1):');
}

// "if (a <= b):" → "if a <= b:" (os parênteses vêm da expressão composta e aqui sobram).
function unwrapCondition(line) {
  const m = line.match(/^(if|elif|while|match|return) \((.*)\)(:?)$/);
  return m && balanced(m[2]) ? `${m[1]} ${m[2]}${m[3]}` : line;
}

function balanced(text) {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

function needsRef(node, def) {
  return node.type === 'var.get' || node.type === 'var.set' || Boolean(def.ref) || Boolean(def.inputAction) || Boolean(def.external) || Boolean(def.filePath);
}

function byPosition(a, b) {
  return a.y - b.y || a.x - b.x;
}

// Nó ligado à saída de fluxo `pinId` (ou null).
function next(graph, node, pinId) {
  const wire = graph.wires.find((w) => w.kind === 'flow' && w.from.node === node.id && w.from.pin === pinId);
  return wire ? graph.nodes.find((n) => n.id === wire.to.node) ?? null : null;
}

// Segue a cadeia de instruções a partir de `node`, no nível `depth`.
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
    out.push(pad + (node.type === 'var.local' ? declaration(graph, node, warn) : statementLine(graph, node)));
    if (node.type === 'flow.match') {
      // Cada caso vira "valor:" com o corpo um nível abaixo; "_" é o padrão.
      for (const pin of blocks) {
        const label = pin.id === 'default' ? '_' : node.pinLabels?.[pin.id] || pin.label || '_';
        out.push(`${pad}${INDENT}${label}:`);
        const body = [];
        block(graph, next(graph, node, pin.id), depth + 2, body, visited, warn);
        out.push(...(body.length ? body : [`${pad}${INDENT}${INDENT}pass`]));
      }
    } else if (node.type === 'flow.if') {
      ifBranches(graph, node, depth, out, visited, warn);
    } else if (blocks.length) {
      // Laços: um único corpo.
      for (const pin of blocks) {
        const body = [];
        block(graph, next(graph, node, pin.id), depth + 1, body, visited, warn);
        out.push(...(body.length ? body : [`${pad}${INDENT}pass`]));
      }
    }
    const cont = flowOuts.find((p) => CONTINUE_PINS.has(p.id));
    node = cont ? next(graph, node, cont.id) : null;
  }
}

// Pino de dado sem fio e sem valor padrão (o código mostraria só o nome do pino).
function emptyInputs(graph, node, def, warn) {
  const connected = new Set(graph.wires.filter((w) => w.to.node === node.id).map((w) => w.to.pin));
  for (const pin of nodePins(node, def, graph).inputs) {
    if (pin.kind !== 'data' || pin.id === 'target' || pin.id.startsWith('x:') || connected.has(pin.id)) continue;
    const value = node.defaults?.[pin.id] ?? pin.default;
    if (value === undefined || value === null || value === '') warn(node.id, 'export.warn.emptyInput', { pin: pin.label || pin.id, title: def.title });
  }
}

// Declarações montadas à mão: tipo e valor inicial só aparecem se existirem.
function declaration(graph, node, warn) {
  const f = node.fields ?? {};
  if (node.type === 'var.member' || node.type === 'var.const' || node.type === 'var.local') {
    const keyword = node.type === 'var.const' ? 'const' : 'var';
    const annotations = `${f.export ? '@export ' : ''}${f.onready ? '@onready ' : ''}`;
    const type = f.type && f.type !== 'Variant' ? `: ${f.type}` : '';
    const value = initialValue(graph, node);
    if (node.type === 'var.const' && !value) warn(node.id, 'export.warn.constWithoutValue', { name: f.name });
    return `${annotations}${keyword} ${f.name || '?'}${type}${value ? ` = ${value}` : ''}`;
  }
  if (node.type === 'class.enum') return `enum ${f.name || ''} { ${f.values ?? ''} }`.replace('enum  {', 'enum {');
  return formatNodeCode(graph, node);
}

// Valor inicial: fio ligado em "value" ou valor padrão digitado ('' se não houver).
function initialValue(graph, node) {
  const pin = findPin(node, 'value', 'in', graph);
  if (!pin) return '';
  const wired = graph.wires.some((w) => w.to.node === node.id && w.to.pin === 'value');
  const typed = node.defaults?.value ?? pin.default;
  if (!wired && (typed === undefined || typed === null || typed === '')) return '';
  return inputCode(graph, node, 'value');
}
