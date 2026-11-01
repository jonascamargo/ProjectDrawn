import { uid } from '../core/ids.js';
import { createNode, createScope, emptyGraph, expressionNames, nodePins } from '../core/graph.js';
import { currentProfile } from '../lang/profileLoader.js';
import { getDef } from '../lang/nodeRegistry.js';

// .gdshader → nós (híbrido, como o GDScript): declarações, funções, atribuições, if/for/while
// e chamadas simples viram nós; contas compostas viram Expressão (nomes conhecidos ligados aos
// pinos); o que não for reconhecido vira nó Instrução com o texto + aviso.

const STEP_X = 300;
const DATA_DX = 230;
const DATA_DY = 70;
const BINARY = { '+': 'op.add', '-': 'op.sub', '*': 'op.mul', '/': 'op.div', '%': 'op.mod', '==': 'op.eq', '!=': 'op.neq', '<': 'op.lt', '<=': 'op.lte', '>': 'op.gt', '>=': 'op.gte', '&&': 'op.and', '||': 'op.or' };
const LOGIC = new Set(['==', '!=', '<', '<=', '>', '>=', '&&', '||']);
const PRECEDENCE = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
const PRECISION = new Set(['lowp', 'mediump', 'highp']);
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=']);
const EVENTS = { vertex: 'sh.vertex', fragment: 'sh.fragment', light: 'sh.light' };
const VECTORS = { vec2: 2, vec3: 3, vec4: 4 };

export function parseShader(source) {
  const types = new Set([...(currentProfile()?.types ?? []).map((t) => t.id), 'void']);
  let items;
  try {
    items = new Parser(source, types).program();
  } catch (error) {
    return { graph: null, warnings: [{ nodeId: null, message: 'shader.warn.parse', params: { error: error.message } }] };
  }
  return new Builder().build(items);
}

// ---------- tokens ----------

const OPS = ['<<=', '>>=', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '++', '--', '<<', '>>'];

function tokenize(src) {
  const tokens = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      line += (src.slice(i, stop).match(/\n/g) ?? []).length;
      i = stop;
      continue;
    }
    const rest = src.slice(i, i + 64);
    if (c === '#') {
      const s = i;
      while (i < src.length && src[i] !== '\n') i++;
      tokens.push({ t: 'pre', v: src.slice(s, i), s, e: i, line });
      continue;
    }
    let m = /^(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?[uUfF]?/.exec(rest);
    if (m && (/\d/.test(c) || /\d/.test(src[i + 1] ?? ''))) {
      tokens.push({ t: 'num', v: m[0], s: i, e: i + m[0].length, line });
      i += m[0].length;
      continue;
    }
    m = /^[A-Za-z_]\w*/.exec(rest);
    if (m) {
      tokens.push({ t: 'id', v: m[0], s: i, e: i + m[0].length, line });
      i += m[0].length;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      tokens.push({ t: 'str', v: src.slice(i, j + 1), s: i, e: j + 1, line });
      i = j + 1;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i)) ?? c;
    tokens.push({ t: 'op', v: op, s: i, e: i + op.length, line });
    i += op.length;
  }
  return tokens;
}

// ---------- análise ----------

class Parser {
  constructor(src, types) {
    this.src = src;
    this.types = types;
    this.toks = tokenize(src);
    this.i = 0;
  }

  peek(k = 0) {
    return this.toks[this.i + k];
  }

  next() {
    const t = this.toks[this.i++];
    if (!t) throw new SyntaxError('fim inesperado');
    return t;
  }

  is(v, k = 0) {
    return this.peek(k)?.v === v;
  }

  eat(v) {
    return this.is(v) ? this.next() : null;
  }

  expect(v) {
    const t = this.eat(v);
    if (!t) throw new SyntaxError(`esperado "${v}" (linha ${this.peek()?.line ?? '?'})`);
    return t;
  }

  text(s, e) {
    return this.src.slice(s, e).replace(/\s+/g, ' ').trim();
  }

