// Analisador de GDScript (subconjunto usado para gerar o grafo).
//
// parseGDScript(text) → { statements, errors }
//   Cada instrução: { kind, line, text, ...dados, body?: [instruções] }
//   kinds: extends, class_name, signal, enum, const, var, func, class, annotation-only,
//          if (com elifs/else), for, while, match (cases), return, pass, break, continue,
//          assign, expr, unknown
//   Expressões (parseExpression): { t, src, ... } com t = num, str, bool, null, name, member,
//   call, index, array, dict, unary, binary, ternary, cast, nodepath, other.

// ---------- linhas lógicas ----------

// Junta linhas continuadas (parênteses abertos, "\" no fim, strings de várias linhas) e
// remove comentários. Retorna [{ indent, text, line }].
function logicalLines(source) {
  const raw = source.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let buffer = '';
  let start = 0;
  let indent = 0;
  let depth = 0;
  let multiline = null; // aspas de string """ aberta
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i];
    if (!buffer && !multiline) {
      if (!line.trim()) continue;
      const lead = line.match(/^[\t ]*/)[0];
      indent = lead.replace(/ {4}/g, '\t').replace(/ +/g, '\t').length;
      start = i + 1;
      line = line.slice(lead.length);
    }
    let text = '';
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (multiline) {
        if (line.startsWith(multiline, j)) {
          text += multiline;
          j += 2;
          multiline = null;
        } else text += ch;
        continue;
      }
      if (ch === '#') break;
      if (ch === '"' || ch === "'") {
        if (line.startsWith(ch.repeat(3), j)) {
          multiline = ch.repeat(3);
          text += multiline;
          j += 2;
          continue;
        }
        let k = j + 1;
        while (k < line.length && line[k] !== ch) k += line[k] === '\\' ? 2 : 1;
        text += line.slice(j, k + 1);
        j = k;
        continue;
      }
      if ('([{'.includes(ch)) depth++;
      if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      text += ch;
    }
    text = text.replace(/\s+$/, '');
    const continued = text.endsWith('\\');
    if (continued) text = text.slice(0, -1);
    buffer += (buffer ? ' ' : '') + text.trim();
    if (multiline || depth > 0 || continued) continue;
    if (buffer) out.push({ indent, text: buffer, line: start });
    buffer = '';
  }
  if (buffer) out.push({ indent, text: buffer, line: start });
  return out;
}

// ---------- tokens ----------

const OPERATORS = ['**=', '<<=', '>>=', '**', '<<', '>>', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', ':=', '->', '+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '&', '|', '^', '(', ')', '[', ']', '{', '}', ',', ':', '.', '@', '$'];

export function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const start = i;
    // Strings (com prefixos r, &, ^) e strings longas.
    const prefix = /[r&^]/.test(ch) && /["']/.test(text[i + 1] ?? '') ? 1 : 0;
    const q = text[i + prefix];
    if (q === '"' || q === "'") {
      i += prefix;
      const triple = text.startsWith(q.repeat(3), i);
      const end = triple ? q.repeat(3) : q;
      i += end.length;
      while (i < text.length && !text.startsWith(end, i)) i += text[i] === '\\' && !triple ? 2 : 1;
      i += end.length;
      tokens.push({ type: 'str', value: text.slice(start, i), start, end: i });
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      const m = text.slice(i).match(/^(0x[0-9a-fA-F_]+|0b[01_]+|[0-9_]*\.?[0-9_]+(e[+-]?[0-9]+)?|[0-9_]+\.)/);
      i += m[0].length;
      tokens.push({ type: 'num', value: m[0], start, end: i });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      i += m[0].length;
      tokens.push({ type: 'id', value: m[0], start, end: i });
      continue;
    }
    const op = OPERATORS.find((o) => text.startsWith(o, i));
    if (!op) throw new SyntaxError(`caractere inesperado "${ch}"`);
    i += op.length;
    tokens.push({ type: 'op', value: op, start, end: i });
  }
  return tokens;
}

