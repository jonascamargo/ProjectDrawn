import { getDef, pinShape, typeColor, typesCompatible } from '../lang/nodeRegistry.js';
import { filePathType, nodePins, pinType, resolveFile, resolveTypes, scopeEntry, scopeParams } from '../core/graph.js';
import { referenceName } from '../core/codeFormat.js';
import { contains, inGrip } from './itemLayout.js';
import { distanceToPolyline, pointAlong, wirePoints } from './wireGeometry.js';

// Geometria do grafo de um script: tamanho dos nós, posição dos pinos, sub-áreas
// (que crescem com os nós, como as pastas) e fios. Coordenadas locais à origem de
// conteúdo do arquivo; place() converte para o mundo.
//
// - Sub-área expandida não tem cabeçalho: só o contorno na cor da categoria (evento, função).
// - A entrada de função/evento (template 'event') é um nó com cabeçalho; arrastá-lo move a
//   sub-área e o botão de recolher dele recolhe a sub-área.
// - Sub-área recolhida vira um nó com cabeçalho e os pinos de parâmetro (o conteúdo some).
// - O último selecionado é desenhado por cima dentro da área pai (paintOrder).

const measureCtx = document.createElement('canvas').getContext('2d');
const sizeCache = new Map();
const HEADER_TEMPLATES = new Set(['full', 'declaration', 'event']);

function textWidth(text, font) {
  if (!text) return 0;
  measureCtx.font = font;
  return measureCtx.measureText(String(text)).width;
}

export function topCategory(def) {
  return (def?.category ?? '').split('/')[0];
}

export function hasHeader(template) {
  return HEADER_TEMPLATES.has(template);
}

// Título e subtítulo exibidos no nó (dependem de campos e referências).
export function nodeLabels(graph, node, def) {
  if (!def) return { title: node.type, subtitle: '' };
  const f = node.fields ?? {};
  const ref = referenceName(graph, node) ?? '?';
  switch (node.type) {
    case 'var.get':
    case 'param.get':
      return { title: ref, subtitle: '' };
    case 'var.set':
      return { title: `${ref} ${f.operator ?? '='}`, subtitle: '' };
    case 'func.call':
      return { title: `${ref}()`, subtitle: '' };
    case 'signal.emit':
      return { title: `${ref}.emit`, subtitle: '' };
    case 'signal.declare':
      return { title: `signal ${f.name || '?'}`, subtitle: (node.params ?? []).map((p) => `${p.name}: ${p.type || 'Variant'}`).join(', ') };
    case 'misc.comment':
      return { title: f.title || def.title, subtitle: '' };
    case 'scene.node': {
      const script = resolveFile(f.script)?.path?.split('/').pop();
      const instance = resolveFile(f.instance)?.path?.split('/').pop();
      return { title: f.name || f.class || 'Node', subtitle: [instance ?? f.class ?? 'Node', script].filter(Boolean).join(' · ') };
    }
    case 'var.path':
      return { title: def.title, subtitle: `${f.name || '?'}: ${filePathType(node)}` };
    case 'var.member':
    case 'var.local':
    case 'var.const': {
      const notes = [f.export && '@export', f.onready && '@onready'].filter(Boolean).join(' ');
      return { title: def.title, subtitle: `${notes ? `${notes} ` : ''}${f.name || '?'}: ${f.type || 'Variant'}` };
    }
  }
  if (def.template === 'event') return { title: scopeTitle(graph, { id: node.scopeId }), subtitle: '' };
  if (def.template === 'literal') return { title: def.title, subtitle: '' };
  if (def.subtitle) return { title: def.title, subtitle: def.subtitle };
  const summary = (def.fields ?? [])
    .filter((field) => field.type !== 'bool' && f[field.id] !== undefined && f[field.id] !== '')
    .slice(0, 2)
    .map((field) => String(f[field.id]))
    .join(' · ');
  return { title: def.title, subtitle: summary };
}

export function scopeTitle(graph, scope) {
  const entry = scopeEntry(graph, scope.id);
  if (!entry) return scope.kind === 'event' ? '?' : 'func ?()';
  const params = scopeParams(graph, scope.id).map((p) => p.name).join(', ');
  if (entry.type === 'func.entry') {
    const returns = entry.fields?.returnType && entry.fields.returnType !== 'void' ? ` -> ${entry.fields.returnType}` : '';
    return `func ${entry.fields?.name || '?'}(${params})${returns}`;
  }
  return `${getDef(entry.type)?.title ?? '?'}(${params})`;
}

