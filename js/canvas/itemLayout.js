import { fileTypeOf } from '../lang/profileLoader.js';

// Calcula a geometria (em coordenadas do mundo) de todos os itens visíveis.
//
// Coordenadas: item.x/y é local, relativo à "origem de conteúdo" do pai.
// A origem de conteúdo de um item fica em (x + padding, y + header + padding),
// então um filho em (0, 0) faz a área expandida começar exatamente no canto do item.
// A área cresce para a direita/baixo acompanhando os filhos e para a esquerda/cima
// só se algum filho tiver coordenada negativa.
//
// Fios cujo item de origem/destino está escondido (dentro de uma pasta recolhida)
// são ancorados no ancestral visível mais próximo, que ganha um pino por conexão.

// options.detached: itens sendo arrastados com Ctrl — continuam desenhados, mas não
// entram no cálculo do tamanho da área do pai (a área "congela").
export function computeLayout(project, theme, { detached = null } = {}) {
  const cfg = theme.canvas.item;
  const pad = cfg.padding;
  const header = cfg.headerHeight;

  const visible = new Set();
  const markVisible = (parentId) => {
    for (const child of project.children(parentId)) {
      visible.add(child.id);
      if (child.expanded) markVisible(child.id);
    }
  };
  markVisible(null);

  const visibleEnd = (id) => {
    let item = project.get(id);
    while (item && !visible.has(item.id)) item = item.parentId ? project.get(item.parentId) : null;
    return item?.id ?? null;
  };

  const proxies = new Map();
  const proxyList = (id, side) => {
    if (!proxies.has(id)) proxies.set(id, { in: [], out: [] });
    return proxies.get(id)[side];
  };

  const wires = [];
  const connected = new Map();
  const markConnected = (id, side) => {
    if (!connected.has(id)) connected.set(id, { in: false, out: false });
    connected.get(id)[side] = true;
  };

  for (const relation of project.relations.values()) {
    const from = visibleEnd(relation.from);
    const to = visibleEnd(relation.to);
    if (!from || !to || from === to) continue;
    const wire = { relation, from, to, fromProxy: -1, toProxy: -1 };
    if (from !== relation.from) {
      const list = proxyList(from, 'out');
      wire.fromProxy = list.push(relation) - 1;
    } else {
      markConnected(from, 'out');
    }
    if (to !== relation.to) {
      const list = proxyList(to, 'in');
      wire.toProxy = list.push(relation) - 1;
    } else {
      markConnected(to, 'in');
    }
    wires.push(wire);
  }

  // Retângulos locais (no espaço de conteúdo do pai), de baixo para cima.
  const local = new Map();
  const measure = (item) => {
    let rect;
    if (item.expanded) {
      let minX = 0, minY = 0, maxX = 0, maxY = 0;
      for (const child of project.children(item.id)) {
        const r = measure(child);
        if (detached?.has(child.id)) continue;
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.w);
        maxY = Math.max(maxY, r.y + r.h);
      }
      const w = Math.max(maxX - minX + pad * 2, cfg.minAreaWidth);
      const h = Math.max(maxY - minY + pad * 2 + header, cfg.minAreaHeight);
      rect = { x: item.x + minX, y: item.y + minY, w, h };
    } else {
      const p = proxies.get(item.id);
      const count = p ? Math.max(p.in.length, p.out.length) : 0;
      const h = cfg.cardHeight + (count ? count * cfg.proxySpacing + 4 : 0);
      rect = { x: item.x, y: item.y, w: cfg.cardWidth, h };
    }
    local.set(item.id, rect);
    return rect;
  };
  for (const item of project.children(null)) measure(item);

  // Posições no mundo, de cima para baixo, na ordem de desenho.
  const entries = new Map();
  const order = [];
  const place = (parentId, ox, oy, depth) => {
    for (const item of project.children(parentId)) {
      const lr = local.get(item.id);
      const rect = { x: lr.x + ox, y: lr.y + oy, w: lr.w, h: lr.h };
      const origin = { x: ox + item.x + pad, y: oy + item.y + header + pad };
      const pinY = item.expanded ? rect.y + header / 2 : rect.y + cfg.cardHeight / 2;
      const p = proxies.get(item.id);
      const proxyY = (i) => rect.y + cfg.cardHeight + cfg.proxySpacing * (i + 0.5);
      const entry = {
        item,
        rect,
        origin,
        depth,
        expanded: item.expanded,
        fileType: item.kind === 'folder' ? null : fileTypeOf(item.name),
        childCount: project.children(item.id).length,
        inPin: { x: rect.x, y: pinY },
        outPin: { x: rect.x + rect.w, y: pinY },
        connected: connected.get(item.id) ?? { in: false, out: false },
        proxiesIn: (p?.in ?? []).map((relation, i) => ({ relation, x: rect.x, y: proxyY(i) })),
        proxiesOut: (p?.out ?? []).map((relation, i) => ({ relation, x: rect.x + rect.w, y: proxyY(i) })),
      };
      entries.set(item.id, entry);
      order.push(item.id);
      if (item.expanded) place(item.id, origin.x, origin.y, depth + 1);
    }
  };
  place(null, 0, 0, 0);

  for (const wire of wires) {
    const a = entries.get(wire.from);
    const b = entries.get(wire.to);
    wire.a = wire.fromProxy >= 0 ? a.proxiesOut[wire.fromProxy] : a.outPin;
    wire.b = wire.toProxy >= 0 ? b.proxiesIn[wire.toProxy] : b.inPin;
  }

  return { entries, order, wires, header };
}

export function contains(rect, p) {
  return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
}

export function intersects(a, b) {
  const bw = b.w ?? b.width;
  const bh = b.h ?? b.height;
  return a.x <= b.x + bw && a.x + a.w >= b.x && a.y <= b.y + bh && a.y + a.h >= b.y;
}

// Item mais acima no ponto p. part: 'pin-in' | 'pin-out' | 'card' | 'header' | 'body'
export function hitTest(layout, p, pinRadius) {
  for (let i = layout.order.length - 1; i >= 0; i--) {
    const entry = layout.entries.get(layout.order[i]);
    if (Math.hypot(p.x - entry.outPin.x, p.y - entry.outPin.y) <= pinRadius) return { entry, part: 'pin-out' };
    if (Math.hypot(p.x - entry.inPin.x, p.y - entry.inPin.y) <= pinRadius) return { entry, part: 'pin-in' };
    if (contains(entry.rect, p)) {
      const part = !entry.expanded ? 'card' : p.y < entry.rect.y + layout.header ? 'header' : 'body';
      return { entry, part };
    }
  }
  return null;
}

// Pasta mais acima no ponto p (ignorando itens em `exclude` e seus descendentes).
// Retorna { id, collapsed } — id null = raiz do projeto.
export function containerAt(layout, project, p, exclude = new Set()) {
  for (let i = layout.order.length - 1; i >= 0; i--) {
    const entry = layout.entries.get(layout.order[i]);
    const item = entry.item;
    if (item.kind !== 'folder') continue;
    if (exclude.has(item.id) || project.ancestors(item.id).some((a) => exclude.has(a.id))) continue;
    if (contains(entry.rect, p)) return { id: item.id, collapsed: !entry.expanded };
  }
  return { id: null, collapsed: false };
}

export function contentOrigin(layout, parentId) {
  if (parentId === null) return { x: 0, y: 0 };
  return layout.entries.get(parentId)?.origin ?? { x: 0, y: 0 };
}

export function resolveColor(theme, value) {
  if (!value) return null;
  if (value.startsWith('palette:')) return theme.palette?.[value.slice(8)] ?? null;
  return value;
}