// ---------- expressões ----------

class ExprParser {
  constructor(text, tokens, pos = 0) {
    this.text = text;
    this.tokens = tokens;
    this.pos = pos;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset];
  }

  is(value, offset = 0) {
    const tok = this.peek(offset);
    return Boolean(tok) && tok.value === value && (tok.type === 'op' || tok.type === 'id');
  }

  next() {
    return this.tokens[this.pos++];
  }

  expect(value) {
    if (!this.is(value)) throw new SyntaxError(`esperado "${value}"`);
    return this.next();
  }

  node(t, start, data) {
    const end = this.tokens[this.pos - 1]?.end ?? start;
    return { t, src: this.text.slice(start, end).trim(), start, end, ...data };
  }

  parse() {
    return this.ternary();
  }

  ternary() {
    const start = this.peek()?.start ?? 0;
    const a = this.binary(0);
    if (this.is('if')) {
      this.next();
      const cond = this.binary(0);
      this.expect('else');
      const b = this.ternary();
      return this.node('ternary', start, { cond, a, b });
    }
    return a;
  }

  // Níveis do mais fraco ao mais forte.
  static LEVELS = [
    ['or', '||'],
    ['and', '&&'],
    ['not'], // prefixo
    ['in', 'not in'],
    ['==', '!=', '<', '<=', '>', '>='],
    ['|'],
    ['^'],
    ['&'],
    ['<<', '>>'],
    ['+', '-'],
    ['*', '/', '%'],
  ];

  binary(level) {
    const ops = ExprParser.LEVELS[level];
    if (!ops) return this.unary();
    const start = this.peek()?.start ?? 0;
    if (ops[0] === 'not') {
      if (this.is('not') || this.is('!')) {
        this.next();
        const arg = this.binary(level);
        return this.node('unary', start, { op: 'not', arg });
      }
      return this.binary(level + 1);
    }
    let left = this.binary(level + 1);
    for (;;) {
      let op = null;
      if (ops.includes('not in') && this.is('not') && this.is('in', 1)) {
        this.next();
        op = 'not in';
      } else if (this.peek() && ops.includes(this.peek().value) && (this.peek().type === 'op' || /^(or|and|in)$/.test(this.peek().value))) op = this.peek().value;
      if (!op) return left;
      this.next();
      const right = this.binary(level + 1);
      left = this.node('binary', start, { op: { '||': 'or', '&&': 'and' }[op] ?? op, a: left, b: right });
    }
  }

  unary() {
    const start = this.peek()?.start ?? 0;
    if (this.is('-') || this.is('+') || this.is('~')) {
      const op = this.next().value;
      const arg = this.unary();
      if (op === '-' && arg.t === 'num') return this.node('num', start, { value: -arg.value, float: arg.float });
      return this.node('unary', start, { op, arg });
    }
    if (this.is('await')) {
      this.next();
      const arg = this.unary();
      return this.node('await', start, { arg });
    }
    return this.power();
  }

  power() {
    const start = this.peek()?.start ?? 0;
    const base = this.cast();
    if (this.is('**')) {
      this.next();
      const exp = this.unary();
      return this.node('binary', start, { op: '**', a: base, b: exp });
    }
    return base;
  }

  cast() {
    const start = this.peek()?.start ?? 0;
    let value = this.postfix();
    while (this.is('is') || this.is('as')) {
      const op = this.next().value;
      const type = this.typeName();
      value = this.node(op === 'is' ? 'is' : 'cast', start, { value, type });
    }
    return value;
  }

  typeName() {
    let name = this.next()?.value ?? '';
    while (this.is('.') || this.is('[')) {
      const tok = this.next();
      if (tok.value === '.') name += `.${this.next().value}`;
      else {
        name += `[${this.typeName()}]`;
        this.expect(']');
      }
    }
    return name;
  }

  postfix() {
    const start = this.peek()?.start ?? 0;
    let value = this.primary();
    for (;;) {
      if (this.is('.')) {
        this.next();
        const name = this.next()?.value;
        value = this.node('member', start, { obj: value, name });
      } else if (this.is('(')) {
        this.next();
        const args = this.list(')');
        value = this.node('call', start, { callee: value, args });
      } else if (this.is('[')) {
        this.next();
        const index = this.parse();
        this.expect(']');
        value = this.node('index', start, { obj: value, index });
      } else return value;
    }
  }

  list(close) {
    const items = [];
    while (!this.is(close)) {
      items.push(this.parse());
      if (this.is(',')) this.next();
      else break;
    }
    this.expect(close);
    return items;
  }

  primary() {
    const tok = this.next();
    if (!tok) throw new SyntaxError('expressão incompleta');
    const start = tok.start;
    if (tok.type === 'num') {
      const clean = tok.value.replace(/_/g, '');
      const float = /[.e]/.test(clean) && !clean.startsWith('0x');
      return this.node('num', start, { value: float ? Number.parseFloat(clean) : Number(clean), float });
    }
    if (tok.type === 'str') return this.node('str', start, { raw: tok.value });
    if (tok.type === 'id') {
      if (tok.value === 'true' || tok.value === 'false') return this.node('bool', start, { value: tok.value === 'true' });
      if (tok.value === 'null') return this.node('null', start);
      if (tok.value === 'func') return this.node('other', start); // lambda: fica como texto
      return this.node('name', start, { name: tok.value });
    }
    if (tok.value === '(') {
      const inner = this.parse();
      this.expect(')');
      return { ...inner, src: this.text.slice(start, this.tokens[this.pos - 1].end) };
    }
    if (tok.value === '[') return this.node('array', start, { items: this.list(']') });
    if (tok.value === '{') {
      const pairs = [];
      while (!this.is('}')) {
        const key = this.parse();
        if (this.is(':') || this.is('=')) this.next();
        pairs.push({ key, value: this.parse() });
        if (this.is(',')) this.next();
        else break;
      }
      this.expect('}');
      return this.node('dict', start, { pairs });
    }
    if (tok.value === '$' || tok.value === '%') {
      // $Caminho/Do/No, $"Caminho", %Unico
      if (this.peek()?.type === 'str') this.next();
      else {
        this.next();
        while (this.is('/')) {
          this.next();
          this.next();
        }
      }
      return this.node('nodepath', start);
    }
    throw new SyntaxError(`inesperado "${tok.value}"`);
  }
}

