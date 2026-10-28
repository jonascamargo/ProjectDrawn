import { uid } from '../core/ids.js';
import { createNode, createScope, emptyGraph, expressionNames, nodePins } from '../core/graph.js';
import { currentProfile } from '../lang/profileLoader.js';
import { getDef } from '../lang/nodeRegistry.js';
import { parseGDScript } from './gdscriptParser.js';

// GDScript → grafo de nós (modo híbrido):
//   - variáveis, parâmetros e variáveis de laço viram nós de leitura ligados por fio;
//   - literais vão para o valor padrão do pino; nomes desconhecidos ficam como texto;
//   - chamadas de funções nativas, comparações/lógica e contas de um operador viram nós;
//   - o resto vira nó Expressão (valor) ou Instrução (linha no fluxo), com aviso.
// buildGraph(source, { resolvePath(res://…) → itemId|null }) → { graph, warnings }
//   warnings: [{ nodeId?, message (chave i18n), params }]

const STEP_X = 300;
const DATA_DX = 230;
const DATA_DY = 70;

const BINARY = {
  '==': 'op.eq', '!=': 'op.neq', '<': 'op.lt', '<=': 'op.lte', '>': 'op.gt', '>=': 'op.gte',
  and: 'op.and', or: 'op.or', in: 'op.in',
  '+': 'op.add', '-': 'op.sub', '*': 'op.mul', '/': 'op.div', '%': 'op.mod', '**': 'op.pow',
  '&': 'op.bit_and', '|': 'op.bit_or', '^': 'op.bit_xor', '<<': 'op.shl', '>>': 'op.shr',
};
const LOGIC = new Set(['==', '!=', '<', '<=', '>', '>=', 'and', 'or', 'in']);
const LITERALS = new Set(['num', 'str', 'bool', 'null']);

export function buildGraph(source, { resolvePath = () => null } = {}) {
  return new Builder(resolvePath).build(source);
}

class Builder {
  constructor(resolvePath) {
    this.resolvePath = resolvePath;
    this.graph = emptyGraph();
    this.warnings = [];
    this.members = new Map(); // nome → id da declaração (var/const)
    this.signals = new Map(); // nome → id do signal.declare
    this.functions = new Map(); // nome → { scopeId, params: [ids] }
  }

  build(source) {
    const { statements, errors } = parseGDScript(source);
    for (const e of errors) this.warnings.push({ message: `import.warn.${e.message}`, params: { line: e.line } });
    const funcs = statements.filter((s) => s.kind === 'func');

    // 1ª passada: declarações da classe e entradas das funções (para resolver referências).
    let y = 0;
    let pending = [];
    for (const stmt of statements) {
      if (stmt.kind === 'func') continue;
      if (stmt.kind === 'annotation') {
        pending = pending.concat(stmt.annotations);
        continue;
      }
      if (stmt.kind === 'var') stmt.annotations = [...pending, ...stmt.annotations];
      pending = [];
      y = this.declaration(stmt, y);
    }
    let scopeY = 0;
    const bodies = [];
    for (const stmt of funcs) {
      const scope = createScope('function', { x: 520, y: scopeY });
      const { entry, names } = this.entry(stmt, scope);
      this.graph.scopes.push(scope);
      bodies.push({ stmt, scope, entry, names });
      scopeY += 400; // provisório; reajustado depois do corpo
    }

    // 2ª passada: corpos das funções, empilhados de cima para baixo.
    scopeY = 0;
    for (const { stmt, scope, entry, names } of bodies) {
      scope.y = scopeY;
      this.maxY = 0;
      const ctx = { scopeId: scope.id, names };
      this.block(stmt.body, ctx, { node: entry.id, pin: 'out' }, STEP_X, 0);
      scopeY += Math.max(this.maxY, 60) + 200;
    }
    return { graph: this.graph, warnings: this.warnings };
  }

  // ---------- criação ----------

  add(type, x, y, scopeId, fields = {}) {
    const node = createNode(type, { x: Math.round(x), y: Math.round(y), scopeId });
    Object.assign(node.fields, fields);
    this.graph.nodes.push(node);
    this.maxY = Math.max(this.maxY ?? 0, y);
    return node;
  }

  wire(from, to, kind = 'data') {
    if (!from) return;
    this.graph.wires.push({ id: uid('wr'), kind, from: { node: from.node, pin: from.pin }, to: { node: to.node, pin: to.pin } });
  }

  warn(node, message, params = {}) {
    this.warnings.push({ nodeId: node?.id, message, params });
  }

