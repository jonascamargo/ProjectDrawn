// Interação simulada: canvas, janela e eventos falsos, sem navegador.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Camera } from '../js/core/canvas/camera.js';
import { CanvasInput } from '../js/core/canvas/input.js';
import { Renderer } from '../js/core/canvas/renderer.js';
import { Selection } from '../js/core/canvas/selection.js';
import { Scene } from '../js/core/scene.js';
import { theme } from '../js/theme/default.js';

function fakeTarget() {
  const handlers = {};
  return {
    handlers,
    addEventListener: (type, fn) => (handlers[type] = fn),
    fire: (type, e) => handlers[type]?.(e),
  };
}

// Contexto 2D que aceita qualquer chamada e anota os nomes.
function fakeContext(calls) {
  return new Proxy({}, {
    get: (obj, key) => (key in obj ? obj[key] : (...args) => calls.push(key)),
    set: (obj, key, value) => ((obj[key] = value), true),
  });
}

function setup() {
  const win = fakeTarget();
  globalThis.window = { ...win, devicePixelRatio: 2 };
  globalThis.requestAnimationFrame = (fn) => fn();
  const calls = [];
  const canvas = {
    ...fakeTarget(),
    style: {},
    getContext: () => fakeContext(calls),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture() {},
    hasPointerCapture: () => true,
    releasePointerCapture() {},
  };
  const camera = new Camera();
  const scene = new Scene();
  const selection = new Selection();
  const renderer = new Renderer(canvas, { camera, scene, selection, theme });
  renderer.resize(800, 600);
  const input = new CanvasInput(canvas, { camera, scene, selection, renderer, theme });
  input.attach();
  const a = scene.add({ x: 0, y: 0, w: 100, h: 60 });
  const b = scene.add({ x: 200, y: 0, w: 100, h: 60 });
  const ev = (x, y, extra = {}) => ({ clientX: x, clientY: y, button: 0, pointerId: 1, preventDefault() {}, ...extra });
  const key = (k, extra = {}) => ({ key: k, code: k === ' ' ? 'Space' : k, target: {}, preventDefault() {}, ...extra });
  const press = (type, e) => (type.startsWith('key') ? window.fire(type, e) : canvas.fire(type, e));
  return { canvas, camera, scene, selection, renderer, input, a, b, ev, key, press, calls };
}

test('desenhar não quebra (com retângulo de seleção ativo)', () => {
  const { renderer, calls } = setup();
  renderer.box = { start: { x: 0, y: 0 }, end: { x: -50, y: 50 } };
  renderer.draw();
  assert.ok(calls.includes('roundRect'));
  assert.ok(calls.includes('fillText'));
  assert.equal(renderer.canvas.width, 1600); // nítido com devicePixelRatio 2
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

test('pan: botão direito e Espaço + arrastar não mexem na seleção', () => {
  const { camera, ev, key, press, selection, a } = setup();
  selection.set([a.id]);
  press('pointerdown', ev(10, 10, { button: 2 }));
  press('pointermove', ev(60, 30, { button: 2 }));
  press('pointerup', ev(60, 30, { button: 2 }));
  assert.deepEqual([camera.x, camera.y], [-50, -20]);
  press('keydown', key(' '));
  press('pointerdown', ev(10, 10));
  press('pointermove', ev(20, 10));
  press('pointerup', ev(20, 10));
  press('keyup', key(' '));
  assert.deepEqual([camera.x, camera.y], [-60, -20]);
  assert.deepEqual([...selection.ids], [a.id]);
  assert.equal(a.x, 0);
});

test('roda: zoom no ponteiro', () => {
  const { camera, canvas, ev } = setup();
  canvas.fire('wheel', ev(400, 300, { deltaY: -100, deltaMode: 0 }));
  assert.ok(camera.zoom > 1);
  const w = camera.toWorld(400, 300);
  assert.ok(Math.abs(w.x - 400) < 1e-9 && Math.abs(w.y - 300) < 1e-9);
});

test('teclas: Ctrl+A, Esc, Delete, F e Home', () => {
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
  assert.equal(camera.zoom, 1); // um bloco só cabe em 100%
  camera.zoomAt(0, 0, 0.5);
  press('keydown', key('Home'));
  assert.equal(camera.zoom, 1);
});

test('teclas dentro de campos de texto são ignoradas', () => {
  const { selection, key, press } = setup();
  press('keydown', key('a', { ctrlKey: true, target: { closest: () => ({}) } }));
  assert.equal(selection.size, 0);
});