export function parseExpression(text) {
  const tokens = tokenize(text);
  const parser = new ExprParser(text, tokens);
  const expr = parser.parse();
  if (parser.pos < tokens.length) throw new SyntaxError(`sobrou "${text.slice(tokens[parser.pos].start)}"`);
  return expr;
}

// Tenta analisar; em erro devolve um nó 'other' com o texto original.
function safeExpression(text) {
  try {
    return parseExpression(text);
  } catch {
    return { t: 'other', src: text.trim() };
  }
}

// ---------- instruções ----------

// Divide no primeiro separador de nível 0 (fora de parênteses/strings).
function splitTop(text, separators) {
  const tokens = tokenize(text);
  let depth = 0;
  for (const tok of tokens) {
    if ('([{'.includes(tok.value) && tok.type === 'op') depth++;
    else if (')]}'.includes(tok.value) && tok.type === 'op') depth--;
    else if (depth === 0 && tok.type === 'op' && separators.includes(tok.value)) {
      return [text.slice(0, tok.start).trim(), tok.value, text.slice(tok.end).trim()];
    }
  }
  return null;
}

function splitArgs(text) {
  const out = [];
  let depth = 0;
  let last = 0;
  const tokens = text.trim() ? tokenize(text) : [];
  for (const tok of tokens) {
    if (tok.type !== 'op') continue;
    if ('([{'.includes(tok.value)) depth++;
    else if (')]}'.includes(tok.value)) depth--;
    else if (tok.value === ',' && depth === 0) {
      out.push(text.slice(last, tok.start).trim());
      last = tok.end;
    }
  }
  const tail = text.slice(last).trim();
  if (tail) out.push(tail);
  return out;
}