  // Pula até o ";" (ou o fim do bloco { } da instrução); não consome o "}" de quem chamou.
  skipStatement() {
    const start = this.peek()?.s ?? this.src.length;
    let end = start;
    let depth = 0;
    while (this.peek()) {
      const t = this.peek();
      if (')]}'.includes(t.v) && depth === 0) break;
      this.i++;
      end = t.e;
      if ('([{'.includes(t.v)) depth++;
      else if (')]}'.includes(t.v)) {
        depth--;
        if (depth === 0 && t.v === '}' && !this.is(';') && !this.is('else')) break;
      } else if (t.v === ';' && depth === 0) break;
      else if (t.t === 'pre' && depth === 0) break;
    }
    if (end === start && this.peek()) this.i++;
    return { start, end };
  }

  raw(startIndex) {
    this.i = startIndex;
    const r = this.skipStatement();
    return { k: 'raw', text: this.text(r.start, r.end).replace(/;$/, ''), line: this.toks[startIndex]?.line };
  }

  program() {
    const items = [];
    while (this.peek()) {
      const start = this.i;
      try {
        items.push(this.top());
      } catch {
        items.push(this.raw(start));
      }
    }
    return items;
  }

  top() {
    const t = this.peek();
    const line = t.line;
    if (t.t === 'pre') {
      this.next();
      return { k: 'raw', text: t.v, line };
    }
    if (this.eat('shader_type')) {
      const v = this.next().v;
      this.expect(';');
      return { k: 'type', value: v, line };
    }
    if (this.eat('render_mode')) {
      const s = this.peek().s;
      while (!this.is(';')) this.next();
      const e = this.peek().s;
      this.next();
      return { k: 'render', value: this.text(s, e), line };
    }
    let q = null;
    if (this.is('global') || this.is('instance')) {
      q = `${this.next().v} uniform`;
      this.expect('uniform');
    } else if (this.eat('uniform')) q = 'uniform';
    else if (this.eat('varying')) {
      q = 'varying';
      if (this.is('flat') || this.is('smooth')) this.next();
    } else if (this.eat('const')) q = 'const';
    while (PRECISION.has(this.peek()?.v)) this.next();
    const type = this.next();
    const name = this.next();
    if (type.t !== 'id' || name.t !== 'id') throw new SyntaxError('declaração');
    if (!q && this.is('(')) return this.func(type.v, name.v, line);
    if (!q || this.is('[')) throw new SyntaxError('declaração');
    let hint = '';
    if (this.eat(':')) {
      const s = this.peek().s;
      let depth = 0;
      while (this.peek() && !(depth === 0 && (this.is('=') || this.is(';')))) {
        const x = this.next();
        if (x.v === '(') depth++;
        else if (x.v === ')') depth--;
      }
      hint = this.text(s, this.peek().s);
    }
    const value = this.eat('=') ? this.expr() : null;
    this.expect(';');
    return { k: 'decl', q, type: type.v, name: name.v, hint, value, line };
  }

  func(ret, name, line) {
    this.expect('(');
    const params = [];
    while (!this.is(')')) {
      while (['in', 'out', 'inout', 'const'].includes(this.peek()?.v) || PRECISION.has(this.peek()?.v)) this.next();
      const type = this.next().v;
      const pname = this.next().v;
      params.push({ name: pname, type });
      if (!this.eat(',')) break;
    }
    this.expect(')');
    return { k: 'func', ret, name, params, body: this.block(), line };
  }

  block() {
    this.expect('{');
    const out = [];
    while (!this.is('}')) {
      if (!this.peek()) throw new SyntaxError('falta "}"');
      out.push(...this.safe());
    }
    this.expect('}');
    return out;
  }

  safe() {
    const start = this.i;
    try {
      return this.statement();
    } catch {
      return [this.raw(start)];
    }
  }

  body() {
    return this.is('{') ? this.block() : this.safe();
  }

