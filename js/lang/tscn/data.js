import { uid } from '../../core/ids.js';
import { createNode, emptyGraph, nodePins, readGraph, resolveFile } from '../../core/graph.js';
import { hash } from '../tres/data.js';

// Adaptador .tscn (cena da Godot, format=3): nós ↔ arquivo.
// [node] = scene.node (árvore pelos fios "filho de"); script/instância = campos script/instance;
// propriedades = pinos prop:<nome> com o texto da Godot; [sub_resource]/[ext_resource] citados
// em propriedades = nós tres.sub/tres.ext; [connection] = sinal exposto (sig:<nome>) ligado a
// uma Referência de script (scene.scriptRef, método). uid, ids, ordem e atributos extras
// (groups, index…) ficam guardados (graph.meta, fields.attrs, wire.attrs) para o arquivo sair igual.

const COLUMN = 300;
const ROW = 24;
const HEAD = 52;
const GAP = 24;

// ---------- nós → .tscn ----------

export function generateTscn(item) {
  const graph = readGraph(item);
  const warnings = [];
  const warn = (nodeId, message, params = {}) => warnings.push({ nodeId, message, params });
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const scene = graph.nodes.filter((n) => n.type === 'scene.node');
  const parentOf = new Map(graph.wires.filter((w) => w.kind === 'tree').map((w) => [w.to.node, w.from.node]));
  const roots = scene.filter((n) => !parentOf.has(n.id));
  if (!roots.length) {
    warn(null, 'tscn.warn.noRoot');
    return { code: '', warnings };
  }
  for (const extra of roots.slice(1)) warn(extra.id, 'tscn.warn.extraRoot');
  const childrenOf = new Map();
  for (const n of scene) {
    const p = parentOf.get(n.id);
    if (!p) continue;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(n);
  }
  const rank = (n) => n.fields?.order ?? Infinity;
  for (const list of childrenOf.values()) list.sort((a, b) => (rank(a) === rank(b) ? a.y - b.y : rank(a) < rank(b) ? -1 : 1));

  // Ordem do arquivo (pré-ordem) e caminho de cada nó ("." = raiz).
  const ordered = [];
  const pathOf = new Map();
  const visit = (n, parentPath) => {
    const name = n.fields?.name || 'Node';
    const path = parentPath === null ? '.' : parentPath === '.' ? name : `${parentPath}/${name}`;
    pathOf.set(n.id, path);
    ordered.push({ node: n, parentPath });
    for (const child of childrenOf.get(n.id) ?? []) visit(child, path);
  };
  visit(roots[0], null);

  const incoming = new Map(graph.wires.filter((w) => w.kind === 'data').map((w) => [`${w.to.node}|${w.to.pin}`, w]));
  const exts = [];
  const extByKey = new Map();
  const subs = [];
  const subDone = new Map();
  const visiting = new Set();
  const used = new Set(ordered.map((o) => o.node.id));
  const ext = (key, { type, uid: u, path, id, order }, seed) => {
    if (extByKey.has(key)) return extByKey.get(key).id;
    const entry = { type: type || 'Resource', uid: u || '', path, id: id || `${exts.length + 1}_${hash(seed)}`, order: order ?? Infinity };
    exts.push(entry);
    extByKey.set(key, entry);
    return entry.id;
  };
  const extOfFile = (fileId, saved, type, seed) => {
    const path = resolveFile(fileId)?.path ?? saved?.path;
    if (!path) return null;
    return ext(path, { type, uid: saved?.uid, path, id: saved?.id, order: saved?.order }, seed);
  };
  const extOfNode = (node) => {
    const f = node.fields ?? {};
    const path = resolveFile(f.ref)?.path ?? f.path ?? '';
    if (!path) warn(node.id, 'tscn.warn.missingFile', { title: f.type || 'ext_resource' });
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
    if (src.type === 'scene.node') return `NodePath("${relative(pathOf.get(node.id), pathOf.get(src.id))}")`;
    warn(src.id, 'tscn.warn.unknownNode', { type: src.type });
    return undefined;
  };
  const lines = (node) => {
    const out = [];
    const f = node.fields ?? {};
    if (f.script || f.scriptExt?.path) {
      const id = extOfFile(f.script, f.scriptExt, 'Script', `${node.id}:script`);
      if (id) out.push(`script = ExtResource("${id}")`);
      else warn(node.id, 'tscn.warn.missingFile', { title: 'script' });
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
      warn(node.id, 'tscn.warn.cycle');
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

  // Seções [node].
  const blocks = [];
  for (const { node, parentPath } of ordered) {
    const f = node.fields ?? {};
    const computed = new Map();
    computed.set('name', `"${f.name || 'Node'}"`);
    if (!f.instance && f.class) computed.set('type', `"${f.class}"`);
    if (parentPath !== null) computed.set('parent', `"${parentPath}"`);
    if (f.instance || f.instanceExt?.path) {
      const id = extOfFile(f.instance, f.instanceExt, 'PackedScene', `${node.id}:instance`);
      if (id) computed.set('instance', `ExtResource("${id}")`);
      else warn(node.id, 'tscn.warn.missingFile', { title: 'instance' });
    }
    blocks.push({ head: `[node ${attrs(f.attrs, computed, ['name', 'type', 'parent', 'instance'])}]`, body: lines(node) });
  }
  // Sub-recursos/externos citados só dentro de valores digitados também entram no arquivo.
  const typed = graph.nodes.flatMap((n) => Object.values(n.defaults ?? {})).join('\n');
  for (const node of graph.nodes) {
    const id = node.fields?.id;
    if (!id || !typed.includes(`"${id}"`)) continue;
    used.add(node.id);
    if (node.type === 'tres.sub') sub(node);
    else if (node.type === 'tres.ext') extOfNode(node);
  }

  // [connection]: sinal exposto de um nó → Referência de script (método).
  const connections = [];
  for (const w of graph.wires) {
    if (w.kind !== 'signal') continue;
    const from = byId.get(w.from.node);
    const ref = byId.get(w.to.node);
    if (!from || !ref || !pathOf.has(from.id)) continue;
    used.add(ref.id);
    const target = ref.fields?.toPath || [...pathOf.entries()].find(([id]) => byId.get(id).fields?.script && byId.get(id).fields.script === ref.fields?.script)?.[1] || '.';
    if (!ref.fields?.method) warn(ref.id, 'tscn.warn.noMethod');
    const computed = new Map([
      ['signal', `"${w.from.pin.replace(/^sig:/, '')}"`],
      ['from', `"${pathOf.get(from.id)}"`],
      ['to', `"${target}"`],
      ['method', `"${ref.fields?.method ?? ''}"`],
    ]);
    connections.push({ order: w.order ?? Infinity, head: `[connection ${attrs(w.attrs, computed, ['signal', 'from', 'to', 'method'])}]` });
  }
  connections.sort((a, b) => (a.order === b.order ? 0 : a.order < b.order ? -1 : 1));

  const meta = graph.meta ?? {};
  const head = [];
  if (meta.loadSteps) head.push(`load_steps=${exts.length + subs.length + 1}`);
  head.push(`format=${meta.format || 3}`);
  if (meta.uid) head.push(`uid="${meta.uid}"`);
  const byOrder = (a, b) => (a.order === b.order ? 0 : a.order < b.order ? -1 : 1);
  const sections = [`[gd_scene ${head.join(' ')}]`];
  if (exts.length) sections.push([...exts].sort(byOrder).map((e) => `[ext_resource type="${e.type}"${e.uid ? ` uid="${e.uid}"` : ''} path="${e.path}" id="${e.id}"]`).join('\n'));
  for (const s of [...subs].sort(byOrder)) sections.push([`[sub_resource type="${s.type}" id="${s.id}"]`, ...s.body].join('\n'));
  for (const b of blocks) sections.push([b.head, ...b.body].join('\n'));
  for (const c of connections) sections.push(c.head);
  for (const raw of meta.tail ?? []) sections.push(raw);
  for (const node of graph.nodes) {
    if (!used.has(node.id) && node.type !== 'misc.comment') warn(node.id, node.type === 'scene.node' ? 'tscn.warn.detached' : 'tscn.warn.unused');
  }
  return { code: `${sections.join('\n\n')}\n`, warnings };
}

// Atributos na ordem original (os desconhecidos ficam como estavam), depois os novos.
function attrs(saved, computed, defaults) {
  const out = [];
  const done = new Set();
  for (const [key, raw] of saved ?? defaults.map((k) => [k])) {
    done.add(key);
    if (computed.has(key)) out.push(`${key}=${computed.get(key)}`);
    else if (raw !== undefined && !defaults.includes(key)) out.push(`${key}=${raw}`);
  }
  for (const [key, v] of computed) if (!done.has(key)) out.push(`${key}=${v}`);
  return out.join(' ');
}

// Caminho de `to` visto de `from` (NodePath relativo).
function relative(from, to) {
  const split = (p) => (p === '.' ? [] : p.split('/'));
  const a = split(from);
  const b = split(to);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = a.slice(i).map(() => '..');
  return [...up, ...b.slice(i)].join('/') || '.';
}

// ---------- .tscn → nós ----------

export function parseTscn(source, { resolvePath = () => null } = {}) {
  const sections = readSections(source);
  const head = sections.find((s) => s.name === 'gd_scene');
  if (!head) return { graph: null, warnings: [{ nodeId: null, message: 'tscn.warn.parse', params: { error: '[gd_scene]' } }] };
  const graph = emptyGraph();
  const warnings = [];
  graph.meta = { format: Number(head.map.format) || 3, uid: head.map.uid ?? '', loadSteps: head.map.load_steps !== undefined, tail: [] };
  const extAttrs = new Map();
  sections.filter((s) => s.name === 'ext_resource').forEach((s, i) => extAttrs.set(s.map.id, { ...s.map, order: i }));
  const extRef = (raw) => raw?.match(/^ExtResource\(\s*"([^"]+)"\s*\)$/)?.[1] ?? null;
  const saved = (id) => {
    const a = extAttrs.get(id);
    return a ? { id, uid: a.uid ?? '', path: a.path ?? '', order: a.order } : null;
  };

  const subNodes = new Map();
  const bodies = [];
  sections.filter((s) => s.name === 'sub_resource').forEach((s, i) => {
    const n = createNode('tres.sub');
    Object.assign(n.fields, { class: s.map.type || 'Resource', id: s.map.id ?? '', order: i });
    graph.nodes.push(n);
    subNodes.set(s.map.id, n);
    bodies.push([n, s.props]);
  });

  // Árvore.
  const byPath = new Map();
  const depthOf = new Map();
  sections.filter((s) => s.name === 'node').forEach((s, i) => {
    const n = createNode('scene.node');
    n.fields.name = s.map.name ?? 'Node';
    n.fields.class = s.map.type ?? '';
    n.fields.order = i;
    n.fields.attrs = s.attrs;
    const inst = extRef(s.raw.instance);
    if (inst) {
      const a = saved(inst);
      n.fields.instance = (a && resolvePath(a.path)) || '';
      n.fields.instanceExt = a;
      if (!n.fields.instance) warnings.push({ nodeId: n.id, message: 'tscn.warn.missingFile', params: { title: a?.path ?? inst } });
    }
    const parentPath = s.map.parent;
    const path = parentPath === undefined ? '.' : parentPath === '.' ? n.fields.name : `${parentPath}/${n.fields.name}`;
    byPath.set(path, n);
    graph.nodes.push(n);
    const parent = parentPath === undefined ? null : byPath.get(parentPath);
    depthOf.set(n.id, parent ? (depthOf.get(parent.id) ?? 0) + 1 : 0);
    if (parent) graph.wires.push({ id: uid('wr'), kind: 'tree', from: { node: parent.id, pin: 'children' }, to: { node: n.id, pin: 'parent' } });
    else if (parentPath !== undefined) warnings.push({ nodeId: n.id, message: 'tscn.warn.noParent', params: { path: parentPath } });
    bodies.push([n, s.props]);
  });

  // Externos citados em propriedades (script/instância ficam nos campos).
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
        const a = saved(m[2]);
        node.fields.script = (a && resolvePath(a.path)) || '';
        node.fields.scriptExt = a;
        if (!node.fields.script) warnings.push({ nodeId: node.id, message: 'tscn.warn.missingFile', params: { title: a?.path ?? m[2] } });
        continue;
      }
      if (!node.props.includes(key)) node.props.push(key);
      const pin = `prop:${key}`;
      const src = m ? (m[1] === 'Sub' ? subNodes.get(m[2]) : extNode(m[2])) : null;
      if (src) graph.wires.push({ id: uid('wr'), kind: 'data', from: { node: src.id, pin: 'out' }, to: { node: node.id, pin } });
      else node.defaults[pin] = v;
    }
  }

  // Sinais conectados.
  const refNodes = new Map();
  sections.filter((s) => s.name === 'connection').forEach((s, i) => {
    const from = byPath.get(s.map.from);
    if (!from) {
      warnings.push({ nodeId: null, message: 'tscn.warn.noParent', params: { path: s.map.from } });
      return;
    }
    const signal = s.map.signal ?? '';
    from.signals = [...new Set([...(from.signals ?? []), signal])];
    const key = `${s.map.to}|${s.map.method}`;
    let ref = refNodes.get(key);
    if (!ref) {
      ref = createNode('scene.scriptRef');
      ref.fields.method = s.map.method ?? '';
      ref.fields.toPath = s.map.to ?? '.';
      ref.fields.script = byPath.get(s.map.to)?.fields.script ?? '';
      graph.nodes.push(ref);
      refNodes.set(key, ref);
    }
    graph.wires.push({ id: uid('wr'), kind: 'signal', from: { node: from.id, pin: `sig:${signal}` }, to: { node: ref.id, pin: 'in' }, order: i, attrs: s.attrs });
  });
  graph.meta.tail = sections.filter((s) => !KNOWN.has(s.name)).map((s) => s.text);

  layout(graph, depthOf);
  return { graph, warnings };
}

