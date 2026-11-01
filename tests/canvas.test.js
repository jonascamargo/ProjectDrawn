import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Camera } from '../js/core/canvas/camera.js';
import { snap, visibleStep } from '../js/core/canvas/grid.js';
import { Selection, boxMode, pickInBox } from '../js/core/canvas/selection.js';
import { ROOT, Scene } from '../js/core/scene.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('câmera: tela ↔ mundo ida e volta', () => {
  const cam = new Camera();
  cam.x = 100;
  cam.y = -50;
  cam.zoom = 2;
  const w = cam.toWorld(30, 40);
  const s = cam.toScreen(w.x, w.y);
  close(s.x, 30);
  close(s.y, 40);
});

test('câmera: zoom mantém parado o ponto sob o ponteiro', () => {
  const cam = new Camera();
  const before = cam.toWorld(200, 150);
  cam.zoomAt(200, 150, 2.5);
  const after = cam.toWorld(200, 150);
  close(after.x, before.x);
  close(after.y, before.y);
});

test('câmera: zoom fica entre 10% e 400%', () => {
  const cam = new Camera();
  cam.zoomAt(0, 0, 100);
  assert.equal(cam.zoom, 4);
  cam.zoomAt(0, 0, 0.001);
  assert.equal(cam.zoom, 0.1);
});

test('câmera: pan anda o deslocamento da tela dividido pelo zoom', () => {
  const cam = new Camera();
  cam.zoom = 2;
  cam.panBy(40, -20);
  close(cam.x, -20);
  close(cam.y, 10);
});

test('câmera: enquadrar centraliza e não passa de 100%', () => {
  const cam = new Camera();
  cam.frame({ x: 0, y: 0, w: 100, h: 100 }, 800, 600);
  assert.equal(cam.zoom, 1);
  const center = cam.toWorld(400, 300);
  close(center.x, 50);
  close(center.y, 50);
  cam.frame({ x: 0, y: 0, w: 4000, h: 1000 }, 800, 600);
  assert.ok(cam.zoom < 1);
});

test('grade: encaixe e passo visível', () => {
  assert.equal(snap(29, 20), 20);
  assert.equal(snap(31, 20), 40);
  assert.equal(snap(-11, 20), -20);
  assert.equal(visibleStep(20, 1), 20);
  assert.equal(visibleStep(20, 0.3), 100);
  assert.equal(visibleStep(20, 0.1), 100);
  assert.equal(visibleStep(20, 0.05), 500);
});

test('seleção: direção do retângulo define o modo', () => {
  assert.equal(boxMode({ x: 0, y: 0 }, { x: 10, y: 5 }), 'inside');
  assert.equal(boxMode({ x: 10, y: 0 }, { x: 0, y: 5 }), 'touch');
});

test('seleção: inteiro dentro × toca', () => {
  const els = [
    { id: 1, x: 10, y: 10, w: 50, h: 50, scope: ROOT },
    { id: 2, x: 80, y: 10, w: 50, h: 50, scope: ROOT },
  ];
  // Da esquerda para a direita, cobrindo o 1 e metade do 2: só o 1.
  assert.deepEqual(pickInBox(els, { x: 0, y: 0 }, { x: 100, y: 100 }), []);
  assert.deepEqual(pickInBox(els, { x: 0, y: 0 }, { x: 100, y: 100 }, ROOT), [1]);
  // Da direita para a esquerda, mesmo retângulo: os dois.
  assert.deepEqual(pickInBox(els, { x: 100, y: 100 }, { x: 0, y: 0 }, ROOT), [1, 2]);
});

test('seleção: só pega o escopo onde começou', () => {
  const els = [
    { id: 1, x: 0, y: 0, w: 10, h: 10, scope: ROOT },
    { id: 2, x: 20, y: 0, w: 10, h: 10, scope: 'funcao' },
  ];
  assert.deepEqual(pickInBox(els, { x: 100, y: 100 }, { x: -5, y: -5 }, 'funcao'), [2]);
});

test('seleção: soma, tira e limpa', () => {
  const sel = new Selection();
  sel.set([1, 2]);
  sel.toggle(2);
  sel.toggle(3);
  assert.deepEqual([...sel.ids], [1, 3]);
  assert.equal(sel.size, 2);
  sel.clear();
  assert.equal(sel.size, 0);
});

test('cena: clique pega o elemento de cima; apagar e limites', () => {
  const box = (w, h) => (node) => Object.assign(node, { w, h });
  const scene = new Scene({ layout: box(100, 100) });
  const def = { id: 'n', title: 'N' };
  const a = scene.addNode(def, { x: 0, y: 0 });
  const b = scene.addNode(def, { x: 50, y: 50 });
  assert.equal(a.scope, ROOT);
  assert.equal(scene.hitTest({ x: 60, y: 60 }), b);
  assert.equal(scene.hitTest({ x: 10, y: 10 }), a);
  assert.equal(scene.hitTest({ x: 500, y: 500 }), null);
  assert.deepEqual(scene.bounds(), { x: 0, y: 0, w: 150, h: 150 });
  scene.remove([b.id]);
  assert.deepEqual(scene.elements, [a]);
  assert.equal(scene.bounds([]), null);
});
