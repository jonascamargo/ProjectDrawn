import { iconWidth } from './canvas/icons.js';
import { createPin } from './pin.js';
import { editorOf, formatValue } from './values.js';

// Nó a partir da definição da linguagem:
//   { id, title, category, tag, icon, compact, area, contains, fields: [...], inputs: [...], outputs: [...] }
//   fields: propriedades do inspetor; os valores ficam em node.values (ver applyFields).
//   tag: tipo de dado mostrado como etiqueta no cabeçalho; icon: ícone na etiqueta (no lugar do tipo);
//   compact: nó de uma linha só.
//   area: nó que contém outros (pasta, arquivo, classe, função); contains: o que ele aceita dentro
//   (ids de definição, ou '@script' para qualquer nó comum). open: aberta ou fechada.
//   script: área que é um ambiente de script (arquivo de código); pathable: solto num script vira
//   um nó de caminho (pasta, arquivo).
//   references: { get, set, pin } — ids das definições dos nós de referência que este nó gera e o
//   pino de onde vem o tipo; reference: 'get' | 'set' — este nó é uma referência (node.ref = id do alvo).
//   inputValues: valores digitados nos pinos de entrada de dados (por id do pino; ver values.js).
export function createNode(def, { id, x, y, scope, values = {}, open = true, ref = null, inputValues = {} }) {
  const fields = def.fields ?? [];
  const node = {
    id,
    type: def.id,
    title: def.title,
    baseTitle: def.title,
    fields,
    values: Object.fromEntries(fields.map((f) => [f.id, values[f.id] ?? f.default])),
    inputValues: { ...inputValues },
    category: def.category ?? null,
    tag: def.tag ?? null,
    icon: def.icon ?? null,
    compact: !!def.compact,
    reroute: !!def.reroute,
    area: !!def.area,
    script: !!def.script,
    pathable: !!def.pathable,
    references: def.references ?? null,
    reference: def.reference ?? null,
    ref, // referência: id do nó de origem (ex.: a variável)
    broken: false, // referência cujo alvo foi apagado
    outOfReach: false, // referência fora do alcance do alvo (onde os dois estão agora)
    contains: def.contains ?? [],
    open: def.area ? open : undefined,
    manual: def.area ? { w: 0, h: 0 } : undefined, // tamanho mínimo pelo puxador
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
      // (componentes de pinos abertos têm id próprio, 'value.x', e não entram aqui)
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

// Pinos que aparecem: sem os abertos (que deram lugar aos componentes) e sem os opcionais
// desligados (when: campo checkbox desmarcado).
export function shownPins(node, side) {
  const pins = side === 'in' ? node.inputs : side === 'out' ? node.outputs : [...node.inputs, ...node.outputs];
  return pins.filter((p) => !p.split && (!p.when || node.values[p.when]));
}

// Pino de dado com componentes (ex.: Vector3 → x, y, z) pode ser aberto, um pino por componente.
export function canSplit(pin, typeDef) {
  return pin.kind === 'data' && !pin.split && pin.parent == null && !!typeDef?.components && !!typeDef.componentType;
}

// Abre o pino: os componentes entram logo depois dele (id 'value.x', tipo do componente) e ele some.
export function splitPin(node, pin, typeDef) {
  const list = pin.direction === 'in' ? node.inputs : node.outputs;
  const base = pin.label || pin.id;
  const parts = typeDef.components.map((c, index) => Object.assign(
    createPin({ id: `${pin.id}.${c}`, label: `${base}.${c}`, kind: 'data', type: typeDef.componentType }, pin.direction),
    { parent: pin.id, index },
  ));
  list.splice(list.indexOf(pin) + 1, 0, ...parts);
  pin.split = true;
  return parts;
}

// Fecha o pino: os componentes saem e ele volta.
export function recombinePin(node, pin) {
  const key = pin.direction === 'in' ? 'inputs' : 'outputs';
  node[key] = node[key].filter((p) => p.parent !== pin.id);
  pin.split = false;
}

// O nó tem algum pino aberto?
function hasSplit(node) {
  return [...node.inputs, ...node.outputs].some((p) => p.split);
}

// Componentes de um pino aberto.
export function partsOf(node, pin) {
  return (pin.direction === 'in' ? node.inputs : node.outputs).filter((p) => p.parent === pin.id);
}

// Escopo dos pinos do nó: os pinos do cabeçalho de uma área contam como de dentro dela.
export function pinScope(node) {
  return node.area ? node.id : node.scope;
}

// A lista `contains` aceita esta definição? (ids, ou '@script' = qualquer nó comum)
export function containsDef(contains, def) {
  return contains.includes(def.id) || (contains.includes('@script') && !def.area && !def.reroute);
}

// A área aceita esta definição dentro dela? (sem área: a raiz, que aceita tudo)
export function accepts(area, def) {
  return area ? containsDef(area.contains, def) : true;
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

// Pino de entrada de dados que tem valor digitado (o tipo tem editor). Nó compacto não mostra valor.
export function hasValue(node, pin, language) {
  return !node.compact && pin.direction === 'in' && pin.kind === 'data' && !!editorOf(language?.types?.[pin.type]);
}

// Texto do valor do pino, como aparece no nó (ex.: 5, 1.5, "abc", (0, 0, 0)). Componente de um
// pino aberto mostra a parte dele do valor do pino de origem.
export function valueText(node, pin, language) {
  const type = language?.types?.[pin.type];
  if (pin.parent != null) return formatValue(type, node.inputValues[pin.parent]?.[pin.index]);
  return formatValue(type, node.inputValues[pin.id]);
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
  if (node.area) return layoutArea(node, theme, measure, language);
  // Compacto com pino aberto (ex.: get de um Vector3 aberto em x, y, z) vira nó normal, um pino por linha.
  if (node.compact && !hasSplit(node)) return layoutCompact(node, theme, measure, language);
  const s = theme.node;
  const headerH = s.headerPad * 2 + theme.tag.height;
  const headerY = headerH / 2; // centro da linha do cabeçalho
  const ins = shownPins(node, 'in');
  const outs = shownPins(node, 'out');
  const execIn = headerPin(ins);
  const execOut = headerPin(outs);
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

  const rows = bodyRows(ins.filter((p) => p !== execIn), outs.filter((p) => p !== execOut));
  const side = s.padding + s.pinSize + s.labelGap;
  // Texto de um pino: o nome, ou o valor (o que for mais largo, para caber os dois casos: com e sem fio).
  const width = (pin) => {
    if (!pin) return 0;
    const label = pin.label ? measure(pin.label, s.labelFont) : 0;
    return hasValue(node, pin, language) ? Math.max(label, measure(valueText(node, pin, language), s.labelFont)) : label;
  };
  let rowWidth = 0;
  for (const [left, right] of rows) {
    // Par (entrada e saída do mesmo dado): um texto só, no meio da linha.
    if (left && right) Object.assign(left, { pair: right }) && Object.assign(right, { pair: left });
    else for (const pin of [left, right]) if (pin) pin.pair = null;
    const w = left && right ? width(left) : width(left) + width(right) + (left?.label && right?.label ? s.columnGap : 0);
    rowWidth = Math.max(rowWidth, side * 2 + w);
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
  const [input] = shownPins(node, 'in');
  const [output] = shownPins(node, 'out');
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

// Área: o cabeçalho é uma linha de 40px — [ícone] nome [execução] [⇕] — que vira o nó inteiro
// quando fechada, e fica no canto superior esquerdo (a theme.area.pad da borda) quando aberta.
// Medidas do cabeçalho em node.layout (relativas ao cabeçalho); pinos com hx/hy no cabeçalho.
// O tamanho da área aberta vem do conteúdo (Scene.fitAreas).
function layoutArea(node, theme, measure, language) {
  const s = theme.node;
  const a = theme.area;
  const hp = s.headerPinSize;
  const headerH = s.headerPad * 2 + theme.tag.height;
  const headerY = headerH / 2;
  let x = s.padding;
  const tagW = tagWidth(node, theme, measure, language);
  const tagX = x;
  if (tagW) x += tagW + theme.tag.gap;
  const titleX = x;
  x += measure(node.title, s.titleFont);
  const execOut = headerPin(shownPins(node, 'out'));
  if (execOut) {
    x += s.execGap;
    Object.assign(execOut, { hx: x + hp / 2, hy: headerY, size: hp });
    x += hp;
  }
  x += a.toggleGap;
  const toggleX = x;
  const toggleW = a.toggleSize;
  x += toggleW;
  const headerW = Math.ceil(x + s.padding);
  node.layout = { headerY, tagX, tagW, titleX, toggleX, toggleW, headerW, headerH, dividerY: null };
  return placeArea(node, theme);
}

// Posição do cabeçalho da área (relativa à área) e dos pinos; fechada, o tamanho é o do cabeçalho.
function placeArea(node, theme) {
  const offset = node.open ? theme.area.pad : 0;
  node.layout.headerX = offset;
  node.layout.headerTop = offset;
  for (const pin of [...node.inputs, ...node.outputs]) {
    if (pin.hx !== undefined) Object.assign(pin, { cx: pin.hx + offset, cy: pin.hy + offset });
  }
  if (!node.open) {
    node.w = node.layout.headerW;
    node.h = node.layout.headerH;
  } else {
    node.w = Math.max(node.w, node.layout.headerW + offset * 2);
    node.h = Math.max(node.h, node.layout.headerH + offset * 2);
  }
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

// Pino visível do nó perto do ponto do mundo (dentro do raio), ou null.
export function pinAt(node, p, radius) {
  for (const pin of shownPins(node)) {
    if (Math.hypot(p.x - (node.x + pin.cx), p.y - (node.y + pin.cy)) <= (pin.hitRadius ?? radius)) return pin;
  }
  return null;
}
