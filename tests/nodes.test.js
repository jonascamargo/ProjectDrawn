import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortcuts } from '../js/config/shortcuts.js';
import { filterNodes, normalize } from '../js/core/canvas/nodeMenu.js';
import { keyAction, matchCombo, parseCombo } from '../js/core/keys.js';
import { createNode, layoutNode, pinAt } from '../js/core/node.js';
import { createPin, describePin } from '../js/core/pin.js';
import { getWireKind, registerWireKind, wireKinds } from '../js/core/wireKinds.js';
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
  assert.deepEqual(wireKinds().map((k) => k.id).slice(0, 4), ['flow', 'data', 'condition', 'config']);
  registerWireKind({ id: 'teste', label: 'teste', maxIn: 2, maxOut: 3 });
  assert.equal(getWireKind('teste').maxOut, 3);
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
  assert.equal(describePin(pin, 'número'), 'dados · número · entrada · até 1 fio');
  const flow = createPin({ id: 'b', kind: 'flow' }, 'in');
  assert.equal(describePin(flow), 'fluxo · entrada · fios sem limite');
});

test('nó: criado da definição e com tamanho pelo conteúdo', () => {
  const node = createNode(language.node('if'), { id: 1, x: 10, y: 20, scope: 'root' });
  assert.equal(node.title, 'Se');
  assert.deepEqual(node.inputs.map((p) => p.kind), ['flow', 'data']);
  assert.deepEqual(node.outputs.map((p) => p.kind), ['condition', 'condition']);
  layoutNode(node, theme.node, measure);
  const s = theme.node;
  assert.equal(node.h, s.headerHeight + 2 * s.rowHeight + s.bottomPadding);
  assert.ok(node.w >= s.minWidth);
  // Linha mais larga: "condição" (8 letras) à esquerda + "falso" (5) à direita → passa dos 140 mínimos.
  const side = s.pinInset + s.pinSize / 2 + s.labelGap;
  assert.equal(node.w, Math.ceil(side * 2 + 8 * 7 + 5 * 7 + s.columnGap));
  assert.equal(node.inputs[0].cx, s.pinInset);
  assert.equal(node.outputs[1].cx, node.w - s.pinInset);
  assert.equal(node.outputs[1].cy, s.headerHeight + s.rowHeight * 1.5);
});

test('nó: título comprido alarga o nó', () => {
  const node = layoutNode(createNode({ id: 'x', title: 'Um título bem comprido mesmo para caber' }, { id: 1, x: 0, y: 0 }), theme.node, measure);
  assert.equal(node.w, Math.ceil(39 * 7 + theme.node.padding * 2));
});

test('nó: achar o pino no ponto', () => {
  const node = layoutNode(createNode(language.node('add'), { id: 1, x: 100, y: 100, scope: 'root' }), theme.node, measure);
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
    assert.ok(language.categories[def.category], `categoria ${def.category}`);
  }
  assert.deepEqual([...kinds].sort(), ['condition', 'config', 'data', 'flow']);
});

test('menu: busca sem acento, título que começa com a busca primeiro', () => {
  assert.equal(normalize('Matemática'), 'matematica');
  assert.deepEqual(filterNodes(language.nodes, '').length, language.nodes.length);
  assert.deepEqual(filterNodes(language.nodes, 'matematica').map((d) => d.id), ['add']);
  // "i": Início e Imprimir começam com i; Somar (Matemática) e Variável só contêm.
  assert.deepEqual(filterNodes(language.nodes, 'i').map((d) => d.id), ['start', 'print', 'add', 'variable']);
  assert.deepEqual(filterNodes(language.nodes, 'para').map((d) => d.id), ['to_text']);
  assert.deepEqual(filterNodes(language.nodes, 'zzz'), []);
});
