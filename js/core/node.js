import { createPin } from './pin.js';

// Nó a partir da definição da linguagem:
//   { id, title, category, tag, compact, inputs: [...], outputs: [...] }
//   tag: tipo de dado mostrado como etiqueta no cabeçalho; compact: nó de uma linha só.
export function createNode(def, { id, x, y, scope }) {
  return {
    id,
    type: def.id,
    title: def.title,
    category: def.category ?? null,
    tag: def.tag ?? null,
    compact: !!def.compact,
    reroute: !!def.reroute,
    x,
    y,
    w: 0,
    h: 0,
    scope,
    inputs: (def.inputs ?? []).map((p) => createPin(p, 'in')),
    outputs: (def.outputs ?? []).map((p) => createPin(p, 'out')),
  };
}

// Pino de execução que vai para o cabeçalho: o primeiro de fluxo sem nome, de cada lado.
// Pinos de fluxo com nome (ex.: verdadeiro / falso) ficam nas linhas do corpo.
export function headerPin(pins) {
  return pins.find((p) => p.kind === 'flow' && !p.label) ?? null;
}

// Texto da etiqueta de tipo do nó (ou null).
export function tagLabel(node, language) {
  if (!node.tag) return null;
  return language?.types?.[node.tag]?.tag ?? node.tag;
}

// Tamanho do nó pelo conteúdo e posição de cada parte (relativas ao nó):
//   pinos em pin.cx / pin.cy (e pin.size: tamanho no cabeçalho ou no corpo);
//   cabeçalho em node.layout { headerY, tagX, tagW, titleX, dividerY }.
// theme: tema (node, tag, reroute); measure(text, font) → largura do texto.
export function layoutNode(node, theme, measure, language) {
  if (node.reroute) return layoutReroute(node, theme.reroute);
  if (node.compact) return layoutCompact(node, theme, measure, language);
  const s = theme.node;
  const headerH = theme.tag.height;
  const headerY = s.padding + headerH / 2; // centro da linha do cabeçalho
  const execIn = headerPin(node.inputs);
  const execOut = headerPin(node.outputs);
  const hp = s.headerPinSize;

  // Cabeçalho: [execução] tag nome [execução]
  let x = s.padding;
  if (execIn) {
    Object.assign(execIn, { cx: x + hp / 2, cy: headerY, size: hp });
    x += hp + s.execGap;
  }
  const label = tagLabel(node, language);
  const tagW = label ? measure(label, theme.tag.font) + theme.tag.padX * 2 : 0;
  const tagX = x;
  if (label) x += tagW + theme.tag.gap;
  const titleX = x;
  x += measure(node.title, s.titleFont);
  if (execOut) x += s.execGap + hp;
  const headerWidth = x + s.padding;

  // Corpo: entradas à esquerda, saídas à direita, uma linha por par.
  const ins = node.inputs.filter((p) => p !== execIn);
  const outs = node.outputs.filter((p) => p !== execOut);
  const rows = Math.max(ins.length, outs.length);
  const side = s.padding + s.pinSize + s.labelGap;
  let rowWidth = 0;
  for (let i = 0; i < rows; i++) {
    const left = ins[i]?.label ? measure(ins[i].label, s.labelFont) : 0;
    const right = outs[i]?.label ? measure(outs[i].label, s.labelFont) : 0;
    rowWidth = Math.max(rowWidth, side * 2 + left + right + s.columnGap);
  }
  node.w = Math.ceil(Math.max(s.minWidth, headerWidth, rowWidth));
  const dividerY = rows ? s.padding + headerH + s.headerGap : null;
  const bodyTop = rows ? dividerY + 1 + s.headerGap : 0;
  const rowY = (i) => bodyTop + i * (s.lineHeight + s.rowGap) + s.lineHeight / 2;
  node.h = rows ? bodyTop + rows * s.lineHeight + (rows - 1) * s.rowGap + s.padding : s.padding * 2 + headerH;

  const leftX = s.padding + s.pinSize / 2;
  const rightX = node.w - s.padding - s.pinSize / 2;
  if (execOut) Object.assign(execOut, { cx: node.w - s.padding - hp / 2, cy: headerY, size: hp });
  ins.forEach((pin, i) => Object.assign(pin, { cx: leftX, cy: rowY(i), size: s.pinSize }));
  outs.forEach((pin, i) => Object.assign(pin, { cx: rightX, cy: rowY(i), size: s.pinSize }));
  node.layout = { headerY, tagX, tagW, titleX, dividerY };
  return node;
}

// Nó compacto, uma linha: [entrada] tag nome [saída] (ex.: "altura", "user").
// A linha é o próprio cabeçalho, então os pinos usam o tamanho do cabeçalho.
function layoutCompact(node, theme, measure, language) {
  const s = theme.node;
  const hp = s.headerPinSize;
  const headerH = theme.tag.height;
  const headerY = s.padding + headerH / 2;
  const [input] = node.inputs;
  const [output] = node.outputs;
  let x = s.padding;
  if (input) {
    Object.assign(input, { cx: x + hp / 2, cy: headerY, size: hp });
    x += hp + s.compactGap;
  }
  const label = tagLabel(node, language);
  const tagW = label ? measure(label, theme.tag.font) + theme.tag.padX * 2 : 0;
  const tagX = x;
  if (label) x += tagW + s.compactGap;
  const titleX = x;
  x += measure(node.title, s.titleFont);
  if (output) x += s.compactGap + hp;
  node.w = Math.ceil(x + s.padding);
  node.h = s.padding * 2 + headerH;
  if (output) Object.assign(output, { cx: node.w - s.padding - hp / 2, cy: headerY, size: hp });
  node.layout = { headerY, tagX, tagW, titleX, dividerY: null };
  return node;
}

// Reroute: a área de clique (w × h) é maior que o ponto visível. Os fios chegam no centro;
// os pinos para puxar fio ficam nas bordas (entrada de um lado, saída do outro); o meio arrasta.
function layoutReroute(node, style) {
  node.w = style.hitSize;
  node.h = style.hitSize;
  const c = style.hitSize / 2;
  const pin = { cy: c, ax: c, ay: c, hitRadius: style.pinHitRadius };
  node.inputs.forEach((p) => Object.assign(p, pin));
  node.outputs.forEach((p) => Object.assign(p, pin));
  setRerouteFlipped(node, false);
  return node;
}

// Reroute virado: o fio chega pela direita e sai pela esquerda (a saída fica à esquerda).
export function setRerouteFlipped(node, flipped) {
  node.flipped = flipped;
  node.inputs.forEach((p) => (p.cx = flipped ? node.w : 0));
  node.outputs.forEach((p) => (p.cx = flipped ? 0 : node.w));
}

// Para que lado o fio sai do pino: +1 direita, -1 esquerda.
export function pinDirection(node, pin) {
  const side = pin.direction === 'out' ? 1 : -1;
  return node.flipped ? -side : side;
}

// Ponto do mundo onde o fio encosta no pino.
export function pinAnchor(node, pin) {
  return { x: node.x + (pin.ax ?? pin.cx), y: node.y + (pin.ay ?? pin.cy) };
}

// Pino do nó perto do ponto do mundo (dentro do raio), ou null.
export function pinAt(node, p, radius) {
  for (const pin of [...node.inputs, ...node.outputs]) {
    if (Math.hypot(p.x - (node.x + pin.cx), p.y - (node.y + pin.cy)) <= (pin.hitRadius ?? radius)) return pin;
  }
  return null;
}