  statement() {
    const t = this.peek();
    const line = t.line;
    if (t.t === 'pre') {
      this.next();
      return [{ k: 'raw', text: t.v, line }];
    }
    if (t.v === '{') return this.block();
    if (this.eat('if')) {
      this.expect('(');
      const c = this.expr();
      this.expect(')');
      const body = this.body();
      const orelse = this.eat('else') ? this.body() : null;
      return [{ k: 'if', c, body, orelse, line }];
    }
    if (this.eat('while')) {
      this.expect('(');
      const c = this.expr();
      this.expect(')');
      return [{ k: 'while', c, body: this.body(), line }];
    }
    if (this.is('for')) return [this.forStatement()];
    if (this.eat('return')) {
      const v = this.is(';') ? null : this.expr();
      this.expect(';');
      return [{ k: 'return', v, line }];
    }
    for (const kw of ['discard', 'break', 'continue']) {
      if (this.eat(kw)) {
        this.expect(';');
        return [{ k: kw, line }];
      }
    }
    // Declaração local: [const] [precisão] TIPO nome [= valor] (, nome [= valor])*;
    const save = this.i;
    const isConst = Boolean(this.eat('const'));
    while (PRECISION.has(this.peek()?.v)) this.next();
    if (this.peek()?.t === 'id' && this.peek(1)?.t === 'id' && this.types.has(this.peek().v)) {
      const type = this.next().v;
      const out = [];
      do {
        const name = this.next().v;
        if (this.is('[')) throw new SyntaxError('array');
        out.push({ k: 'local', type, name, value: this.eat('=') ? this.expr() : null, isConst, line });
      } while (this.eat(','));
      this.expect(';');
      return out;
    }
    this.i = save;
    const s = this.peek().s;
    const target = this.expr();
    const op = this.peek();
    if (op && ASSIGN.has(op.v)) {
      this.next();
      const value = this.expr();
      const e = this.peek()?.s ?? this.src.length;
      this.expect(';');
      return [{ k: 'assign', target, op: op.v, value, text: this.text(s, e), line }];
    }
    const e = this.peek()?.s ?? this.src.length;
    this.expect(';');
    return [{ k: 'expr', expr: target, text: this.text(s, e), line }];
  }

  // for (int i = A; i < B; i++ | ++i | i += S) — outro formato vira texto.
  forStatement() {
    const line = this.next().line;
    this.expect('(');
    this.eat('int');
    const v = this.next();
    this.expect('=');
    const a = this.expr();
    this.expect(';');
    if (this.next().v !== v.v) throw new SyntaxError('for');
    this.expect('<');
    const b = this.expr();
    this.expect(';');
    let step = null;
    if (this.eat('++')) {
      if (this.next().v !== v.v) throw new SyntaxError('for');
    } else {
      if (this.next().v !== v.v) throw new SyntaxError('for');
      if (!this.eat('++')) {
        this.expect('+=');
        step = this.expr();
      }
    }
    this.expect(')');
    return { k: 'for', v: v.v, a, b, step, body: this.body(), line };
  }

  // ---------- expressões (Pratt) ----------

  expr(min = 0) {
    let left = this.unary();
    for (;;) {
      const op = this.peek();
      if (min === 0 && op?.v === '?') {
        this.next();
        const a = this.expr();
        this.expect(':');
        const b = this.expr();
        left = { t: 'ternary', c: left, a, b, s: left.s, e: b.e };
        continue;
      }
      const prec = op?.t === 'op' ? PRECEDENCE[op.v] : undefined;
      if (!prec || prec <= min) break;
      this.next();
      const right = this.expr(prec);
      left = { t: 'binary', op: op.v, a: left, b: right, s: left.s, e: right.e };
    }
    return this.src_(left);
  }

  unary() {
    const t = this.peek();
    if (t && (t.v === '-' || t.v === '!' || t.v === '+')) {
      this.next();
      const arg = this.unary();
      return this.src_({ t: 'unary', op: t.v, arg, s: t.s, e: arg.e });
    }
    return this.postfix(this.primary());
  }

