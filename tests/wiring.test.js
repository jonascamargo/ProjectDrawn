// Interação com fios simulada: puxar, soltar, Ctrl, Alt, clique no fio, duplo clique, frente.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortcuts } from '../js/config/shortcuts.js';
import { Camera } from '../js/core/canvas/camera.js';
import { CanvasInput } from '../js/core/canvas/input.js';
import { Renderer } from '../js/core/canvas/renderer.js';
import { Selection } from '../js/core/canvas/selection.js';
import { layoutNode, pinAnchor } from '../js/core/node.js';
import { Scene } from '../js/core/scene.js';
import { language } from '../js/lang/teste/index.js';
import { theme } from '../js/theme/default.js';
import { FakeElement, installDom } from './fakeDom.js';

function setup() {
  installDom();
  const canvas = new FakeElement('canvas');
  const camera = new Camera();
  const scene = new Scene({ language, layout: (n) => layoutNode(n, theme, (t) => t.length * 7) });
  const selection = new Selection();
  const renderer = new Renderer(canvas, { camera, scene, selection, theme, language });
  renderer.resize(1200, 800);
  const menus = [];
  new CanvasInput(canvas, {
    camera, scene, selection, renderer, theme, shortcuts,
    onNodeMenu: (screen, world, origin) => menus.push({ screen, world, origin }),
  }).attach();
  const add = (id, x, y) => scene.addNode(language.node(id), { x, y });
  const at = (node, id, dir = 'out') => {
    const pin = node[dir === 'out' ? 'outputs' : 'inputs'].find((p) => p.id === id);
    return { node, pin, ...pinAnchor(node, pin) };
  };
  const ev = (p, extra = {}) => ({ clientX: p.x, clientY: p.y, button: 0, pointerId: 1, ...extra });
  const drag = (a, b, extra = {}) => {
    canvas.dispatch('pointerdown', ev(a, extra));
    canvas.dispatch('pointermove', ev({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, extra));
    canvas.dispatch('pointermove', ev(b, extra));
    canvas.dispatch('pointerup', ev(b, extra));
  };
  return { canvas, scene, selection, renderer, menus, add, at, ev, drag };
}

test('puxar fio de saída para entrada compatível liga; de entrada para saída também', () => {
  const { scene, add, at, drag } = setup();
  const s = add('start', 0, 0);
  const p = add('print', 300, 0);
  const t = add('to_text', 0, 200);
  drag(at(s, 'next'), at(p, 'run', 'in'));
  drag(at(p, 'text', 'in'), at(t, 'text'));
  assert.equal(scene.wires.length, 2);
  assert.ok(scene.isConnected(p, p.inputs[1]));
});

test('soltar em pino incompatível não liga; enquanto puxa mostra o motivo e apaga os incompatíveis', () => {
  const { canvas, scene, renderer, add, at, ev } = setup();
  const sum = add('add', 0, 0);
  const p = add('print', 300, 0);
  const t = add('to_text', 300, 200);
  const from = at(sum, 'result');
  const to = at(p, 'text', 'in');
  canvas.dispatch('pointerdown', ev(from));
  canvas.dispatch('pointermove', ev(to));
  assert.equal(renderer.drag.check.reason, 'text não aceita float');
  assert.equal(renderer.hover.pin, p.inputs[1]);
  assert.ok(renderer.dimmed(p, p.inputs[1]));
  assert.ok(renderer.dimmed(p, p.inputs[0])); // fluxo
  assert.ok(!renderer.dimmed(t, t.inputs[0])); // qualquer
  canvas.calls.length = 0;
  renderer.draw();
  assert.ok(canvas.calls.some((c) => c[0] === 'fillText' && c[1] === 'text não aceita float'));
  canvas.dispatch('pointerup', ev(to));
  assert.equal(scene.wires.length, 0);
  assert.equal(renderer.drag, null);
});

test('soltar fio novo no vazio abre o menu com a origem; clique no pino sem arrastar não', () => {
  const { canvas, menus, add, at, ev, drag } = setup();
  const s = add('start', 0, 0);
  drag(at(s, 'next'), { x: 600, y: 500 });
  assert.equal(menus.length, 1);
  assert.equal(menus[0].origin.pin, s.outputs[0]);
  assert.deepEqual(menus[0].world, { x: 600, y: 500 });
  canvas.dispatch('pointerdown', ev(at(s, 'next')));
  canvas.dispatch('pointerup', ev(at(s, 'next')));
  assert.equal(menus.length, 1);
});

test('Ctrl+arrastar leva os fios do pino para outro pino', () => {
  const { scene, add, at, drag } = setup();
  const s1 = add('start', 0, 0);
  const s2 = add('start', 0, 150);
  const p1 = add('print', 300, 0);
  const p2 = add('print', 300, 200);
  scene.connect(at(s1, 'next'), at(p1, 'run', 'in'));
  scene.connect(at(s2, 'next'), at(p1, 'run', 'in'));
  drag(at(p1, 'run', 'in'), at(p2, 'run', 'in'), { ctrlKey: true });
  assert.equal(scene.wires.length, 2);
  assert.ok(scene.wires.every((w) => w.to.node === p2.id));
  assert.ok(!scene.isConnected(p1, p1.inputs[0]));
});

test('Ctrl+arrastar: soltar no vazio apaga os fios; em pino incompatível devolve', () => {
  const { scene, menus, add, at, drag } = setup();
  const s = add('start', 0, 0);
  const p = add('print', 300, 0);
  const sum = add('add', 300, 200);
  scene.connect(at(s, 'next'), at(p, 'run', 'in'));
  drag(at(s, 'next'), at(sum, 'a', 'in'), { ctrlKey: true });
  assert.equal(scene.wires.length, 1);
  drag(at(s, 'next'), { x: 700, y: 600 }, { ctrlKey: true });
  assert.equal(scene.wires.length, 0);
  assert.equal(menus.length, 0);
});

test('Alt+clique no pino solta todos os fios dele', () => {
  const { canvas, scene, add, at, ev } = setup();
  const sum = add('add', 0, 0);
  const t1 = add('to_text', 300, 0);
  const t2 = add('to_text', 300, 150);
  scene.connect(at(sum, 'result'), at(t1, 'value', 'in'));
  scene.connect(at(sum, 'result'), at(t2, 'value', 'in'));
  canvas.dispatch('pointerdown', ev(at(sum, 'result'), { altKey: true }));
  canvas.dispatch('pointerup', ev(at(sum, 'result'), { altKey: true }));
  assert.equal(scene.wires.length, 0);
});

test('clique no fio seleciona; Shift soma; Delete apaga', () => {
  const { canvas, scene, selection, add, at, ev } = setup();
  const s = add('start', 0, 0);
  const p = add('print', 400, 0);
  const w = scene.connect(at(s, 'next'), at(p, 'run', 'in')).wire;
  const a = at(s, 'next');
  const b = at(p, 'run', 'in');
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  canvas.dispatch('pointerdown', ev(mid));
  canvas.dispatch('pointerup', ev(mid));
  assert.deepEqual([...selection.ids], [w.id]);
  canvas.dispatch('pointerdown', ev({ x: 10, y: 10 }, { shiftKey: true }));
  canvas.dispatch('pointerup', ev({ x: 10, y: 10 }, { shiftKey: true }));
  assert.deepEqual([...selection.ids].sort(), [s.id, w.id].sort());
  canvas.calls.length = 0;
  canvas.dispatch('pointermove', ev({ x: 900, y: 700 }));
  window.dispatch('keydown', { key: 'Delete', code: 'Delete' });
  assert.equal(scene.wires.length, 0);
  assert.deepEqual(scene.elements, [p]);
});

test('duplo clique no fio cria reroute selecionado; arrastar o meio dele move', () => {
  const { canvas, scene, selection, add, at, ev, drag } = setup();
  const s = add('start', 0, 0);
  const p = add('print', 400, 0);
  scene.connect(at(s, 'next'), at(p, 'run', 'in'));
  const a = at(s, 'next');
  const b = at(p, 'run', 'in');
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  canvas.dispatch('dblclick', ev(mid));
  const r = scene.elements.find((n) => n.reroute);
  assert.ok(r);
  assert.deepEqual([...selection.ids], [r.id]);
  assert.equal(scene.wires.length, 2);
  drag(mid, { x: mid.x + 40, y: mid.y + 100 }, { altKey: true });
  assert.deepEqual(pinAnchor(r, r.outputs[0]), { x: mid.x + 40, y: mid.y + 100 });
  assert.equal(scene.wires.length, 2);
  // Duplo clique fora de fio não cria nada.
  canvas.dispatch('dblclick', ev({ x: 1000, y: 700 }));
  assert.equal(scene.elements.filter((n) => n.reroute).length, 1);
});

test('clicar num nó traz para frente', () => {
  const { canvas, scene, add, ev } = setup();
  const a = add('start', 0, 0);
  const b = add('start', 50, 10);
  assert.equal(scene.elements.at(-1), b);
  canvas.dispatch('pointerdown', ev({ x: 5, y: 5 }));
  canvas.dispatch('pointerup', ev({ x: 5, y: 5 }));
  assert.equal(scene.elements.at(-1), a);
});

test('desenha fios, ícone no meio, pino ligado preenchido e reroute', () => {
  const { canvas, scene, renderer, add, at } = setup();
  const s = add('start', 0, 0);
  const p = add('print', 400, 0);
  const w = scene.connect(at(s, 'next'), at(p, 'run', 'in')).wire;
  canvas.calls.length = 0;
  renderer.draw();
  assert.ok(canvas.calls.some((c) => c[0] === 'bezierCurveTo'));
  scene.addReroute(w, { x: 200, y: 60 });
  renderer.drag = null;
  canvas.calls.length = 0;
  renderer.draw();
  assert.equal(canvas.calls.filter((c) => c[0] === 'bezierCurveTo').length, 2);
});

test('espessura do fio: fluxo 4, os outros 2; borda na cor do ícone ou do tipo', () => {
  const { renderer, add } = setup();
  const s = add('start', 0, 0);
  const sum = add('add', 0, 200);
  const iff = add('if', 300, 0);
  const g = add('greater', 300, 200);
  assert.equal(renderer.wireWidth(s.outputs[0]), 4);
  assert.equal(renderer.wireWidth(iff.outputs[0]), 4); // verdadeiro é fluxo
  assert.equal(renderer.wireWidth(sum.outputs[0]), 2);
  assert.equal(renderer.wireWidth(g.outputs[0]), 2); // condicional
  const variable = add('variable', 600, 0);
  const number = add('number', 600, 200);
  assert.equal(renderer.selectedBorder(variable), language.types.any.color);
  assert.equal(renderer.selectedBorder(number), language.types.float.color);
  assert.equal(renderer.selectedBorder(sum), theme.node.selectedBorder); // sem tag nem ícone
  // Nós com ícone: borda na cor do ícone, selecionado ou não.
  assert.equal(renderer.border(s), language.icons.event.color);
  assert.equal(renderer.selectedBorder(s), language.icons.event.color);
  assert.equal(renderer.border(g), language.icons.condition.color);
  assert.equal(renderer.border(sum), theme.node.border);
  assert.equal(renderer.border(variable), theme.node.border);
});

test('ícone SVG desenhado pintado na cor do tema, numa cópia guardada', async () => {
  const { renderer, add, canvas } = setup();
  Object.assign(language.icons.loop, { image: {}, width: 14, height: 14 });
  add('repeat', 0, 0);
  canvas.calls.length = 0;
  renderer.draw();
  renderer.draw();
  assert.equal(canvas.calls.filter((c) => c[0] === 'drawImage').length, 2);
  assert.equal(language.icons.loop.tinted.size, 1); // pintado uma vez, reaproveitado
  assert.ok([...language.icons.loop.tinted.keys()][0].startsWith(theme.icon.color));
  delete language.icons.loop.image;
});
