import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortcuts } from '../js/config/shortcuts.js';
import { filterNodes, normalize } from '../js/core/canvas/nodeMenu.js';
import { keyAction, matchCombo, parseCombo } from '../js/core/keys.js';
import { bodyRows, createNode, headerPin, layoutNode, pinAt, tagLabel } from '../js/core/node.js';
import { createPin, describePin } from '../js/core/pin.js';
import { getWireKind, kindsConnect, registerWireKind } from '../js/core/wireKinds.js';
import { language } from '../js/lang/teste/index.js';
import { theme } from '../js/theme/default.js';

const measure = (text) => text.length * 7;
const key = (k, extra = {}) => ({ key: k, code: k, ...extra });

test('atalhos: combinações', () => {
  assert.deepEqual(parseCombo('Ctrl+Shift+A'), { key: 'A', ctrl: true, shift: true, alt: false });
  assert.ok(matchCombo('Ctrl+A', key('a', { ctrlKey: true })));
  assert.ok(matchCombo('Ctrl+A', key('a', { metaKey: true })));
  assert.ok(!matchCombo('Ctrl+A', key('a')));
  assert.ok(!matchCombo('F', key('f', { ctrlKey: true })));
  assert.ok(matchCombo('F', key('F')));
});

test('atalhos: ação pelo arquivo de atalhos', () => {
  assert.equal(keyAction(shortcuts.keys, key('a', { ctrlKey: true })), 'selectAll');
  assert.equal(keyAction(shortcuts.keys, key('Backspace')), 'deleteSelection');
  assert.equal(keyAction(shortcuts.keys, key('Home')), 'zoomReset');
  assert.equal(keyAction(shortcuts.keys, key('x')), null);
});

test('tipos de fio: os 4 básicos e registro de novos', () => {
  for (const id of ['flow', 'data', 'condition', 'config']) assert.equal(getWireKind(id).id, id);
  registerWireKind({ id: 'teste', label: 'teste', maxIn: 2, maxOut: 3 });
  assert.equal(getWireKind('teste').maxOut, 3);
  assert.ok(kindsConnect('teste', 'teste'));
  assert.throws(() => getWireKind('nada'));
});

test('pino: limite padrão vem do tipo de fio; definição pode mudar', () => {
  assert.equal(createPin({ id: 'a', kind: 'data' }, 'in').max, 1);
  assert.equal(createPin({ id: 'a', kind: 'data' }, 'out').max, null);
  assert.equal(createPin({ id: 'a', kind: 'flow' }, 'in').max, null);
  assert.equal(createPin({ id: 'a', kind: 'flow' }, 'out').max, 1);
  assert.equal(createPin({ id: 'a', kind: 'data', max: 3 }, 'in').max, 3);
  assert.equal(createPin({ id: 'a', kind: 'flow', max: null }, 'out').max, null);
});

test('pino: texto da dica', () => {
  const pin = createPin({ id: 'a', kind: 'data', type: 'number' }, 'in');
  assert.equal(describePin(pin, 'number'), 'dados · number · entrada · até 1 fio');
  const flow = createPin({ id: 'b', kind: 'flow' }, 'in');
  assert.equal(describePin(flow), 'fluxo · entrada · fios sem limite');
});