  // Linha como texto (nó Instrução no fluxo, ou no escopo da classe).
  statementNode(stmt, ctx, x, y, message = 'import.warn.statement') {
    const node = this.add('misc.statement', x, y, ctx.scopeId, { expression: stmt.text });
    this.bindNames(node, stmt.text, ctx, x, y);
    this.warn(node, message, { line: stmt.line, text: stmt.text });
    return node;
  }

  // ---------- classe ----------

  declaration(stmt, y) {
    const ctx = { scopeId: null, names: new Map() };
    let node;
    switch (stmt.kind) {
      case 'extends':
        node = this.add('class.extends', 0, y, null, { base: stmt.base });
        break;
      case 'class_name':
        node = this.add('class.class_name', 0, y, null, { name: stmt.name });
        if (stmt.base) {
          y += 80;
          this.add('class.extends', 0, y, null, { base: stmt.base });
        }
        break;
      case 'signal':
        node = this.add('signal.declare', 0, y, null, { name: stmt.name });
        node.params = stmt.params.map((p) => ({ id: uid('p'), name: p.name, type: p.type || 'Variant' }));
        this.signals.set(stmt.name, node.id);
        break;
      case 'enum':
        node = this.add('class.enum', 0, y, null, { name: stmt.name, values: stmt.values });
        break;
      case 'const':
      case 'var': {
        const preload = stmt.kind === 'const' && stmt.value?.t === 'call' && stmt.value.callee.t === 'name' && stmt.value.callee.name === 'preload' && stmt.value.args[0]?.t === 'str';
        const itemId = preload ? this.resolvePath(unquote(stmt.value.args[0].raw)) : null;
        if (itemId) {
          node = this.add('var.path', 0, y, null, { name: stmt.name, ref: itemId, mode: 'preload' });
        } else {
          const type = stmt.kind === 'const' ? 'var.const' : 'var.member';
          const fields = { name: stmt.name, type: stmt.type };
          if (stmt.kind === 'var') {
            fields.export = stmt.annotations.some((a) => a.startsWith('export'));
            fields.onready = stmt.annotations.includes('onready');
          }
          node = this.add(type, 0, y, null, fields);
          if (stmt.value) this.input(node, 'value', stmt.value, ctx, -DATA_DX, y);
          const other = stmt.annotations.filter((a) => a !== 'export' && a !== 'onready');
          if (other.length || stmt.isStatic) this.warn(node, 'import.warn.annotation', { line: stmt.line, text: [...other.map((a) => `@${a}`), stmt.isStatic ? 'static' : ''].filter(Boolean).join(' ') });
          if (stmt.extra) this.warn(node, 'import.warn.accessor', { line: stmt.line, name: stmt.name });
        }
        this.members.set(stmt.name, node.id);
        break;
      }
      case 'class':
        node = this.add('class.inner', 0, y, null, { name: stmt.name, base: stmt.base });
        this.warn(node, 'import.warn.innerClass', { line: stmt.line, name: stmt.name });
        break;
      default:
        node = this.statementNode(stmt, ctx, 0, y);
    }
    return Math.max(this.maxY ?? 0, y) + 90;
  }

  // Entrada da função: evento conhecido (_ready, _process…) ou função própria.
  entry(stmt, scope) {
    const names = new Map();
    const event = (currentProfile()?.nodes ?? []).find((n) => n.template === 'event' && n.title === stmt.name && n.id !== 'func.entry');
    let entry;
    if (event) {
      scope.kind = 'event';
      entry = createNode(event.id, { scopeId: scope.id });
      const ids = (event.outputs ?? []).filter((p) => p.kind === 'data').map((p) => p.id);
      stmt.params.forEach((p, i) => ids[i] && names.set(p.name, { kind: 'param', ref: ids[i] }));
    } else {
      entry = createNode('func.entry', { scopeId: scope.id });
      Object.assign(entry.fields, { name: stmt.name, returnType: stmt.returnType || 'void', static: stmt.isStatic });
      entry.params = stmt.params.map((p) => ({ id: uid('p'), name: p.name, type: p.type || 'Variant', ...(p.default !== undefined ? { default: p.default } : {}) }));
      entry.params.forEach((p) => names.set(p.name, { kind: 'param', ref: p.id }));
      this.functions.set(stmt.name, { scopeId: scope.id, params: entry.params.map((p) => p.id) });
    }
    this.graph.nodes.push(entry);
    return { entry, names };
  }

  // ---------- corpo ----------

