// Interação simulada: canvas, janela e eventos falsos, sem navegador.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortcuts } from '../js/config/shortcuts.js';
import { Camera } from '../js/core/canvas/camera.js';
import { CanvasInput } from '../js/core/canvas/input.js';
import { Renderer } from '../js/core/canvas/renderer.js';
import { Selection } from '../js/core/canvas/selection.js';
import { Scene } from '../js/core/scene.js';
import { theme } from '../js/theme/default.js';
import { FakeElement, installDom } from './fakeDom.js';

// Nós de 100×60 sem pinos, para as contas ficarem simples.
const BOX = { id: 'box', title: 'Bloco' };
const PINNED = { id: 'pinned', title: 'P', inputs: [{ id: 'a', kind: 'data', type: 'number' }] };
const language = { types: { number: { label: 'número', color: '#00f' } }, categories: {} };

function setup() {
  installDom();
  const canvas = new FakeElement('canvas');
  const camera = new Camera();
  const scene = new Scene({ layout: (node) => Object.assign(node, { w: 100, h: 60 }) });
  const selection = new Selection();
  const renderer = new Renderer(canvas, { camera, scene, selection, theme, language });
  renderer.resize(800, 600);
  const menus = [];
  const input = new CanvasInput(canvas, {
    camera, scene, selection, renderer, theme, shortcuts,
    onNodeMenu: (screen, world) => menus.push({ screen, world }),
  });
  input.attach();
  const a = scene.addNode(BOX, { x: 0, y: 0 });
  const b = scene.addNode(BOX, { x: 200, y: 0 });
  const ev = (x, y, extra = {}) => ({ clientX: x, clientY: y, button: 0, pointerId: 1, ...extra });
  const key = (k, extra = {}) => ({ key: k, code: k === ' ' ? 'Space' : k, ...extra });
  const press = (type, e) => (type.startsWith('key') ? window.dispatch(type, e) : canvas.dispatch(type, e));
  return { canvas, camera, scene, selection, renderer, input, a, b, ev, key, press, menus };
}

test('desenhar não quebra (retângulo de seleção e dica de pino ativos)', () => {
  const { renderer, scene, canvas } = setup();
  const node = scene.addNode(PINNED, { x: 0, y: 200 });
  node.inputs[0].cx = 12;
  node.inputs[0].cy = 40;
  renderer.box = { start: { x: 0, y: 0 }, end: { x: -50, y: 50 } };
  renderer.hover = { node, pin: node.inputs[0] };
  renderer.draw();
  const names = canvas.calls.map((c) => c[0]);
  assert.ok(names.includes('roundRect'));
  assert.ok(canvas.calls.some((c) => c[0] === 'fillText' && c[1] === 'dados · número · entrada · até 1 fio'));
  assert.equal(canvas.width, 1600); // nítido com devicePixelRatio 2
});

test('clique seleciona; Shift+clique soma e tira', () => {
  const { a, b, ev, press, selection } = setup();
  press('pointerdown', ev(10, 10));
  press('pointerup', ev(10, 10));
  assert.deepEqual([...selection.ids], [a.id]);
  press('pointerdown', ev(210, 10, { shiftKey: true }));
  press('pointerup', ev(210, 10, { shiftKey: true }));
  assert.deepEqual([...selection.ids], [a.id, b.id]);
  press('pointerdown', ev(10, 10, { shiftKey: true }));
  press('pointerup', ev(10, 10, { shiftKey: true }));
  assert.deepEqual([...selection.ids], [b.id]);
});

test('arrastar move os selecionados juntos e encaixa ao soltar', () => {
  const { a, b, ev, press, selection } = setup();
  selection.set([a.id, b.id]);
  press('pointerdown', ev(10, 10));
  press('pointermove', ev(37, 18));
  press('pointerup', ev(37, 18));
  assert.deepEqual([a.x, a.y, b.x, b.y], [20, 0, 220, 0]); // 27,8 → encaixa em 20,0
  assert.equal(selection.size, 2);
});

test('Alt ao soltar: sem encaixe', () => {
  const { a, ev, press } = setup();
  press('pointerdown', ev(10, 10));
  press('pointermove', ev(37, 18));
  press('pointerup', ev(37, 18, { altKey: true }));
  assert.deepEqual([a.x, a.y], [27, 8]);
});

test('clique sem arrastar num selecionado deixa só ele', () => {
  const { a, b, ev, press, selection } = setup();
  selection.set([a.id, b.id]);
  press('pointerdown', ev(10, 10));
  press('pointerup', ev(11, 10));
  assert.deepEqual([...selection.ids], [a.id]);
  assert.equal(a.x, 0);
});