// Tipo do valor de nós de variável/parâmetro (para colorir o nó pelo tipo).
function valueType(graph, node) {
  const f = node.fields ?? {};
  switch (node.type) {
    case 'var.member':
    case 'var.local':
    case 'var.const':
      return f.type || 'Variant';
    case 'var.path':
      return filePathType(node);
    case 'scene.node':
      return f.class || 'Node';
    case 'var.get':
    case 'var.set': {
      const decl = graph.nodes.find((n) => n.id === f.ref);
      return decl && decl.type !== node.type ? valueType(graph, decl) ?? 'Variant' : 'Variant';
    }
    case 'param.get':
      return scopeParams(graph, node.scopeId).find((p) => p.id === f.ref)?.type || 'Variant';
  }
  return null;
}

export function literalText(node) {
  const value = node.fields?.value;
  if (node.type === 'lit.string') return `"${value ?? ''}"`;
  if (node.type === 'lit.null') return 'null';
  if (value === undefined) return '';
  return String(value);
}

export function formatDefault(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function pinDefault(node, pin) {
  return node.defaults?.[pin.id] ?? pin.default;
}

function rowsWidth(node, pins, s) {
  const rows = Math.max(pins.inputs.length, pins.outputs.length);
  let width = 0;
  for (let i = 0; i < rows; i++) {
    const inp = pins.inputs[i];
    const out = pins.outputs[i];
    let left = inp ? textWidth(inp.label, s.font) : 0;
    if (inp && inp.kind === 'data') left += Math.min(90, Math.max(24, textWidth(formatDefault(pinDefault(node, inp)), s.font) + 12)) + 6;
    const right = out ? textWidth(out.label, s.font) : 0;
    width = Math.max(width, left + right + 24);
  }
  return width;
}

export const COMMENT_SIZE = { w: 320, h: 180 };

// Texto exibido na etiqueta de um fio: ícone, texto e mudança de tipo (A → B).
export function wireLabelText(label) {
  const change = label?.typeChange && (label.typeChange.from || label.typeChange.to) ? `${label.typeChange.from || '?'} → ${label.typeChange.to || '?'}` : '';
  return [label?.icon, label?.text, change].filter(Boolean).join(' ');
}

// Tamanho do nó (memoizado pelo conteúdo que afeta a geometria).
function measureNode(graph, node, def, pins, style) {
  const labels = nodeLabels(graph, node, def);
  const pinKey = `${pins.inputs.map((p) => `${p.id}:${p.label}`).join(',')}|${pins.outputs.map((p) => `${p.id}:${p.label}`).join(',')}`;
  const key = `${node.type}|${labels.title}|${labels.subtitle}|${JSON.stringify(node.fields)}|${JSON.stringify(node.defaults)}|${pinKey}`;
  const cached = sizeCache.get(key);
  if (cached) return { ...cached, labels };

  const s = style.node;
  const template = def?.template ?? 'full';
  if (template === 'reroute') return { w: 14, h: 14, labels, template };
  if (template === 'comment') return { w: node.w ?? COMMENT_SIZE.w, h: node.h ?? COMMENT_SIZE.h, labels, template };

  const rows = Math.max(pins.inputs.length, pins.outputs.length);
  const dynamicRow = def?.dynamicInputs || def?.dynamicOutputs ? 1 : 0;
  const rowWidth = rowsWidth(node, pins, s);

  let size;
  if (template === 'literal') {
    const w = Math.max(64, textWidth(literalText(node) || labels.title, s.titleFont) + s.padding * 2 + 16, rowWidth + s.padding * 2);
    size = { w, h: s.rowHeight + 8 + (Math.max(0, rows - 1) + dynamicRow) * s.rowHeight };
  } else if (template === 'compact') {
    const titleW = textWidth(labels.title, s.compactTitleFont);
    const subH = labels.subtitle ? s.subtitleHeight : 0;
    const w = Math.max(64, titleW + s.padding * 2 + 28, rowWidth + s.padding * 2 + Math.min(titleW, 40));
    size = { w, h: Math.max(1, rows + dynamicRow) * s.rowHeight + 8 + subH };
  } else {
    const titleW = textWidth(labels.title, s.titleFont) + 18;
    const subW = textWidth(labels.subtitle, s.smallFont);
    const subH = labels.subtitle ? s.subtitleHeight : 0;
    const w = Math.max(s.minWidth, titleW + s.padding * 2 + 10, subW + s.padding * 2, rowWidth + s.padding * 2);
    const bodyRows = rows + dynamicRow;
    size = { w, h: s.headerHeight + subH + Math.max(bodyRows, template === 'declaration' && !rows ? 0 : 1) * s.rowHeight + 6 };
  }
  size.template = template;
  sizeCache.set(key, size);
  if (sizeCache.size > 5000) sizeCache.clear();
  return { ...size, labels };
}

// Calcula a geometria local. Retorna { bounds, place(ox, oy) } ou null se o grafo estiver vazio.
// sizes: Map scopeId → { w, h } — tamanho ajustado pela alça (só na memória; nunca menor que o conteúdo).
export function layoutGraph(graph, theme, { strict = true, sizes = null } = {}) {
  if (!graph.nodes.length && !graph.scopes.length) return null;
  const style = { node: theme.node, scope: theme.scope };
  const s = style.node;
  const sc = style.scope;
  const types = resolveTypes(graph);
  const collapsedScopes = new Set(graph.scopes.filter((scope) => scope.collapsed).map((scope) => scope.id));

  const connected = new Set();
  for (const w of graph.wires) {
    connected.add(`${w.from.node}:out:${w.from.pin}`);
    connected.add(`${w.to.node}:in:${w.to.pin}`);
  }

  const local = new Map();
  for (const node of graph.nodes) {
    if (node.scopeId && collapsedScopes.has(node.scopeId)) continue;
    const def = getDef(node.type);
    const pins = nodePins(node, def, graph);
    const size = measureNode(graph, node, def, pins, style);
    local.set(node.id, { node, def, pins, ...size });
  }

  const scopeRects = new Map();
  for (const scope of graph.scopes) {
    const title = scopeTitle(graph, scope);
    if (scope.collapsed) {
      // Recolhida: um nó com cabeçalho e os pinos de parâmetro da entrada.
      const params = scopeParams(graph, scope.id).map((p) => ({ id: p.id, kind: 'data', type: p.type, label: p.name }));
      const w = Math.max(s.minWidth, textWidth(title, s.titleFont) + s.padding * 2 + 26, ...params.map((p) => textWidth(p.label, s.font) + 40));
      const h = s.headerHeight + Math.max(1, params.length) * s.rowHeight + 6;
      scopeRects.set(scope.id, { rect: { x: scope.x, y: scope.y, w, h }, origin: { x: scope.x + sc.padding, y: scope.y + sc.padding }, title, params });
      continue;
    }
    let minX = 0, minY = 0, maxX = 0, maxY = 0;
    for (const entry of local.values()) {
      if (entry.node.scopeId !== scope.id) continue;
      minX = Math.min(minX, entry.node.x);
      minY = Math.min(minY, entry.node.y);
      maxX = Math.max(maxX, entry.node.x + entry.w);
      maxY = Math.max(maxY, entry.node.y + entry.h);
    }
    const size = sizes?.get(scope.id);
    const w = Math.max(maxX - minX + sc.padding * 2, sc.minWidth, size?.w ?? 0);
    const h = Math.max(maxY - minY + sc.padding * 2, sc.minHeight, size?.h ?? 0);
    scopeRects.set(scope.id, {
      rect: { x: scope.x + minX, y: scope.y + minY, w, h },
      origin: { x: scope.x + sc.padding, y: scope.y + sc.padding },
      title,
    });
  }

  let bounds = null;
  const grow = (r) => {
    if (!bounds) bounds = { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h };
    else {
      bounds.minX = Math.min(bounds.minX, r.x);
      bounds.minY = Math.min(bounds.minY, r.y);
      bounds.maxX = Math.max(bounds.maxX, r.x + r.w);
      bounds.maxY = Math.max(bounds.maxY, r.y + r.h);
    }
  };
  for (const { rect } of scopeRects.values()) grow(rect);
  for (const entry of local.values()) if (!entry.node.scopeId || !scopeRects.has(entry.node.scopeId)) grow({ x: entry.node.x, y: entry.node.y, w: entry.w, h: entry.h });

  return {
    bounds: bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    place: (ox, oy) => placeGraph(graph, local, scopeRects, types, connected, style, ox, oy, strict),
  };
}

function placeGraph(graph, local, scopeRects, types, connected, style, ox, oy, strict) {
  const s = style.node;
  const sc = style.scope;

  const scopes = new Map();
  for (const scope of graph.scopes) {
    const r = scopeRects.get(scope.id);
    const rect = { x: r.rect.x + ox, y: r.rect.y + oy, w: r.rect.w, h: r.rect.h };
    const entryDef = getDef(scopeEntry(graph, scope.id)?.type);
    const placed = {
      scope,
      rect,
      origin: { x: r.origin.x + ox, y: r.origin.y + oy },
      title: r.title,
      collapsed: Boolean(scope.collapsed),
      color: s.categoryColors?.[topCategory(entryDef)] ?? (scope.kind === 'event' ? s.categoryColors?.Eventos : s.categoryColors?.['Funções']),
      // Expandida, o botão de recolher fica no cabeçalho do nó de entrada.
      toggle: scope.collapsed ? { x: rect.x + rect.w - 14, y: rect.y + s.headerHeight / 2 } : null,
      resize: scope.collapsed ? null : { x: rect.x + rect.w, y: rect.y + rect.h },
    };
    if (scope.collapsed) {
      placed.params = r.params.map((pin, i) => {
        const type = pin.type;
        return { pin, side: 'in', x: rect.x, y: rect.y + s.headerHeight + s.rowHeight * (i + 0.5), type, color: typeColor(type), shape: pinShape('data', type) };
      });
    }
    scopes.set(scope.id, placed);
  }

  const nodes = new Map();
  for (const entry of local.values()) {
    const { node, def, pins } = entry;
    const parent = node.scopeId ? scopes.get(node.scopeId)?.origin : null;
    const px = parent ? parent.x : ox;
    const py = parent ? parent.y : oy;
    const rect = { x: px + node.x, y: py + node.y, w: entry.w, h: entry.h };
    const template = entry.template;
    const subH = entry.labels.subtitle ? s.subtitleHeight : 0;
    let top;
    if (template === 'reroute') top = rect.y + rect.h / 2 - s.rowHeight / 2;
    else if (template === 'compact') top = rect.y + 4 + subH;
    else if (template === 'literal') top = rect.y + 4;
    else top = rect.y + s.headerHeight + subH;

    const place = (pin, i, side) => {
      const type = pinType(node, pin, types);
      const x = side === 'in' ? rect.x : rect.x + rect.w;
      const y = top + s.rowHeight * (i + 0.5);
      const isConnected = connected.has(`${node.id}:${side}:${pin.id}`);
      const out = { pin, side, x, y, type, color: pin.kind === 'flow' ? null : typeColor(type), shape: pinShape(pin.kind, type), connected: isConnected };
      if (side === 'in' && pin.kind === 'data' && !isConnected && template !== 'reroute') {
        const value = formatDefault(pinDefault(node, pin));
        const labelW = textWidth(pin.label, s.font);
        const w = Math.min(90, Math.max(24, textWidth(value, s.font) + 12));
        out.box = { x: x + s.pinGap + labelW + (labelW ? 4 : 0), y: y - (s.rowHeight - 8) / 2, w, h: s.rowHeight - 8, text: value };
      }
      return out;
    };
    const inputs = pins.inputs.map((pin, i) => place(pin, i, 'in'));
    const outputs = pins.outputs.map((pin, i) => place(pin, i, 'out'));
    const rows = Math.max(pins.inputs.length, pins.outputs.length);
    const addY = top + s.rowHeight * (rows + 0.5);
    if (template === 'comment') {
      nodes.set(node.id, {
        node,
        def,
        rect,
        template,
        title: entry.labels.title,
        text: node.fields?.text ?? '',
        color: node.fields?.color || s.categoryColors?.Outros,
        group: node.fields?.group !== false,
        inputs: [],
        outputs: [],
        resize: { x: rect.x + rect.w, y: rect.y + rect.h },
      });
      continue;
    }
    nodes.set(node.id, {
      node,
      def,
      rect,
      template,
      title: entry.labels.title,
      subtitle: entry.labels.subtitle,
      color: valueTypeColor(graph, node) ?? s.categoryColors?.[topCategory(def)] ?? s.categoryColors?.Outros,
      inputs,
      outputs,
      // Nó de cena: ícones no cabeçalho que abrem o script (📜) e a cena instanciada (🔗).
      // Só aparecem se o arquivo ainda existe (excluir esconde o ícone; desfazer traz de volta).
      links: def?.sceneNode ? sceneLinks(node, rect, s) : [],
      // Só a entrada de função/evento tem botão de recolher (recolhe a sub-área).
      toggle: template === 'event' && node.scopeId ? { x: rect.x + rect.w - 12, y: rect.y + s.headerHeight / 2 } : null,
      addIn: def?.dynamicInputs ? { x: rect.x + s.padding + 6, y: addY } : null,
      addOut: def?.dynamicOutputs ? { x: rect.x + rect.w - s.padding - 6, y: addY } : null,
    });
  }

  const wires = [];
  for (const wire of graph.wires) {
    const a = nodes.get(wire.from.node)?.outputs.find((p) => p.pin.id === wire.from.pin);
    const b = nodes.get(wire.to.node)?.inputs.find((p) => p.pin.id === wire.to.pin);
    if (!a || !b) continue;
    const invalid = wire.kind === 'data' && strict && !typesCompatible(a.type, b.type);
    const points = wirePoints(a, b, 'bezier');
    const placed = { wire, a, b, kind: wire.kind, color: wire.kind === 'flow' ? null : a.color, invalid, points };
    // Etiqueta: posição relativa ao longo do fio (label.at, 0–1), arrastável. Sinal conectado
    // mostra o método do script que recebe (→ _on_x()) mesmo sem etiqueta.
    const method = wire.kind === 'signal' && wire.method ? `→ ${wire.method}()` : '';
    const text = [wire.label ? wireLabelText(wire.label) : '', method].filter(Boolean).join('  ');
    if (wire.label || method) {
      const at = pointAlong(points, wire.label?.at ?? 0.5);
      const w = Math.max(28, textWidth(text, s.smallFont) + 14);
      const h = 18;
      placed.label = { x: at.x - w / 2, y: at.y - h / 2, w, h, text, color: wire.label?.color || null };
    }
    wires.push(placed);
  }

  return { scopes, nodes, wires, types };
}

function sceneLinks(node, rect, s) {
  const links = [];
  for (const [key, glyph] of [['script', '📜'], ['instance', '🔗']]) {
    const itemId = node.fields?.[key];
    if (resolveFile(itemId)) links.push({ x: rect.x + rect.w - 14 - links.length * 20, y: rect.y + s.headerHeight / 2, itemId, glyph });
  }
  return links;
}

function valueTypeColor(graph, node) {
  const type = valueType(graph, node);
  return type ? typeColor(type) : null;
}

// ---------- ordem de desenho ----------

// Camadas na ordem de desenho: sub-áreas (com seus fios e nós) e nós soltos no nível do
// script. Os "elevados" (último selecionado) vão por último (por cima) dentro da área pai;
// uma sub-área com nó elevado também sobe. freeWires: fios fora de sub-áreas (desenhados antes de tudo).
export function paintOrder(g, selectedNodes = EMPTY, selectedScopes = EMPTY) {
  const byScope = new Map();
  const free = [];
  for (const n of g.nodes.values()) {
    const sid = n.node.scopeId;
    if (sid && g.scopes.has(sid)) {
      if (!byScope.has(sid)) byScope.set(sid, []);
      byScope.get(sid).push(n);
    } else free.push(n);
  }
  const nodeUp = (n) => (selectedNodes.has(n.node.id) ? 1 : 0);
  const sortNodes = (list) => list.sort((a, b) => nodeUp(a) - nodeUp(b));
  const isComment = (n) => n.template === 'comment';

  const wiresByScope = new Map();
  const freeWires = [];
  for (const w of g.wires) {
    const sid = g.nodes.get(w.wire.from.node)?.node.scopeId;
    if (sid && g.scopes.has(sid)) {
      if (!wiresByScope.has(sid)) wiresByScope.set(sid, []);
      wiresByScope.get(sid).push(w);
    } else freeWires.push(w);
  }

  // Comentários ficam atrás de fios e nós do mesmo nível (back / comments).
  const layers = [];
  for (const sc of g.scopes.values()) {
    const all = sortNodes(byScope.get(sc.scope.id) ?? []);
    const up = selectedScopes.has(sc.scope.id) || all.some((n) => selectedNodes.has(n.node.id));
    layers.push({ scope: sc, comments: all.filter(isComment), nodes: all.filter((n) => !isComment(n)), wires: wiresByScope.get(sc.scope.id) ?? [], up });
  }
  const sortedFree = sortNodes(free);
  for (const n of sortedFree) if (!isComment(n)) layers.push({ node: n, up: selectedNodes.has(n.node.id) });
  layers.sort((a, b) => (a.up ? 1 : 0) - (b.up ? 1 : 0));
  return { back: sortedFree.filter(isComment), layers, freeWires };
}

const EMPTY = new Set();

// ---------- clique ----------

// Retorna { kind: 'gresize'|'gcresize'|'glabel'|'gtoggle'|'gadd'|'gdefault'|'gpin'|'gnode'|'gwire'|'gscope', ... } ou null (vazio).
// Testa na ordem inversa do desenho (paintOrder), para o clique pegar o que está por cima.
export function hitGraph(g, p, { pinRadius, wireTolerance, theme, raisedNodes, raisedScopes }) {
  const s = theme.node;
  const near = (pt, r = 8) => pt && Math.hypot(p.x - pt.x, p.y - pt.y) <= r;
  const hitWires = (wires) => {
    for (let i = wires.length - 1; i >= 0; i--) {
      if (wires[i].label && contains(wires[i].label, p)) return { kind: 'glabel', wireId: wires[i].wire.id };
    }
    for (let i = wires.length - 1; i >= 0; i--) {
      if (distanceToPolyline(p, wires[i].points) <= wireTolerance) return { kind: 'gwire', wireId: wires[i].wire.id, point: p };
    }
    return null;
  };
  // Comentário: só a alça e o cabeçalho respondem; o corpo deixa o clique passar (laço).
  const hitComment = (n) => {
    if (inGrip(n.resize, n.rect, p)) return { kind: 'gcresize', nodeId: n.node.id, rect: n.rect };
    if (contains(n.rect, p) && p.y < n.rect.y + s.headerHeight) return { kind: 'gnode', nodeId: n.node.id, part: 'header' };
    return null;
  };
  const hitList = (list, fn) => {
    for (let j = list.length - 1; j >= 0; j--) {
      const h = fn(list[j]);
      if (h) return h;
    }
    return null;
  };
  const hitNode = (n) => {
    const entry = n.template === 'event' && n.node.scopeId;
    const link = n.links?.find((l) => near(l, 9));
    if (link) return { kind: 'gscript', nodeId: n.node.id, itemId: link.itemId };
    if (near(n.toggle)) return entry ? { kind: 'gtoggle', scopeId: n.node.scopeId } : { kind: 'gtoggle', nodeId: n.node.id };
    if (near(n.addIn)) return { kind: 'gadd', nodeId: n.node.id, side: 'in' };
    if (near(n.addOut)) return { kind: 'gadd', nodeId: n.node.id, side: 'out' };
    for (const pin of n.inputs) {
      if (pin.box && contains(pin.box, p)) return { kind: 'gdefault', nodeId: n.node.id, pinId: pin.pin.id, box: pin.box };
    }
    for (const pin of [...n.inputs, ...n.outputs]) {
      if (Math.hypot(p.x - pin.x, p.y - pin.y) <= pinRadius) return { kind: 'gpin', nodeId: n.node.id, pinId: pin.pin.id, side: pin.side, pin };
    }
    if (!contains(n.rect, p)) return null;
    // A entrada funciona como o cabeçalho da sub-área (seleciona e move a sub-área).
    if (entry) return { kind: 'gscope', scopeId: n.node.scopeId, part: 'header' };
    return { kind: 'gnode', nodeId: n.node.id, part: hasHeader(n.template) && p.y < n.rect.y + s.headerHeight ? 'header' : 'body' };
  };

  const { back, layers, freeWires } = paintOrder(g, raisedNodes, raisedScopes);
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer.node) {
      const h = hitNode(layer.node);
      if (h) return h;
      continue;
    }
    const sc = layer.scope;
    if (sc.collapsed) {
      if (near(sc.toggle)) return { kind: 'gtoggle', scopeId: sc.scope.id };
      if (contains(sc.rect, p)) return { kind: 'gscope', scopeId: sc.scope.id, part: 'header' };
      continue;
    }
    if (inGrip(sc.resize, sc.rect, p)) return { kind: 'gresize', scopeId: sc.scope.id, rect: sc.rect };
    const h = hitList(layer.nodes, hitNode) ?? hitWires(layer.wires) ?? hitList(layer.comments, hitComment);
    if (h) return h;
    if (contains(sc.rect, p)) return { kind: 'gscope', scopeId: sc.scope.id, part: 'body' };
  }
  return hitWires(freeWires) ?? hitList(back, hitComment);
}