  // Encadeia as instruções a partir de `from` ({ node, pin } de fluxo). Retorna a última saída
  // de fluxo e a coluna seguinte.
  block(stmts, ctx, from, x, y) {
    for (const stmt of stmts ?? []) {
      const result = this.statement(stmt, ctx, from, x, y);
      from = result.from;
      x = result.x;
    }
    return { from, x };
  }

  link(from, node) {
    if (from) this.wire(from, { node: node.id, pin: 'in' }, 'flow');
  }

  statement(stmt, ctx, from, x, y) {
    const next = (node, pin = 'out') => ({ from: pin ? { node: node.id, pin } : null, x: x + STEP_X });
    let node;
    switch (stmt.kind) {
      case 'pass':
      case 'break':
      case 'continue':
        node = this.add(`flow.${stmt.kind}`, x, y, ctx.scopeId);
        this.link(from, node);
        return next(node, stmt.kind === 'pass' ? 'out' : null);
      case 'return':
        node = this.add('func.return', x, y, ctx.scopeId);
        this.link(from, node);
        if (stmt.value) this.input(node, 'value', stmt.value, ctx, x - DATA_DX, y + 110);
        return next(node, null);
      case 'var':
      case 'const': {
        node = this.add('var.local', x, y, ctx.scopeId, { name: stmt.name, type: stmt.type });
        this.link(from, node);
        if (stmt.value) this.input(node, 'value', stmt.value, ctx, x - DATA_DX, y + 110);
        ctx.names.set(stmt.name, { kind: 'var', ref: node.id });
        return next(node);
      }
      case 'assign': {
        const target = stmt.target.t === 'name' ? this.lookup(stmt.target.name, ctx) : null;
        if (target?.kind === 'var' && this.isAssignable(target.ref)) {
          node = this.add('var.set', x, y, ctx.scopeId, { ref: target.ref, operator: stmt.op });
          this.link(from, node);
          this.input(node, 'value', stmt.value, ctx, x - DATA_DX, y + 110);
          return next(node);
        }
        node = this.statementNode(stmt, ctx, x, y, 'import.warn.assign');
        this.link(from, node);
        return next(node);
      }
      case 'expr':
        node = this.callStatement(stmt, ctx, x, y);
        this.link(from, node);
        return next(node);
      case 'if':
        return this.ifStatement(stmt, ctx, from, x, y);
      case 'while': {
        node = this.add('flow.while', x, y, ctx.scopeId);
        this.link(from, node);
        this.input(node, 'condition', stmt.condition, ctx, x - DATA_DX, y + 130);
        const body = this.block(stmt.body, child(ctx), { node: node.id, pin: 'body' }, x + STEP_X, y);
        return { from: { node: node.id, pin: 'completed' }, x: Math.max(body.x, x + STEP_X) };
      }
      case 'for':
        return this.forStatement(stmt, ctx, from, x, y);
      case 'match':
        return this.matchStatement(stmt, ctx, from, x, y);
      default:
        node = this.statementNode(stmt, ctx, x, y);
        this.link(from, node);
        return next(node);
    }
  }

  ifStatement(stmt, ctx, from, x, y) {
    const node = this.add('flow.if', x, y, ctx.scopeId);
    this.link(from, node);
    this.input(node, 'condition', stmt.condition, ctx, x - DATA_DX, y + 150);
    const top = this.maxY;
    const yes = this.block(stmt.body, child(ctx), { node: node.id, pin: 'true' }, x + STEP_X, y);
    let end = yes.x;
    if (stmt.orelse?.length) {
      const elseY = Math.max(this.maxY, top) + 180;
      const no = this.block(stmt.orelse, child(ctx), { node: node.id, pin: 'false' }, x + STEP_X, elseY);
      end = Math.max(end, no.x);
    }
    return { from: { node: node.id, pin: 'then' }, x: Math.max(end, x + STEP_X) };
  }

  forStatement(stmt, ctx, from, x, y) {
    const it = stmt.iterable;
    const isRange = it.t === 'call' && it.callee.t === 'name' && it.callee.name === 'range' && it.args.length >= 1 && it.args.length <= 3;
    const node = this.add(isRange ? 'flow.for_range' : 'flow.for_each', x, y, ctx.scopeId, { var: stmt.variable });
    this.link(from, node);
    if (isRange) {
      const pins = it.args.length === 1 ? ['end'] : ['start', 'end', 'step'];
      it.args.forEach((arg, i) => this.input(node, pins[i], arg, ctx, x - DATA_DX, y + 150 + i * DATA_DY));
    } else this.input(node, 'collection', it, ctx, x - DATA_DX, y + 150);
    const inner = child(ctx);
    inner.names.set(stmt.variable, { kind: 'pin', node: node.id, pin: isRange ? 'index' : 'element' });
    const body = this.block(stmt.body, inner, { node: node.id, pin: 'body' }, x + STEP_X, y);
    return { from: { node: node.id, pin: 'completed' }, x: Math.max(body.x, x + STEP_X) };
  }