test('retângulo: → inteiro dentro, ← toca; clique no vazio limpa', () => {
  const { a, b, ev, press, selection, renderer } = setup();
  press('pointerdown', ev(-10, -10));
  press('pointermove', ev(250, 100));
  press('pointerup', ev(250, 100));
  assert.deepEqual([...selection.ids], [a.id]);
  assert.equal(renderer.box, null);
  press('pointerdown', ev(250, 100));
  press('pointermove', ev(50, 30));
  press('pointerup', ev(50, 30));
  assert.deepEqual([...selection.ids], [a.id, b.id]);
  press('pointerdown', ev(500, 500));
  press('pointerup', ev(500, 500));
  assert.equal(selection.size, 0);
});

test('pan: botão direito e Espaço + arrastar não mexem na seleção nem abrem menu', () => {
  const { camera, ev, key, press, selection, a, menus } = setup();
  selection.set([a.id]);
  press('pointerdown', ev(400, 400, { button: 2 }));
  press('pointermove', ev(450, 420, { button: 2 }));
  press('pointerup', ev(450, 420, { button: 2 }));
  assert.deepEqual([camera.x, camera.y], [-50, -20]);
  press('keydown', key(' '));
  press('pointerdown', ev(10, 10));
  press('pointermove', ev(20, 10));
  press('pointerup', ev(20, 10));
  press('keyup', key(' '));
  assert.deepEqual([camera.x, camera.y], [-60, -20]);
  assert.deepEqual([...selection.ids], [a.id]);
  assert.equal(a.x, 0);
  assert.equal(menus.length, 0);
});

test('clique direito sem arrastar: no vazio abre o menu no ponto; num nó, não', () => {
  const { ev, press, menus, camera } = setup();
  camera.zoomAt(0, 0, 2);
  press('pointerdown', ev(500, 300, { button: 2 }));
  press('pointerup', ev(501, 300, { button: 2 }));
  assert.equal(menus.length, 1);
  assert.deepEqual(menus[0].screen, { x: 500, y: 300 });
  assert.deepEqual(menus[0].world, { x: 250, y: 150 });
  press('pointerdown', ev(20, 20, { button: 2 }));
  press('pointerup', ev(20, 20, { button: 2 }));
  assert.equal(menus.length, 1);
});

test('passar o mouse num pino destaca e mostra a dica', () => {
  const { scene, ev, press, renderer } = setup();
  const node = scene.addNode(PINNED, { x: 0, y: 200 });
  Object.assign(node.inputs[0], { cx: 12, cy: 40 });
  press('pointermove', ev(14, 241));
  assert.equal(renderer.hover?.pin, node.inputs[0]);
  press('pointermove', ev(60, 230));
  assert.equal(renderer.hover, null);
});

test('roda: zoom no ponteiro', () => {
  const { camera, canvas, ev } = setup();
  canvas.dispatch('wheel', ev(400, 300, { deltaY: -100, deltaMode: 0 }));
  assert.ok(camera.zoom > 1);
  const w = camera.toWorld(400, 300);
  assert.ok(Math.abs(w.x - 400) < 1e-9 && Math.abs(w.y - 300) < 1e-9);
});

test('teclas pelo arquivo de atalhos: Ctrl+A, Esc, Delete, F e Home', () => {
  const { camera, scene, selection, key, press, a } = setup();
  press('keydown', key('a', { ctrlKey: true }));
  assert.equal(selection.size, 2);
  press('keydown', key('Escape'));
  assert.equal(selection.size, 0);
  selection.set([a.id]);
  press('keydown', key('Delete'));
  assert.equal(scene.elements.length, 1);
  assert.equal(selection.size, 0);
  camera.zoomAt(0, 0, 3);
  press('keydown', key('f'));
  assert.equal(camera.zoom, 1); // um nó só cabe em 100%
  camera.zoomAt(0, 0, 0.5);
  press('keydown', key('Home'));
  assert.equal(camera.zoom, 1);
});

test('atalho trocado no arquivo passa a valer', () => {
  const { selection, key, press } = setup();
  const original = shortcuts.keys.selectAll.combos;
  shortcuts.keys.selectAll.combos = ['Shift+S'];
  try {
    press('keydown', key('a', { ctrlKey: true }));
    assert.equal(selection.size, 0);
    press('keydown', key('S', { shiftKey: true }));
    assert.equal(selection.size, 2);
  } finally {
    shortcuts.keys.selectAll.combos = original;
  }
});

test('teclas dentro de campos de texto são ignoradas', () => {
  const { selection, key, press } = setup();
  press('keydown', key('a', { ctrlKey: true, target: new FakeElement('input') }));
  assert.equal(selection.size, 0);
});