  primary() {
    const t = this.next();
    if (t.t === 'num') return this.src_({ t: 'num', s: t.s, e: t.e });
    if (t.t === 'id') {
      if (this.is('(')) {
        this.next();
        const args = [];
        while (!this.is(')')) {
          args.push(this.expr());
          if (!this.eat(',')) break;
        }
        const close = this.expect(')');
        return this.src_({ t: 'call', name: t.v, args, s: t.s, e: close.e });
      }
      return this.src_({ t: 'name', name: t.v, s: t.s, e: t.e });
    }
    if (t.v === '(') {
      const inner = this.expr();
      const close = this.expect(')');
      return this.src_({ t: 'paren', inner, s: t.s, e: close.e });
    }
    throw new SyntaxError(`expressão (linha ${t.line})`);
  }

  postfix(node) {
    for (;;) {
      if (this.is('.')) {
        this.next();
        const name = this.next();
        node = this.src_({ t: 'member', obj: node, name: name.v, s: node.s, e: name.e });
      } else if (this.is('[')) {
        this.next();
        const index = this.expr();
        const close = this.expect(']');
        node = this.src_({ t: 'index', obj: node, index, s: node.s, e: close.e });
      } else if (this.is('++') || this.is('--')) {
        throw new SyntaxError('++/--');
      } else return node;
    }
  }

  src_(node) {
    node.src = this.src.slice(node.s, node.e).replace(/\s+/g, ' ').trim();
    return node;
  }
}

// ---------- nós ----------

class Builder {
  constructor() {
    this.graph = emptyGraph();
    this.warnings = [];
    this.members = new Map();
    this.consts = new Set();
    this.functions = new Map();
    this.table = currentProfile()?.builtins ?? {};
    this.kind = 'canvas_item';
  }

  build(items) {
    let y = 0;
    const funcs = [];
    for (const item of items) {
      if (item.k === 'func') {
        funcs.push(item);
        continue;
      }
      y = this.top(item, y);
    }
    const bodies = [];
    for (const fn of funcs) {
      const scope = createScope('function', { x: 520, y: 0 });
      this.graph.scopes.push(scope);
      bodies.push({ fn, scope, ...this.entry(fn, scope) });
    }
    let scopeY = 0;
    for (const { fn, scope, entry, names } of bodies) {
      scope.y = scopeY;
      this.maxY = 0;
      const ctx = { scopeId: scope.id, names, fn: fn.name };
      this.block(fn.body, ctx, { node: entry.id, pin: 'out' }, STEP_X, 0);
      scopeY += Math.max(this.maxY, 60) + 200;
    }
    return { graph: this.graph, warnings: this.warnings };
  }

  add(type, x, y, scopeId, fields = {}) {
    const node = createNode(type, { x: Math.round(x), y: Math.round(y), scopeId });
    Object.assign(node.fields, fields);
    this.graph.nodes.push(node);
    this.maxY = Math.max(this.maxY ?? 0, y);
    return node;
  }

  wire(from, to, kind = 'data') {
    if (from) this.graph.wires.push({ id: uid('wr'), kind, from: { node: from.node, pin: from.pin }, to: { node: to.node, pin: to.pin } });
  }

  warn(node, message, params = {}) {
    this.warnings.push({ nodeId: node?.id ?? null, message, params });
  }

  statementNode(text, line, ctx, x, y, message = 'import.warn.statement') {
    const node = this.add('misc.statement', x, y, ctx.scopeId, { expression: text });
    this.bindNames(node, text, ctx, x, y);
    this.warn(node, message, { line, text });
    return node;
  }

  top(item, y) {
    const ctx = { scopeId: null, names: new Map(), fn: null };
    if (item.k === 'type') {
      this.kind = item.value;
      this.add('sh.type', 0, y, null, { type: item.value });
    } else if (item.k === 'render') {
      this.add('sh.render_mode', 0, y, null, { modes: item.value });
    } else if (item.k === 'decl') {
      const node = item.q === 'const'
        ? this.add('var.const', 0, y, null, { name: item.name, type: item.type })
        : this.add('var.member', 0, y, null, { qualifier: item.q, name: item.name, type: item.type, hint: item.hint });
      if (item.value) this.input(node, 'value', item.value, ctx, -DATA_DX, y);
      this.members.set(item.name, node.id);
      if (item.q === 'const') this.consts.add(node.id);
    } else {
      this.statementNode(item.text, item.line, ctx, 0, y);
    }
    return Math.max(this.maxY ?? 0, y) + 90;
  }

