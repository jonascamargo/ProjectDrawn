// Arrastar entre áreas (etapa 2b): regras de soltar, Ctrl para sair, volta se proibido,
// pasta/arquivo vira caminho num script, destaque e motivo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortcuts } from '../js/config/shortcuts.js';
import { Camera } from '../js/core/canvas/camera.js';
import { CanvasInput } from '../js/core/canvas/input.js';
import { Renderer } from '../js/core/canvas/renderer.js';
import { Selection } from '../js/core/canvas/selection.js';
import { layoutNode } from '../js/core/node.js';
import { ROOT, Scene } from '../js/core/scene.js';
import { language } from '../js/lang/teste/index.js';
import { theme } from '../js/theme/default.js';
import { FakeElement, installDom } from './fakeDom.js';

function setup() {
  installDom();
  const canvas = new FakeElement('canvas');
  const camera = new Camera();
  const scene = new Scene({ language, areaPad: theme.area.pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, language) });
  const selection = new Selection();
  const renderer = new Renderer(canvas, { camera, scene, selection, theme, language });
  renderer.resize(1600, 1200);
  new CanvasInput(canvas, { camera, scene, selection, renderer, theme, shortcuts }).attach();
  const add = (id, x, y, scope = ROOT, name) => scene.addNode(language.node(id), { x, y, scope, values: name ? { name } : undefined });
  const res = add('folder', 60, 60, ROOT, 'res');
  const assets = add('folder', 80, 120, res.id, 'assets');
  const player = add('file', 80, 200, res.id, 'player.gd');
  const ready = add('function', 100, 260, player.id, '_ready');
  const print = add('print', 120, 320, ready.id);
  scene.connect({ node: ready, pin: ready.outputs[0] }, { node: print, pin: print.inputs[0] });
  const enemy = add('file', 600, 120, res.id, 'enemy.gd');
  const data = add('file', 600, 300, res.id, 'data.json');
  scene.fitAreas();
  const ev = (p, extra = {}) => ({ clientX: p.x, clientY: p.y, button: 0, pointerId: 1, ...extra });
  const steps = [];
  const drag = (a, b, extra = {}) => {
    canvas.dispatch('pointerdown', ev(a, extra));
    canvas.dispatch('pointermove', ev({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, extra));
    canvas.dispatch('pointermove', ev(b, extra));
    steps.push(renderer.drop && { ...renderer.drop });
    canvas.dispatch('pointerup', ev(b, extra));
  };
  return { canvas, scene, selection, renderer, add, drag, steps, res, assets, player, ready, print, enemy, data };
}

// Pontos: título do cabeçalho (para arrastar a área) e corpo vazio (canto da área).
const header = (a) => ({ x: a.x + a.layout.headerX + a.layout.titleX + 3, y: a.y + a.layout.headerTop + a.layout.headerY });
const body = (a) => ({ x: a.x + a.w - 6, y: a.y + a.h - 6 });
const grab = (n) => ({ x: n.x + n.w / 2, y: n.y + 8 });

test('regras: script só para script do mesmo tipo; nós de script só dentro de script', () => {
  const { scene, res, assets, player, ready, print, enemy, data, add } = setup();
  assert.deepEqual(scene.canDrop([print], enemy.id), { ok: true, mode: 'move', reason: '' });
  assert.match(scene.canDrop([print], data.id).reason, /Print só vai para outro script \.gd/);
  assert.match(scene.canDrop([print], ROOT).reason, /Print só existe dentro de um script/);
  assert.match(scene.canDrop([print], assets.id).reason, /só existe dentro de um script/);
  assert.ok(scene.canDrop([ready], enemy.id).ok); // função de um .gd para outro .gd
  assert.equal(scene.canDrop([ready], assets.id).ok, false);
  const cls = add('class', 120, 420, player.id);
  assert.match(scene.canDrop([cls], res.id).reason, /só existe dentro de um script/);
  assert.ok(scene.canDrop([player], assets.id).ok); // arquivo entre pastas
  assert.ok(scene.canDrop([assets], ROOT).ok); // pasta para a raiz
  assert.match(scene.canDrop([res], assets.id).reason, /res não cabe dentro dele mesmo/);
  assert.match(scene.canDrop([print], ready.id).reason || 'ok', /ok/); // mesma área: pode
});

test('regras: pasta/arquivo solto num script vira caminho res://', () => {
  const { scene, assets, player, ready, enemy, res } = setup();
  assert.deepEqual(scene.canDrop([player], enemy.id), { ok: true, mode: 'path', reason: 'vira o caminho res://player.gd' });
  assert.equal(scene.canDrop([assets], ready.id).mode, 'path');
  assert.equal(scene.pathOf(assets), 'res://assets');
  assert.equal(scene.pathOf(res), 'res://');
  const other = scene.addNode(language.node('folder'), { x: 2000, y: 0, values: { name: 'docs' } });
  assert.equal(scene.pathOf(other), 'res://docs'); // pasta de fora não chamada res: entra no caminho
  assert.match(scene.canDrop([player, assets], enemy.id).reason, /uma pasta ou um arquivo por vez/);
});

