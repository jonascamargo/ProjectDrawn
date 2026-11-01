import { createPin } from './pin.js';

// Nó a partir da definição da linguagem: { id, title, category, inputs: [...], outputs: [...] }.
export function createNode(def, { id, x, y, scope }) {
  return {
    id,
    type: def.id,
    title: def.title,
    category: def.category ?? null,
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
// style: medidas do tema; measure(text, font) → largura do texto.
export function layoutNode(node, style, measure) {
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

// Pino do nó perto do ponto do mundo (dentro do raio), ou null.
export function pinAt(node, p, radius) {
  for (const pin of [...node.inputs, ...node.outputs]) {
    if (Math.hypot(p.x - (node.x + pin.cx), p.y - (node.y + pin.cy)) <= radius) return pin;
  }
  return null;
}