  entry(fn, scope) {
    const names = new Map();
    let entry;
    if (EVENTS[fn.name] && !fn.params.length && fn.ret === 'void') {
      scope.kind = 'event';
      entry = createNode(EVENTS[fn.name], { scopeId: scope.id });
    } else {
      entry = createNode('func.entry', { scopeId: scope.id });
      Object.assign(entry.fields, { name: fn.name, returnType: fn.ret });
      entry.params = fn.params.map((p) => ({ id: uid('p'), name: p.name, type: p.type }));
      entry.params.forEach((p) => names.set(p.name, { kind: 'param', ref: p.id }));
      this.functions.set(fn.name, { scopeId: scope.id, params: entry.params.map((p) => p.id) });
    }
    this.graph.nodes.push(entry);
    return { entry, names };
  }

  block(stmts, ctx, from, x, y) {
    for (const stmt of stmts ?? []) {
      const r = this.statement(stmt, ctx, from, x, y);
      from = r.from;
      x = r.x;
    }
    return { from, x };
  }

  link(from, node) {
    if (from) this.wire(from, { node: node.id, pin: 'in' }, 'flow');
  }

  statement(stmt, ctx, from, x, y) {
    const next = (node, pin = 'out') => ({ from: pin ? { node: node.id, pin } : null, x: x + STEP_X });
    let node;
    switch (stmt.k) {
      case 'discard':
        node = this.add('sh.discard', x, y, ctx.scopeId);
        this.link(from, node);
        return next(node, null);
      case 'break':
      case 'continue':
        node = this.add(`flow.${stmt.k}`, x, y, ctx.scopeId);
        this.link(from, node);
        return next(node, null);
      case 'return':
        node = this.add('func.return', x, y, ctx.scopeId);
        this.link(from, node);
        if (stmt.v) this.input(node, 'value', stmt.v, ctx, x - DATA_DX, y + 110);
        return next(node, null);
      case 'local':
        node = this.add('var.local', x, y, ctx.scopeId, { name: stmt.name, type: stmt.type });
        this.link(from, node);
        if (stmt.value) this.input(node, 'value', stmt.value, ctx, x - DATA_DX, y + 110);
        ctx.names.set(stmt.name, { kind: 'var', ref: node.id });
        return next(node);
      case 'assign': {
        const target = stmt.target.t === 'name' ? this.lookup(stmt.target.name, ctx) : null;
        if (target?.kind === 'var' && !this.consts.has(target.ref)) {
          node = this.add('var.set', x, y, ctx.scopeId, { ref: target.ref, operator: stmt.op });
        } else if (target?.kind === 'builtin' && target.mode !== 'in' && stmt.op !== '%=') {
          node = this.add('sh.out', x, y, ctx.scopeId, { name: target.name, type: target.type, operator: stmt.op });
        } else {
          node = this.statementNode(stmt.text, stmt.line, ctx, x, y, 'import.warn.assign');
          this.link(from, node);
          return next(node);
        }
        this.link(from, node);
        this.input(node, 'value', stmt.value, ctx, x - DATA_DX, y + 110);
        return next(node);
      }
      case 'expr': {
        const fn = stmt.expr.t === 'call' ? this.functions.get(stmt.expr.name) : null;
        if (fn) {
          node = this.add('func.call', x, y, ctx.scopeId, { ref: fn.scopeId });
          stmt.expr.args.forEach((arg, i) => fn.params[i] && this.input(node, fn.params[i], arg, ctx, x - DATA_DX, y + 110 + i * DATA_DY));
        } else node = this.statementNode(stmt.text, stmt.line, ctx, x, y, 'import.warn.call');
        this.link(from, node);
        return next(node);
      }
      case 'if': {
        node = this.add('flow.if', x, y, ctx.scopeId);
        this.link(from, node);
        this.input(node, 'condition', stmt.c, ctx, x - DATA_DX, y + 150);
        const top = this.maxY;
        const yes = this.block(stmt.body, child(ctx), { node: node.id, pin: 'true' }, x + STEP_X, y);
        let end = yes.x;
        if (stmt.orelse?.length) {
          const no = this.block(stmt.orelse, child(ctx), { node: node.id, pin: 'false' }, x + STEP_X, Math.max(this.maxY, top) + 180);
          end = Math.max(end, no.x);
        }
        return { from: { node: node.id, pin: 'then' }, x: Math.max(end, x + STEP_X) };
      }
      case 'while': {
        node = this.add('flow.while', x, y, ctx.scopeId);
        this.link(from, node);
        this.input(node, 'condition', stmt.c, ctx, x - DATA_DX, y + 130);
        const body = this.block(stmt.body, child(ctx), { node: node.id, pin: 'body' }, x + STEP_X, y);
        return { from: { node: node.id, pin: 'completed' }, x: Math.max(body.x, x + STEP_X) };
      }
      case 'for': {
        node = this.add('flow.for_range', x, y, ctx.scopeId, { var: stmt.v });
        this.link(from, node);
        this.input(node, 'start', stmt.a, ctx, x - DATA_DX, y + 150);
        this.input(node, 'end', stmt.b, ctx, x - DATA_DX, y + 150 + DATA_DY);
        if (stmt.step) this.input(node, 'step', stmt.step, ctx, x - DATA_DX, y + 150 + 2 * DATA_DY);
        const inner = child(ctx);
        inner.names.set(stmt.v, { kind: 'pin', node: node.id, pin: 'index' });
        const body = this.block(stmt.body, inner, { node: node.id, pin: 'body' }, x + STEP_X, y);
        return { from: { node: node.id, pin: 'completed' }, x: Math.max(body.x, x + STEP_X) };
      }
      default:
        node = this.statementNode(stmt.text, stmt.line, ctx, x, y);
        this.link(from, node);
        return next(node);
    }
  }