test('nó: fluxo sem nome vai para o cabeçalho; cada pino do corpo na sua linha', () => {
  const node = createNode(language.node('if'), { id: 1, x: 10, y: 20, scope: 'root' });
  assert.equal(node.title, 'If');
  assert.deepEqual(node.inputs.map((p) => p.kind), ['flow', 'condition']);
  assert.deepEqual(node.outputs.map((p) => p.kind), ['flow', 'flow']);
  assert.equal(headerPin(node.inputs), node.inputs[0]);
  assert.equal(headerPin(node.outputs), null); // true / false têm nome
  layoutNode(node, theme, measure, language);
  const s = theme.node;
  const headerH = s.headerPad * 2 + theme.tag.height;
  assert.equal(headerH, 40);
  assert.equal(node.inputs[0].cy, 20); // centro do cabeçalho
  assert.equal(node.inputs[0].cx, s.padding + s.headerPinSize / 2);
  assert.equal(node.inputs[0].size, s.headerPinSize);
  assert.equal(node.inputs[1].size, s.pinSize);
  // Corpo: condition / true / false, uma linha cada (não são o mesmo pino).
  const bodyTop = headerH + 1 + s.headerGap;
  const row = (i) => bodyTop + i * (s.lineHeight + s.rowGap) + s.lineHeight / 2;
  assert.equal(node.layout.dividerY, headerH);
  assert.equal(node.inputs[1].cy, row(0));
  assert.equal(node.outputs[0].cy, row(1));
  assert.equal(node.outputs[1].cy, row(2));
  assert.equal(node.outputs[1].cx, node.w - s.padding - s.pinSize / 2);
  assert.equal(node.h, bodyTop + 3 * s.lineHeight + 2 * s.rowGap + s.padding);
  // Linha mais larga: "condition" (9 letras), sozinha.
  const side = s.padding + s.pinSize + s.labelGap;
  assert.equal(node.w, Math.max(s.minWidth, Math.ceil(side * 2 + 9 * 7)));
});

test('linhas do corpo: entrada e saída com o mesmo id dividem a linha; o resto fica sozinho', () => {
  const pin = (id, kind = 'data') => ({ id, kind });
  const [cfg, vin] = [pin('config', 'config'), pin('value')];
  const [vout, extra] = [pin('value'), pin('extra')];
  assert.deepEqual(bodyRows([cfg, vin], [vout, extra]), [[cfg, null], [vin, vout], [null, extra]]);
  assert.deepEqual(bodyRows([], [vout]), [[null, vout]]); // só saída
  assert.deepEqual(bodyRows([vin], []), [[vin, null]]); // só entrada
  assert.deepEqual(bodyRows([pin('value', 'config')], [vout]), [[pin('value', 'config'), null], [null, vout]]); // tipo de fio diferente
  const v = layoutNode(createNode(language.node('variable'), { id: 1, x: 0, y: 0 }), theme, measure, language);
  assert.equal(v.inputs[1].cy, v.outputs[0].cy); // value ↔ value na mesma linha
  assert.ok(v.inputs[0].cy < v.inputs[1].cy); // config antes, sozinho
});

test('nó: execução dos dois lados do cabeçalho; sem corpo, 40px de altura', () => {
  const node = layoutNode(createNode({
    id: 'x', title: 'idade', tag: 'number',
    inputs: [{ id: 'run', kind: 'flow' }], outputs: [{ id: 'next', kind: 'flow' }],
  }, { id: 1, x: 0, y: 0 }), theme, measure, language);
  const s = theme.node;
  assert.equal(tagLabel(node, language), 'num');
  assert.equal(node.layout.tagX, s.padding + s.headerPinSize + s.execGap);
  assert.equal(node.layout.tagW, 3 * 7 + theme.tag.padX * 2);
  assert.equal(node.layout.titleX, node.layout.tagX + node.layout.tagW + theme.tag.gap);
  assert.equal(node.layout.dividerY, null); // sem corpo
  assert.equal(node.h, 40);
  assert.equal(node.outputs[0].cx, node.w - s.padding - s.headerPinSize / 2);
  assert.equal(node.outputs[0].cy, node.inputs[0].cy);
  assert.equal(node.w, Math.max(s.minWidth, node.layout.titleX + 5 * 7 + s.execGap + s.headerPinSize + s.padding));
});