test('Ctrl + arrastar o Print para enemy.gd: muda de script e o fio que cruzaria a área sai', () => {
  const { scene, drag, steps, print, enemy, ready } = setup();
  drag(grab(print), body(enemy), { ctrlKey: true });
  assert.equal(steps[0].scope, enemy.id);
  assert.equal(steps[0].ok, true);
  assert.equal(print.scope, enemy.id);
  assert.equal(scene.wiresOf(print).length, 0);
  assert.equal(scene.inScope(ready.id).length, 0);
});

test('destino proibido: borda vermelha com motivo e o Print volta ao lugar', () => {
  const { canvas, scene, renderer, drag, steps, print, data, ready } = setup();
  const before = [print.x, print.y];
  // Antes de soltar: destaque e motivo desenhados.
  canvas.dispatch('pointerdown', { clientX: grab(print).x, clientY: grab(print).y, button: 0, pointerId: 1 });
  canvas.dispatch('pointermove', { clientX: body(data).x, clientY: body(data).y, button: 0, pointerId: 1, ctrlKey: true });
  canvas.calls.length = 0;
  renderer.draw();
  assert.ok(canvas.calls.some((c) => c[0] === 'fillText' && /só vai para outro script \.gd/.test(c[1])));
  canvas.dispatch('pointerup', { clientX: body(data).x, clientY: body(data).y, button: 0, pointerId: 1, ctrlKey: true });
  assert.deepEqual([print.x, print.y], before);
  assert.equal(print.scope, ready.id);
  assert.equal(renderer.drop, null);
  // Para o canvas também não pode.
  drag(grab(print), { x: 1400, y: 1000 }, { ctrlKey: true });
  assert.equal(steps.at(-1).scope, ROOT);
  assert.equal(steps.at(-1).ok, false);
  assert.equal(print.scope, ready.id);
  assert.equal(scene.wiresOf(print).length, 1); // nada mudou
});

test('Ctrl soltando ainda dentro da origem: vai para a área de fora', () => {
  const { drag, print, player } = setup();
  drag(grab(print), { x: print.x + print.w / 2 + 10, y: print.y + 20 }, { ctrlKey: true });
  assert.equal(print.scope, player.id);
});

test('sem Ctrl o elemento fica na área (ela cresce)', () => {
  const { drag, print, ready } = setup();
  const w = ready.w;
  drag(grab(print), { x: grab(print).x + 200, y: grab(print).y });
  assert.equal(print.scope, ready.id);
  assert.ok(ready.w > w);
});

test('arquivo entre pastas (com o que tem dentro)', () => {
  const { scene, drag, player, assets } = setup();
  drag(header(player), body(assets), { ctrlKey: true });
  assert.equal(player.scope, assets.id);
  assert.equal(scene.inScope(player.id).length, 1); // _ready foi junto
});

test('pasta solta num script vira nó de caminho; a pasta volta ao lugar', () => {
  const { scene, drag, selection, assets, ready } = setup();
  const before = [assets.x, assets.y];
  drag(header(assets), body(ready), { ctrlKey: true });
  assert.deepEqual([assets.x, assets.y], before);
  const path = scene.elements.at(-1);
  assert.equal(path.type, 'path');
  assert.equal(path.title, 'res://assets');
  assert.equal(path.scope, ready.id);
  assert.deepEqual([...selection.ids], [path.id]);
});

test('área de destino com borda tracejada; área aberta com fundo #212121 60% sobre desfoque', () => {
  const { canvas, renderer, print, enemy } = setup();
  canvas.dispatch('pointerdown', { clientX: grab(print).x, clientY: grab(print).y, button: 0, pointerId: 1 });
  canvas.dispatch('pointermove', { clientX: body(enemy).x, clientY: body(enemy).y, button: 0, pointerId: 1, ctrlKey: true });
  canvas.calls.length = 0;
  renderer.draw();
  assert.ok(canvas.calls.some((c) => c[0] === 'setLineDash' && c[1].length === 2)); // tracejado
  assert.ok(canvas.calls.some((c) => c[0] === 'drawImage' && c[1] === canvas)); // desfoque: copia a tela
  assert.equal(theme.area.fill, 'rgba(33, 33, 33, 0.4)');
  const frame = canvas.calls.find((c) => c[0] === 'roundRect' && Array.isArray(c[5]));
  assert.deepEqual(frame[5], [18, 18, 10, 18]); // canto do puxador com 10px
  canvas.dispatch('pointerup', { clientX: body(enemy).x, clientY: body(enemy).y, button: 0, pointerId: 1, ctrlKey: true });
});