// "nome: Tipo = padrão" / "nome := padrão" → { name, type, default }
function parseParam(text) {
  const m = text.match(/^([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*(?::?=\s*(.+))?$/);
  if (!m) return { name: text.trim(), type: '', default: undefined };
  return { name: m[1], type: (m[2] ?? '').trim(), default: m[3]?.trim() };
}

// Conteúdo entre o primeiro "(" e o ")" correspondente.
function parenContent(text, from = 0) {
  const open = text.indexOf('(', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
  }
  return null;
}

// Separa "cabeçalho: corpo na mesma linha" (if x: return).
function headerAndInline(text) {
  const parts = splitTop(text, [':']);
  if (!parts) return { head: text, inline: '' };
  return { head: parts[0], inline: parts[2] };
}

const ASSIGN_OPS = ['=', '+=', '-=', '*=', '/=', '%=', '**=', '&=', '|=', '^=', '<<=', '>>='];

function parseLine(text, line) {
  const base = { line, text };
  let m;
  if (/^(pass|break|continue)$/.test(text)) return { ...base, kind: text };
  if ((m = text.match(/^return\b\s*(.*)$/))) return { ...base, kind: 'return', value: m[1] ? safeExpression(m[1]) : null };
  if ((m = text.match(/^extends\s+(.+)$/))) return { ...base, kind: 'extends', base: m[1].trim() };
  if ((m = text.match(/^class_name\s+([A-Za-z_]\w*)(?:\s+extends\s+(.+))?$/))) return { ...base, kind: 'class_name', name: m[1], base: m[2]?.trim() };
  if ((m = text.match(/^signal\s+([A-Za-z_]\w*)\s*(?:\((.*)\))?$/))) return { ...base, kind: 'signal', name: m[1], params: splitArgs(m[2] ?? '').map(parseParam) };
  if ((m = text.match(/^enum\s*([A-Za-z_]\w*)?\s*\{(.*)\}$/))) return { ...base, kind: 'enum', name: m[1] ?? '', values: m[2].trim().replace(/,\s*$/, '') };
  if ((m = text.match(/^class\s+([A-Za-z_]\w*)(?:\s+extends\s+([^:]+))?\s*:/))) return { ...base, kind: 'class', name: m[1], base: m[2]?.trim() ?? '' };

  // Anotações: @export var x, @onready var y, @export_range(0, 10) var z, ou sozinhas na linha.
  const annotations = [];
  let rest = text;
  while ((m = rest.match(/^@([A-Za-z_]\w*)(\([^)]*\))?\s*/))) {
    annotations.push(m[1] + (m[2] ?? ''));
    rest = rest.slice(m[0].length);
  }
  if (annotations.length && !rest) return { ...base, kind: 'annotation', annotations };

  if ((m = rest.match(/^(static\s+)?var\s+([A-Za-z_]\w*)\s*(.*)$/)) || (m = rest.match(/^()const\s+([A-Za-z_]\w*)\s*(.*)$/))) {
    const constant = rest.startsWith('const');
    const tail = m[3].replace(/:\s*$/, ''); // propriedades com setget (var x: set = ...) ficam simplificadas
    const t = tail.match(/^(?::\s*([^=]*?))?\s*(?::?=\s*(.+))?$/) ?? [];
    return { ...base, kind: constant ? 'const' : 'var', name: m[2], type: (t[1] ?? '').trim(), value: t[2] ? safeExpression(t[2]) : null, annotations, isStatic: Boolean(m[1]) };
  }
  if ((m = rest.match(/^(static\s+)?func\s+([A-Za-z_]\w*)\s*\(/))) {
    const params = parenContent(rest, rest.indexOf('func'));
    const after = params ? rest.slice(params.end) : '';
    const ret = after.match(/^\s*->\s*([^:]+?)\s*:/);
    return { ...base, kind: 'func', name: m[2], isStatic: Boolean(m[1]), params: splitArgs(params?.inner ?? '').map(parseParam), returnType: ret?.[1] ?? '' };
  }
  if ((m = text.match(/^(if|elif|while)\s+(.+)$/))) {
    const { head, inline } = headerAndInline(m[2]);
    return { ...base, kind: m[1], condition: safeExpression(head), inline };
  }
  if (/^else\s*:/.test(text)) return { ...base, kind: 'else', inline: text.replace(/^else\s*:\s*/, '') };
  if ((m = text.match(/^for\s+([A-Za-z_]\w*)(?:\s*:\s*[A-Za-z_][\w.[\]]*)?\s+in\s+(.+)$/))) {
    const { head, inline } = headerAndInline(m[2]);
    return { ...base, kind: 'for', variable: m[1], iterable: safeExpression(head), inline };
  }
  if ((m = text.match(/^match\s+(.+):$/))) return { ...base, kind: 'match', value: safeExpression(m[1]) };

  const assign = splitTop(text, ASSIGN_OPS);
  if (assign && assign[0]) return { ...base, kind: 'assign', target: safeExpression(assign[0]), op: assign[1], value: safeExpression(assign[2]) };
  const expr = safeExpression(text);
  return { ...base, kind: expr.t === 'other' ? 'unknown' : 'expr', expr };
}

// Monta a árvore pela indentação; liga elif/else ao if anterior e casos ao match.
export function parseGDScript(source) {
  const lines = logicalLines(source);
  const errors = [];
  let i = 0;

  const block = (indent, inMatch = false) => {
    const out = [];
    while (i < lines.length && lines[i].indent >= indent) {
      const { text, line, indent: own } = lines[i];
      if (own > indent) {
        // Indentação inesperada: trata como parte do bloco atual.
        errors.push({ line, message: 'indent' });
      }
      i++;
      if (inMatch) {
        const { head, inline } = headerAndInline(text);
        const body = inline ? [parseLine(inline, line)] : block(own + 1);
        out.push({ kind: 'case', line, pattern: head.trim(), body });
        continue;
      }
      const stmt = parseLine(text, line);
      const childIndent = own + 1;
      const hasBody = i < lines.length && lines[i].indent > own;
      if (stmt.kind === 'match') stmt.cases = block(childIndent, true);
      else if (['if', 'elif', 'else', 'while', 'for'].includes(stmt.kind)) stmt.body = stmt.inline ? [parseLine(stmt.inline, line)] : hasBody ? block(childIndent) : [];
      else if (stmt.kind === 'func' || stmt.kind === 'class') {
        const inline = stmt.kind === 'func' ? text.slice(text.lastIndexOf(':') + 1).trim() : '';
        stmt.body = hasBody ? block(childIndent) : inline ? [parseLine(inline, line)] : [];
      } else if (hasBody) {
        // Corpo que não esperávamos (ex.: propriedade com get/set): guarda o texto.
        stmt.extra = block(childIndent);
      }
      if (stmt.kind === 'elif' || stmt.kind === 'else') {
        // Pendura no if mais recente deste nível.
        let target = out[out.length - 1];
        while (target?.kind === 'if' && target.orelse) target = target.orelse.length === 1 && target.orelse[0].fromElif ? target.orelse[0] : null;
        if (target?.kind === 'if') {
          target.orelse = stmt.kind === 'else' ? stmt.body : [{ ...stmt, kind: 'if', fromElif: true }];
          continue;
        }
        errors.push({ line, message: 'orphanElse' });
        continue;
      }
      out.push(stmt);
    }
    return out;
  };

  const statements = block(0);
  return { statements, errors };
}