test('nó compacto: uma linha de 40px, pino – tag – nome – pino', () => {
  const node = layoutNode(createNode(language.node('number'), { id: 1, x: 0, y: 0 }), theme, measure, language);
  const s = theme.node;
  assert.equal(node.h, 40);
  assert.equal(node.inputs[0].cy, 20);
  assert.equal(node.inputs[0].cx, s.padding + s.headerPinSize / 2);
  assert.equal(node.inputs[0].size, s.headerPinSize);
  assert.equal(node.layout.tagX, s.padding + s.headerPinSize + s.compactGap);
  assert.equal(node.layout.titleX, node.layout.tagX + node.layout.tagW + s.compactGap);
  assert.equal(node.w, Math.ceil(node.layout.titleX + 6 * 7 + s.compactGap + s.headerPinSize + s.padding));
  assert.equal(node.outputs[0].cy, node.inputs[0].cy);
  const user = layoutNode(createNode(language.node('text'), { id: 2, x: 0, y: 0 }), theme, measure, language);
  assert.equal(user.inputs.length, 0);
  assert.equal(user.layout.tagX, s.padding); // sem pino de entrada
});

test('nó: achar o pino no ponto', () => {
  const node = layoutNode(createNode(language.node('add'), { id: 1, x: 100, y: 100, scope: 'root' }), theme, measure);
  const b = node.inputs[1];
  assert.equal(pinAt(node, { x: 100 + b.cx + 3, y: 100 + b.cy - 2 }, 9), b);
  assert.equal(pinAt(node, { x: 100 + node.w / 2, y: 100 + 5 }, 9), null);
});

test('linguagem de teste: todo pino tem tipo de fio conhecido e cada tipo de fio aparece', () => {
  const kinds = new Set();
  for (const def of language.nodes) {
    for (const p of [...(def.inputs ?? []), ...(def.outputs ?? [])]) {
      getWireKind(p.kind);
      kinds.add(p.kind);
      if (p.type) assert.ok(language.types[p.type], `tipo ${p.type}`);
    }
    assert.equal(typeof def.category, 'string', `categoria de ${def.id}`);
  }
  assert.deepEqual([...kinds].sort(), ['condition', 'config', 'data', 'flow']);
});

test('menu: busca sem acento, título que começa com a busca primeiro', () => {
  assert.equal(normalize('Matemática'), 'matematica'); // busca sem acento continua valendo
  assert.deepEqual(filterNodes(language.nodes, '').length, language.nodes.length);
  assert.deepEqual(filterNodes(language.nodes, 'math').map((d) => d.id), ['add']);
  // "i": Início e Imprimir começam com i; os outros só contêm (Maior, Lógica, Matemática, Variável).
  assert.deepEqual(filterNodes([{ title: 'Ação' }, { title: 'Início' }], 'acao').map((d) => d.title), ['Ação']);
  // "i": If começa com i; os outros só contêm (no título ou na categoria).
  assert.deepEqual(filterNodes(language.nodes, 'i').map((d) => d.id), ['if', 'file', 'class', 'function', 'call', 'print', 'greater', 'and', 'variable', 'number']);
  assert.deepEqual(filterNodes(language.nodes, 'to t').map((d) => d.id), ['to_text']);
  assert.deepEqual(filterNodes(language.nodes, 'zzz'), []);
});

test('formas dos pinos: arredondadas e no tamanho total (contorno por dentro)', async () => {
  const { drawShape } = await import('../js/core/canvas/shapes.js');
  const { fakeContext } = await import('./fakeDom.js');
  for (const [name, expected] of [['circle', 'arc'], ['square', 'roundRect'], ['diamond', 'rotate'], ['triangle', 'lineTo']]) {
    const calls = [];
    const ctx = fakeContext(calls);
    drawShape(ctx, name, 50, 50, 12, { color: '#fff', fill: '#000', lineWidth: 2 });
    assert.ok(calls.some((c) => c[0] === expected), name);
    assert.equal(ctx.lineJoin, 'round');
    if (name === 'circle') assert.equal(calls.find((c) => c[0] === 'arc')[3], 5); // (12 - 2) / 2
    if (name === 'square') assert.deepEqual(calls.find((c) => c[0] === 'roundRect').slice(1, 5), [45, 45, 10, 10]);
  }
});
