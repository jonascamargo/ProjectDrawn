import { iconWidth } from './canvas/icons.js';
import { createPin } from './pin.js';

// Nó a partir da definição da linguagem:
//   { id, title, category, tag, icon, compact, fields: [...], inputs: [...], outputs: [...] }
//   fields: propriedades do inspetor; os valores ficam em node.values (ver applyFields).
//   tag: tipo de dado mostrado como etiqueta no cabeçalho; icon: ícone na etiqueta (no lugar do tipo);
//   compact: nó de uma linha só.
export function createNode(def, { id, x, y, scope, values = {} }) {
  const fields = def.fields ?? [];
  const node = {
    id,
    type: def.id,
    title: def.title,
    baseTitle: def.title,
    fields,
    values: Object.fromEntries(fields.map((f) => [f.id, values[f.id] ?? f.default])),
    category: def.category ?? null,
    tag: def.tag ?? null,
    icon: def.icon ?? null,
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
  return applyFields(node);
}

// Aplica os valores dos campos no nó: 'title' vira o título; 'type' vira o tipo dos pinos
// listados em `pins` (entrada e saída com esses ids) e da etiqueta. Com inferência ligada, a
// entrada de onde vem o tipo aceita qualquer um (fica no tipo padrão), senão não daria para trocar
// a origem por outro tipo. Depois, recalcular o layout.
export function applyFields(node) {
  const sources = activeInferences(node);
  for (const f of node.fields) {
    const value = node.values[f.id];
    if (f.sets === 'title') node.title = value || node.baseTitle;
    if (f.sets === 'type') {
      const open = new Set(sources.filter((i) => i.field === f.id).map((i) => i.from));
      for (const pin of node.inputs) if (f.pins?.includes(pin.id)) pin.type = open.has(pin.id) ? f.default : value;
      for (const pin of node.outputs) if (f.pins?.includes(pin.id)) pin.type = value;
      if (node.tag) node.tag = value;
    }
  }
  return node;
}

// Campos com inferência ligada: [{ field, from }] (o campo `field` vem do fio na entrada `from`).
export function activeInferences(node) {
  return node.fields.filter((f) => f.infer && node.values[f.id]).map((f) => f.infer);
}

// Pino de execução que vai para o cabeçalho: o primeiro de fluxo sem nome, de cada lado.
// Pinos de fluxo com nome (ex.: verdadeiro / falso) ficam nas linhas do corpo.
export function headerPin(pins) {
  return pins.find((p) => p.kind === 'flow' && !p.label) ?? null;
}

// Texto da etiqueta de tipo do nó (ou null; nó com ícone não mostra texto).
export function tagLabel(node, language) {
  if (!node.tag || node.icon) return null;
  return language?.types?.[node.tag]?.tag ?? node.tag;
}

// Ícone do nó, definido pela linguagem (arquivo, cor e medidas), ou null.
export function nodeIcon(node, language) {
  return (node.icon && language?.icons?.[node.icon]) || null;
}

// Largura da etiqueta: ícone (altura do tema, largura proporcional) ou texto, mais as margens.
function tagWidth(node, theme, measure, language) {
  const icon = nodeIcon(node, language);
  if (icon) return iconWidth(icon, theme.icon.size) + theme.tag.padX * 2;
  const label = tagLabel(node, language);
  return label ? measure(label, theme.tag.font) + theme.tag.padX * 2 : 0;
}

// Linhas do corpo: cada pino na sua linha; uma entrada e uma saída com o mesmo id e tipo de fio
// (o dado entra à esquerda e sai à direita) dividem a linha. Ordem: entradas (com o par), depois
// as saídas sem par.
export function bodyRows(ins, outs) {
  const used = new Set();
  const rows = ins.map((input) => {
    const output = outs.find((o) => !used.has(o) && o.id === input.id && o.kind === input.kind) ?? null;
    if (output) used.add(output);
    return [input, output];
  });
  for (const output of outs) if (!used.has(output)) rows.push([null, output]);
  return rows;
}

// Tamanho do nó pelo conteúdo e posição de cada parte (relativas ao nó):
//   pinos em pin.cx / pin.cy (e pin.size: tamanho no cabeçalho ou no corpo);
//   cabeçalho em node.layout { headerY, tagX, tagW, titleX, dividerY }.
// Cabeçalho: headerPad + etiqueta + headerPad (40px). Corpo: linhas de pinos, padding nas laterais e base.
// theme: tema (node, tag, icon, reroute); measure(text, font) → largura do texto.
export function layoutNode(node, theme, measure, language) {
  if (node.reroute) return layoutReroute(node, theme.reroute);
  if (node.compact) return layoutCompact(node, theme, measure, language);
  const s = theme.node;
  const headerH = s.headerPad * 2 + theme.tag.height;
  const headerY = headerH / 2; // centro da linha do cabeçalho
  const execIn = headerPin(node.inputs);
  const execOut = headerPin(node.outputs);
  const hp = s.headerPinSize;

  // Cabeçalho: [execução] etiqueta nome [execução]
  let x = s.padding;
  if (execIn) {
    Object.assign(execIn, { cx: x + hp / 2, cy: headerY, size: hp });
    x += hp + s.execGap;
  }
  const tagW = tagWidth(node, theme, measure, language);
  const tagX = x;
  if (tagW) x += tagW + theme.tag.gap;
  const titleX = x;
  x += measure(node.title, s.titleFont);
  if (execOut) x += s.execGap + hp;
  const headerWidth = x + s.padding;

  const rows = bodyRows(node.inputs.filter((p) => p !== execIn), node.outputs.filter((p) => p !== execOut));
  const side = s.padding + s.pinSize + s.labelGap;
  let rowWidth = 0;
  for (const [left, right] of rows) {
    const l = left?.label ? measure(left.label, s.labelFont) : 0;
    const r = right?.label ? measure(right.label, s.labelFont) : 0;
    rowWidth = Math.max(rowWidth, side * 2 + l + r + (l && r ? s.columnGap : 0));
  }
  node.w = Math.ceil(Math.max(s.minWidth, headerWidth, rowWidth));
  const dividerY = rows.length ? headerH : null;
  const bodyTop = headerH + 1 + s.headerGap;
  const rowY = (i) => bodyTop + i * (s.lineHeight + s.rowGap) + s.lineHeight / 2;
  node.h = rows.length ? bodyTop + rows.length * s.lineHeight + (rows.length - 1) * s.rowGap + s.padding : headerH;

  const leftX = s.padding + s.pinSize / 2;
  const rightX = node.w - s.padding - s.pinSize / 2;
  if (execOut) Object.assign(execOut, { cx: node.w - s.padding - hp / 2, cy: headerY, size: hp });
  rows.forEach(([left, right], i) => {
    if (left) Object.assign(left, { cx: leftX, cy: rowY(i), size: s.pinSize });
    if (right) Object.assign(right, { cx: rightX, cy: rowY(i), size: s.pinSize });
  });
  node.layout = { headerY, tagX, tagW, titleX, dividerY };
  return node;
}

// Nó compacto, uma linha (40px, como o cabeçalho): [entrada] etiqueta nome [saída] (ex.: "height", "user").
// A linha é o próprio cabeçalho, então os pinos usam o tamanho do cabeçalho.
function layoutCompact(node, theme, measure, language) {
  const s = theme.node;
  const hp = s.headerPinSize;
  const headerH = s.headerPad * 2 + theme.tag.height;
  const headerY = headerH / 2;
  const [input] = node.inputs;
  const [output] = node.outputs;
  let x = s.padding;
  if (input) {
    Object.assign(input, { cx: x + hp / 2, cy: headerY, size: hp });
    x += hp + s.compactGap;
  }
  const tagW = tagWidth(node, theme, measure, language);
  const tagX = x;
  if (tagW) x += tagW + s.compactGap;
  const titleX = x;
  x += measure(node.title, s.titleFont);
  if (output) x += s.compactGap + hp;
  node.w = Math.ceil(x + s.padding);
  node.h = headerH;
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