  matchStatement(stmt, ctx, from, x, y) {
    const node = this.add('flow.match', x, y, ctx.scopeId);
    this.link(from, node);
    this.input(node, 'value', stmt.value, ctx, x - DATA_DX, y + 150);
    const cases = stmt.cases.filter((c) => c.pattern !== '_');
    node.dynOut = Math.max(1, cases.length);
    node.pinLabels = {};
    let caseY = y;
    let end = x + STEP_X;
    cases.forEach((c, i) => {
      const pin = i === 0 ? 'case' : `case#${i}`;
      node.pinLabels[pin] = c.pattern;
      const body = this.block(c.body, child(ctx), { node: node.id, pin }, x + STEP_X, caseY);
      end = Math.max(end, body.x);
      caseY = this.maxY + 160;
    });
    const fallback = stmt.cases.find((c) => c.pattern === '_');
    if (fallback) {
      const body = this.block(fallback.body, child(ctx), { node: node.id, pin: 'default' }, x + STEP_X, caseY);
      end = Math.max(end, body.x);
    }
    return { from: { node: node.id, pin: 'then' }, x: end };
  }

  // Chamada como instrução: nativa com fluxo (print…), função do script, sinal.emit(), await.
  callStatement(stmt, ctx, x, y) {
    const expr = stmt.expr;
    if (expr.t === 'await') {
      const node = this.add('flow.await', x, y, ctx.scopeId);
      this.input(node, 'signal', expr.arg, ctx, x - DATA_DX, y + 110);
      return node;
    }
    if (expr.t === 'call' && expr.callee.t === 'name') {
      const name = expr.callee.name;
      const native = getDef(`native.${name}`);
      if (native && !isPure(native)) {
        const node = this.add(native.id, x, y, ctx.scopeId);
        this.args(node, native, expr.args, ctx, x, y);
        return node;
      }
      const fn = this.functions.get(name);
      if (fn) {
        const node = this.add('func.call', x, y, ctx.scopeId, { ref: fn.scopeId });
        expr.args.forEach((arg, i) => fn.params[i] && this.input(node, fn.params[i], arg, ctx, x - DATA_DX, y + 110 + i * DATA_DY));
        return node;
      }
    }
    if (expr.t === 'call' && expr.callee.t === 'member' && expr.callee.name === 'emit' && expr.callee.obj.t === 'name' && this.signals.has(expr.callee.obj.name)) {
      const declId = this.signals.get(expr.callee.obj.name);
      const decl = this.graph.nodes.find((n) => n.id === declId);
      const node = this.add('signal.emit', x, y, ctx.scopeId, { ref: declId });
      expr.args.forEach((arg, i) => decl.params[i] && this.input(node, decl.params[i].id, arg, ctx, x - DATA_DX, y + 110 + i * DATA_DY));
      return node;
    }
    return this.statementNode(stmt, ctx, x, y, 'import.warn.call');
  }

  // ---------- valores ----------

  lookup(name, ctx) {
    if (ctx.names.has(name)) return ctx.names.get(name);
    if (this.members.has(name)) return { kind: 'var', ref: this.members.get(name) };
    return null;
  }

  isAssignable(declId) {
    const decl = this.graph.nodes.find((n) => n.id === declId);
    return decl && decl.type !== 'var.const' && decl.type !== 'var.path';
  }

  // Fonte de dados de um nome conhecido: nó de leitura novo ou pino existente (variável do for).
  source(entry, ctx, x, y) {
    if (entry.kind === 'pin') return { node: entry.node, pin: entry.pin };
    const node = this.add(entry.kind === 'param' ? 'param.get' : 'var.get', x, y, ctx.scopeId, { ref: entry.ref });
    return { node: node.id, pin: 'value' };
  }

  // Liga o valor `expr` ao pino `pinId` de `node` (fio ou valor padrão).
  input(node, pinId, expr, ctx, x, y) {
    const value = this.value(expr, ctx, x, y);
    if (value.literal !== undefined) node.defaults = { ...node.defaults, [pinId]: value.literal };
    else this.wire(value, { node: node.id, pin: pinId });
  }

