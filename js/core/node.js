import { createPin } from './pin.js';

// Nó a partir da definição da linguagem: { id, title, category, inputs: [...], outputs: [...] }.
export function createNode(def, { id, x, y, scope }) {
  return {
    id,
    type: def.id,
    title: def.title,
    category: def.category ?? null,
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

// Tamanho do nó pelo conteúdo e posição de cada pino (relativa ao nó, em pin.cx / pin.cy).
// theme: tema (usa theme.node e theme.reroute); measure(text, font) → largura do texto.
export function layoutNode(node, theme, measure) {
  if (node.reroute) return layoutReroute(node, theme.reroute);
  const style = theme.node;
  const rows = Math.max(node.inputs.length, node.outputs.length);
  const side = style.pinInset + style.pinSize / 2 + style.labelGap; // espaço do pino até o nome
  let rowWidth = 0;
  for (let i = 0; i < rows; i++) {
    const left = node.inputs[i]?.label ? measure(node.inputs[i].label, style.labelFont) : 0;
    const right = node.outputs[i]?.label ? measure(node.outputs[i].label, style.labelFont) : 0;
    rowWidth = Math.max(rowWidth, side * 2 + left + right + style.columnGap);
  }
  const titleWidth = measure(node.title, style.titleFont) + style.padding * 2;
  node.w = Math.ceil(Math.max(style.minWidth, titleWidth, rowWidth));
  node.h = style.headerHeight + rows * style.rowHeight + style.bottomPadding;
  const rowY = (i) => style.headerHeight + i * style.rowHeight + style.rowHeight / 2;
  node.inputs.forEach((pin, i) => Object.assign(pin, { cx: style.pinInset, cy: rowY(i) }));
  node.outputs.forEach((pin, i) => Object.assign(pin, { cx: node.w - style.pinInset, cy: rowY(i) }));
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