const KNOWN = new Set(['gd_scene', 'ext_resource', 'sub_resource', 'node', 'connection']);

// Árvore da esquerda para a direita (pai à esquerda); sub-recursos/externos numa coluna à
// esquerda da raiz; referências de script à direita.
function layout(graph, depthOf) {
  const height = (n) => HEAD + Math.max(1, (n.props ?? []).length + (n.signals ?? []).length) * ROW + GAP;
  const max = Math.max(0, ...depthOf.values());
  let y = 0;
  for (const n of graph.nodes) {
    if (n.type !== 'scene.node') continue;
    n.x = (depthOf.get(n.id) ?? 0) * COLUMN;
    n.y = y;
    y += height(n);
  }
  const column = { 'tres.sub': -COLUMN, 'tres.ext': -COLUMN, 'scene.scriptRef': (max + 1) * COLUMN };
  const nextY = {};
  for (const n of graph.nodes) {
    if (!(n.type in column)) continue;
    n.x = column[n.type];
    n.y = nextY[n.x] ?? 0;
    nextY[n.x] = n.y + height(n);
  }
}

// Seções com atributos na ordem original: { name, attrs: [[chave, texto]], map, raw, props, text }.
function readSections(source) {
  const lines = source.replace(/\r/g, '').split('\n');
  const sections = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.trim();
    if (!text) continue;
    const head = text.match(/^\[(\w+)(.*)\]$/);
    if (head) {
      const attrs = [...head[2].matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|\[[^\]]*\]|\w+\("(?:[^"\\]|\\.)*"\)|[^\s\]]+)/g)].map((m) => [m[1], m[2]]);
      const raw = Object.fromEntries(attrs);
      const map = Object.fromEntries(attrs.map(([k, v]) => [k, v.startsWith('"') ? JSON.parse(v) : v]));
      current = { name: head[1], attrs, raw, map, props: [], text: line };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    current.text += `\n${line}`;
    const prop = line.match(/^([^=\s][^=]*?)\s*=\s*(.*)$/);
    if (!prop) continue;
    let value = prop[2];
    while (open(value) > 0 && i + 1 < lines.length) {
      value += `\n${lines[++i]}`;
      current.text += `\n${lines[i]}`;
    }
    current.props.push([prop[1].trim(), value]);
  }
  return sections;
}

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