  builtin(name, ctx) {
    const fns = ctx.fn && this.table[this.kind]?.[ctx.fn] ? this.table[this.kind][ctx.fn] : [];
    return [...fns, ...(this.table.global ?? [])].find((v) => v.name === name) ?? null;
  }

  lookup(name, ctx) {
    if (ctx.names.has(name)) return ctx.names.get(name);
    if (this.members.has(name)) return { kind: 'var', ref: this.members.get(name) };
    const b = this.builtin(name, ctx);
    return b ? { kind: 'builtin', ...b } : null;
  }

  source(entry, ctx, x, y) {
    if (entry.kind === 'pin') return { node: entry.node, pin: entry.pin };
    if (entry.kind === 'builtin') {
      if (entry.mode === 'out') return null;
      const node = this.add('sh.in', x, y, ctx.scopeId, { name: entry.name, type: entry.type });
      return { node: node.id, pin: 'value' };
    }
    const node = this.add(entry.kind === 'param' ? 'param.get' : 'var.get', x, y, ctx.scopeId, { ref: entry.ref });
    return { node: node.id, pin: 'value' };
  }

  input(node, pinId, expr, ctx, x, y) {
    const value = this.value(expr, ctx, x, y);
    if (value.literal !== undefined) node.defaults = { ...node.defaults, [pinId]: value.literal };
    else this.wire(value, { node: node.id, pin: pinId });
  }