  // { literal } ou { node, pin } (saída de dados).
  value(expr, ctx, x, y) {
    if (LITERALS.has(expr.t)) return { literal: expr.t === 'bool' ? expr.value : expr.src };
    if (expr.t === 'name') {
      const entry = this.lookup(expr.name, ctx);
      return entry ? this.source(entry, ctx, x, y) : { literal: expr.name };
    }
    if (expr.t === 'call' && expr.callee.t === 'name') {
      const native = getDef(`native.${expr.callee.name}`);
      if (native && isPure(native) && expr.args.every((a) => this.isSimple(a))) {
        const node = this.add(native.id, x, y, ctx.scopeId);
        this.args(node, native, expr.args, ctx, x, y);
        return { node: node.id, pin: dataOut(native) };
      }
    }
    if (expr.t === 'binary' && BINARY[expr.op] && (LOGIC.has(expr.op) ? this.isSimple(expr.a) && this.isSimple(expr.b) : isAtomic(expr.a) && isAtomic(expr.b))) {
      const def = getDef(BINARY[expr.op]);
      const node = this.add(def.id, x, y, ctx.scopeId);
      this.input(node, 'a', expr.a, ctx, x - DATA_DX, y);
      this.input(node, 'b', expr.b, ctx, x - DATA_DX, y + DATA_DY);
      return { node: node.id, pin: dataOut(def) };
    }
    if (expr.t === 'unary' && (expr.op === 'not' || expr.op === '-') && this.isSimple(expr.arg)) {
      const node = this.add(expr.op === 'not' ? 'op.not' : 'op.neg', x, y, ctx.scopeId);
      this.input(node, 'a', expr.arg, ctx, x - DATA_DX, y);
      return { node: node.id, pin: 'out' };
    }
    // Composta: nó Expressão com o texto; variáveis conhecidas ligadas aos pinos dela.
    const node = this.add('misc.expression', x, y, ctx.scopeId, { expression: expr.src, type: 'Variant' });
    this.bindNames(node, expr.src, ctx, x, y);
    return { node: node.id, pin: 'out' };
  }

  // Nomes livres do texto que são variáveis/parâmetros conhecidos → fio até o pino x:<nome>.
  bindNames(node, text, ctx, x, y) {
    let row = 0;
    for (const name of expressionNames(text)) {
      const entry = this.lookup(name, ctx);
      if (!entry) continue;
      this.wire(this.source(entry, ctx, x - DATA_DX, y + row++ * DATA_DY), { node: node.id, pin: `x:${name}` });
    }
  }

  isSimple(expr) {
    if (isAtomic(expr)) return true;
    if (expr.t === 'unary') return (expr.op === 'not' || expr.op === '-') && this.isSimple(expr.arg);
    if (expr.t === 'binary' && LOGIC.has(expr.op)) return this.isSimple(expr.a) && this.isSimple(expr.b);
    if (expr.t === 'binary' && BINARY[expr.op]) return isAtomic(expr.a) && isAtomic(expr.b);
    if (expr.t === 'call' && expr.callee.t === 'name') {
      const native = getDef(`native.${expr.callee.name}`);
      return Boolean(native && isPure(native)) && expr.args.every((a) => this.isSimple(a));
    }
    return false;
  }

  // Argumentos de função nativa: posicionais, com grupo dinâmico (print(a, b, c)) e range.
  args(node, def, args, ctx, x, y) {
    if (def.dynamicInputs) {
      const fixed = (def.inputs ?? []).filter((p) => p.kind === 'data' && !def.dynamicInputs.pins.includes(p.id)).length;
      node.dynIn = Math.max(def.dynamicInputs.min ?? 0, args.length - fixed);
    }
    let pins = nodePins(node, def, this.graph).inputs.filter((p) => p.kind === 'data').map((p) => p.id);
    if (def.id === 'native.range' && args.length === 1) pins = ['end'];
    args.forEach((arg, i) => pins[i] && this.input(node, pins[i], arg, ctx, x - DATA_DX, y + 110 + i * DATA_DY));
  }
}

function child(ctx) {
  return { scopeId: ctx.scopeId, names: new Map(ctx.names) };
}

function isAtomic(expr) {
  return LITERALS.has(expr.t) || expr.t === 'name';
}

function isPure(def) {
  return ![...(def.inputs ?? []), ...(def.outputs ?? [])].some((p) => p.kind === 'flow');
}

function dataOut(def) {
  return (def.outputs ?? []).find((p) => p.kind === 'data')?.id ?? 'out';
}

function unquote(raw) {
  return raw.replace(/^[r&^]?(["'])(.*)\1$/s, '$2');
}
