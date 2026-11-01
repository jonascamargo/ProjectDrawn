import { uid } from '../../core/ids.js';
import { createNode, emptyGraph, nodePins, readGraph, resolveFile, scriptClassName } from '../../core/graph.js';

// Adaptador .tres (recurso da Godot, format=3): nós ↔ arquivo.
// tres.resource = [gd_resource] + [resource]; tres.sub = [sub_resource]; tres.ext = [ext_resource].
// Propriedades = pinos prop:<nome>; valor digitado vai igual (texto da Godot); fio de um
// sub-recurso/recurso externo vira SubResource("id")/ExtResource("id"). uid, ids, ordem e
// load_steps do arquivo importado ficam nos nós (o arquivo exportado sai igual).

const COLUMN = 300;
const GAP = 24;
const ROW = 24;
const HEAD = 52;

// ---------- nós → .tres ----------

export function generateTres(item) {
  const graph = readGraph(item);
  const warnings = [];
  const warn = (nodeId, message, params = {}) => warnings.push({ nodeId, message, params });
  const roots = graph.nodes.filter((n) => n.type === 'tres.resource');
  if (!roots.length) {
    warn(null, 'tres.warn.noRoot');
    return { code: '', warnings };
  }
  for (const extra of roots.slice(1)) warn(extra.id, 'tres.warn.extraRoot');
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = new Map(graph.wires.map((w) => [`${w.to.node}|${w.to.pin}`, w]));
  const exts = [];
  const extByKey = new Map();
  const subs = [];
  const subDone = new Map();
  const visiting = new Set();
  const used = new Set([roots[0].id]);

  const ext = (key, { type, uid: u, path, id, order }, seed) => {
    if (extByKey.has(key)) return extByKey.get(key).id;
    const entry = { type: type || 'Resource', uid: u || '', path, id: id || `${exts.length + 1}_${hash(seed)}`, order: order ?? Infinity };
    exts.push(entry);
    extByKey.set(key, entry);
    return entry.id;
  };
  const extOfNode = (node) => {
    const f = node.fields ?? {};
    const path = resolveFile(f.ref)?.path ?? f.path ?? '';
    if (!path) warn(node.id, 'tres.warn.missingFile', { title: f.type || 'ext_resource' });
    return ext(path || node.id, { type: f.type || nodePins(node).outputs[0]?.type, uid: f.uid, path, id: f.id, order: f.order }, node.id);
  };
  const value = (node, pinId) => {
    const wire = incoming.get(`${node.id}|${pinId}`);
    if (!wire) {
      const v = node.defaults?.[pinId];
      return v === undefined || v === null || String(v).trim() === '' ? undefined : String(v);
    }
    const src = byId.get(wire.from.node);
    if (!src) return undefined;
    used.add(src.id);
    if (src.type === 'core.reroute') return value(src, 'in');
    if (src.type === 'tres.sub') return `SubResource("${sub(src) ?? '?'}")`;
    if (src.type === 'tres.ext') return `ExtResource("${extOfNode(src)}")`;
    warn(src.id, 'tres.warn.unknownNode', { type: src.type });
    return undefined;
  };
  const lines = (node) => {
    const out = [];
    const f = node.fields ?? {};
    if (f.script || f.scriptExt?.path) {
      const path = resolveFile(f.script)?.path ?? f.scriptExt?.path;
      if (!path) warn(node.id, 'tres.warn.missingFile', { title: 'script' });
      else out.push(`script = ExtResource("${ext(path, { type: 'Script', uid: f.scriptExt?.uid, path, id: f.scriptExt?.id, order: f.scriptExt?.order }, `${node.id}:script`)}")`);
    }
    for (const pin of nodePins(node).inputs) {
      if (!pin.id.startsWith('prop:')) continue;
      const v = value(node, pin.id);
      if (v !== undefined) out.push(`${pin.label} = ${v}`);
    }
    return out;
  };
  function sub(node) {
    if (subDone.has(node.id)) return subDone.get(node.id);
    if (visiting.has(node.id)) {
      warn(node.id, 'tres.warn.cycle');
      return null;
    }
    visiting.add(node.id);
    const f = node.fields ?? {};
    const type = f.class || 'Resource';
    const body = lines(node);
    const id = f.id || `${type}_${hash(node.id)}`;
    visiting.delete(node.id);
    subDone.set(node.id, id);
    subs.push({ id, type, body, order: f.order ?? Infinity });
    return id;
  }

  const root = roots[0];
  const rootLines = lines(root);
  // Sub-recursos e externos citados só dentro de valores digitados (ex.: [SubResource("x")])
  // também entram no arquivo.
  const typed = graph.nodes.flatMap((n) => Object.values(n.defaults ?? {})).join('\n');
  for (const node of graph.nodes) {
    const id = node.fields?.id;
    if (!id || !typed.includes(`"${id}"`)) continue;
    used.add(node.id);
    if (node.type === 'tres.sub') sub(node);
    else if (node.type === 'tres.ext') extOfNode(node);
  }
  const f = root.fields ?? {};
  const className = f.script ? scriptClassName(f.script) : null;
  const attrs = [`type="${f.class || 'Resource'}"`];
  if (className) attrs.push(`script_class="${className}"`);
  if (f.loadSteps) attrs.push(`load_steps=${exts.length + subs.length + 1}`);
  attrs.push(`format=${f.format || 3}`);
  if (f.uid) attrs.push(`uid="${f.uid}"`);
  const byOrder = (a, b) => (a.order === b.order ? 0 : a.order < b.order ? -1 : 1);
  const out = [`[gd_resource ${attrs.join(' ')}]`, ''];
  for (const e of [...exts].sort(byOrder)) out.push(`[ext_resource type="${e.type}"${e.uid ? ` uid="${e.uid}"` : ''} path="${e.path}" id="${e.id}"]`);
  if (exts.length) out.push('');
  for (const s of [...subs].sort(byOrder)) out.push(`[sub_resource type="${s.type}" id="${s.id}"]`, ...s.body, '');
  out.push('[resource]', ...rootLines);
  for (const node of graph.nodes) {
    if (!used.has(node.id) && node.type !== 'misc.comment' && node.type !== 'tres.resource') warn(node.id, 'tres.warn.unused');
  }
  return { code: `${out.join('\n')}\n`, warnings };
}