  value(expr, ctx, x, y) {
    if (expr.t === 'paren') return this.value(expr.inner, ctx, x, y);
    if (expr.t === 'num') return { literal: expr.src };
    if (expr.t === 'name') {
      const entry = this.lookup(expr.name, ctx);
      const src = entry && this.source(entry, ctx, x, y);
      return src ?? { literal: expr.name };
    }
    if (expr.t === 'call' && expr.args.every((a) => this.isSimple(a, ctx))) {
      const def = VECTORS[expr.name] === expr.args.length ? getDef(`sh.${expr.name}`) : getDef(`sh.fn.${expr.name}`);
      const pins = def ? (def.inputs ?? []).filter((p) => p.kind === 'data').map((p) => p.id) : [];
      if (def && pins.length === expr.args.length) {
        const node = this.add(def.id, x, y, ctx.scopeId);
        expr.args.forEach((arg, i) => this.input(node, pins[i], arg, ctx, x - DATA_DX, y + i * DATA_DY));
        return { node: node.id, pin: 'out' };
      }
    }
    if (expr.t === 'member' && /^([xyzw]{1,4}|[rgba]{1,4})$/.test(expr.name) && this.isSimple(expr.obj, ctx)) {
      const node = this.add('sh.swizzle', x, y, ctx.scopeId, { components: expr.name });
      this.input(node, 'value', expr.obj, ctx, x - DATA_DX, y);
      return { node: node.id, pin: 'out' };
    }
    if (expr.t === 'binary' && BINARY[expr.op] && (LOGIC.has(expr.op) ? this.isSimple(expr.a, ctx) && this.isSimple(expr.b, ctx) : isAtomic(expr.a) && isAtomic(expr.b))) {
      const node = this.add(BINARY[expr.op], x, y, ctx.scopeId);
      this.input(node, 'a', expr.a, ctx, x - DATA_DX, y);
      this.input(node, 'b', expr.b, ctx, x - DATA_DX, y + DATA_DY);
      return { node: node.id, pin: 'out' };
    }
    if (expr.t === 'unary' && (expr.op === '!' || expr.op === '-') && this.isSimple(expr.arg, ctx)) {
      if (expr.op === '-' && expr.arg.t === 'num') return { literal: expr.src };
      const node = this.add(expr.op === '!' ? 'op.not' : 'op.neg', x, y, ctx.scopeId);
      this.input(node, 'a', expr.arg, ctx, x - DATA_DX, y);
      return { node: node.id, pin: 'out' };
    }
    const node = this.add('misc.expression', x, y, ctx.scopeId, { expression: expr.src, type: 'Variant' });
    this.bindNames(node, expr.src, ctx, x, y);
    return { node: node.id, pin: 'out' };
  }

  bindNames(node, text, ctx, x, y) {
    let row = 0;
    for (const name of expressionNames(text)) {
      const entry = this.lookup(name, ctx);
      if (!entry) continue;
      const src = this.source(entry, ctx, x - DATA_DX, y + row * DATA_DY);
      if (!src) continue;
      row++;
      this.wire(src, { node: node.id, pin: `x:${name}` });
    }
  }

  isSimple(expr, ctx) {
    if (isAtomic(expr)) return true;
    if (expr.t === 'paren') return this.isSimple(expr.inner, ctx);
    if (expr.t === 'unary') return (expr.op === '!' || expr.op === '-') && this.isSimple(expr.arg, ctx);
    if (expr.t === 'member') return /^([xyzw]{1,4}|[rgba]{1,4})$/.test(expr.name) && this.isSimple(expr.obj, ctx);
    if (expr.t === 'binary' && LOGIC.has(expr.op)) return this.isSimple(expr.a, ctx) && this.isSimple(expr.b, ctx);
    if (expr.t === 'binary' && BINARY[expr.op]) return isAtomic(expr.a) && isAtomic(expr.b);
    if (expr.t === 'call') {
      const def = VECTORS[expr.name] === expr.args.length ? getDef(`sh.${expr.name}`) : getDef(`sh.fn.${expr.name}`);
      return Boolean(def) && (def.inputs ?? []).filter((p) => p.kind === 'data').length === expr.args.length && expr.args.every((a) => this.isSimple(a, ctx));
    }
    return false;
  }
}

function child(ctx) {
  return { ...ctx, names: new Map(ctx.names) };
}

function isAtomic(expr) {
  return expr.t === 'num' || expr.t === 'name' || (expr.t === 'unary' && expr.op === '-' && expr.arg.t === 'num');
}