// Id estável a partir do id do nó (exportar duas vezes gera o mesmo arquivo).
export function hash(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36).slice(0, 5).padStart(5, '0');
}

// ---------- .tres → nós ----------

export function parseTres(source, { resolvePath = () => null } = {}) {
  const sections = readSections(source);
  const head = sections.find((s) => s.name === 'gd_resource');
  if (!head) return { graph: null, warnings: [{ nodeId: null, message: 'tres.warn.parse', params: { error: '[gd_resource]' } }] };
  const graph = emptyGraph();
  const warnings = [];
  const extAttrs = new Map();
  sections.filter((s) => s.name === 'ext_resource').forEach((s, i) => extAttrs.set(s.attrs.id, { ...s.attrs, order: i }));

  const root = createNode('tres.resource');
  root.fields.class = head.attrs.type || 'Resource';
  root.fields.uid = head.attrs.uid ?? '';
  root.fields.format = Number(head.attrs.format) || 3;
  if (head.attrs.load_steps) root.fields.loadSteps = true;
  graph.nodes.push(root);

  const subNodes = new Map();
  const bodies = [];
  sections.filter((s) => s.name === 'sub_resource').forEach((s, i) => {
    const n = createNode('tres.sub');
    Object.assign(n.fields, { class: s.attrs.type || 'Resource', id: s.attrs.id ?? '', order: i });
    graph.nodes.push(n);
    subNodes.set(s.attrs.id, n);
    bodies.push([n, s.props]);
  });
  const main = sections.find((s) => s.name === 'resource');
  if (main) bodies.push([root, main.props]);

  // Externos usados só como script do recurso não viram nó (ficam no campo script).
  const refs = new Set();
  for (const [, props] of bodies) {
    for (const [key, raw] of props) {
      if (key === 'script') continue;
      for (const m of raw.matchAll(/ExtResource\(\s*"([^"]+)"\s*\)/g)) refs.add(m[1]);
    }
  }
  const extNodes = new Map();
  const extNode = (id) => {
    if (extNodes.has(id)) return extNodes.get(id);
    const a = extAttrs.get(id);
    if (!a) return null;
    const n = createNode('tres.ext');
    Object.assign(n.fields, { ref: resolvePath(a.path) ?? '', path: a.path ?? '', type: a.type ?? '', id, uid: a.uid ?? '', order: a.order });
    graph.nodes.push(n);
    extNodes.set(id, n);
    return n;
  };
  for (const id of extAttrs.keys()) if (refs.has(id)) extNode(id);

  for (const [node, props] of bodies) {
    node.props = node.props ?? [];
    for (const [key, raw] of props) {
      const v = raw.trim();
      const m = v.match(/^(Sub|Ext)Resource\(\s*"([^"]+)"\s*\)$/);
      if (key === 'script' && m?.[1] === 'Ext') {
        const a = extAttrs.get(m[2]);
        node.fields.script = (a && resolvePath(a.path)) || '';
        node.fields.scriptExt = { id: m[2], uid: a?.uid ?? '', path: a?.path ?? '', order: a?.order };
        if (!node.fields.script) warnings.push({ nodeId: node.id, message: 'tres.warn.missingFile', params: { title: a?.path ?? m[2] } });
        continue;
      }
      if (!node.props.includes(key)) node.props.push(key);
      const pin = `prop:${key}`;
      const src = m ? (m[1] === 'Sub' ? subNodes.get(m[2]) : extNode(m[2])) : null;
      if (src) graph.wires.push({ id: uid('wr'), kind: 'data', from: { node: src.id, pin: 'out' }, to: { node: node.id, pin } });
      else node.defaults[pin] = v;
    }
  }
  layout(graph, root);
  return { graph, warnings };
}

// Colunas: o recurso à direita; quem é usado fica à esquerda de quem usa.
function layout(graph, root) {
  const depth = new Map([[root.id, 0]]);
  for (let pass = 0; pass < graph.nodes.length; pass++) {
    let changed = false;
    for (const w of graph.wires) {
      const d = (depth.get(w.to.node) ?? 0) + 1;
      if (d > (depth.get(w.from.node) ?? -1)) {
        depth.set(w.from.node, d);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const max = Math.max(1, ...depth.values());
  const nextY = [];
  for (const node of graph.nodes) {
    const d = depth.get(node.id) ?? 1;
    node.x = (max - d) * COLUMN;
    node.y = nextY[d] ?? 0;
    nextY[d] = node.y + HEAD + Math.max(1, (node.props ?? []).length) * ROW + GAP;
  }
}

function readSections(source) {
  const lines = source.replace(/\r/g, '').split('\n');
  const sections = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.trim();
    if (!text || text.startsWith(';')) continue;
    const head = text.match(/^\[(\w+)(.*)\]$/);
    if (head) {
      current = { name: head[1], attrs: attrsOf(head[2]), props: [] };
      sections.push(current);
      continue;
    }
    const prop = line.match(/^([^=\s][^=]*?)\s*=\s*(.*)$/);
    if (!prop || !current) continue;
    let value = prop[2];
    while (open(value) > 0 && i + 1 < lines.length) value += `\n${lines[++i]}`;
    current.props.push([prop[1].trim(), value]);
  }
  return sections;
}

// Parênteses/colchetes/chaves (e aspas) ainda abertos: o valor continua na próxima linha.
function open(text) {
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
  }
  return depth + (quoted ? 1 : 0);
}

function attrsOf(text) {
  const out = {};
  for (const m of text.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|[^\s\]]+)/g)) out[m[1]] = m[2].startsWith('"') ? JSON.parse(m[2]) : m[2];
  return out;
}
