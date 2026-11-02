// Áreas (etapa 2a): hierarquia, tamanho pelo conteúdo, abrir/fechar, fios só na mesma área,
// interação (⇕, duplo clique, mover com o conteúdo, puxador, seleção presa, menu) e salvar.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortcuts } from '../js/config/shortcuts.js';
import { Camera } from '../js/core/canvas/camera.js';
import { CanvasInput } from '../js/core/canvas/input.js';
import { Renderer } from '../js/core/canvas/renderer.js';
import { Selection } from '../js/core/canvas/selection.js';
import { accepts, layoutNode } from '../js/core/node.js';
import { ROOT, Scene } from '../js/core/scene.js';
import { deserialize, serialize } from '../js/core/storage.js';
import { canConnect } from '../js/core/wires.js';
import { language } from '../js/lang/teste/index.js';
import { theme } from '../js/theme/default.js';
import { FakeElement, installDom } from './fakeDom.js';

const pad = theme.area.pad;

function setup() {
  installDom();
  const canvas = new FakeElement('canvas');
  const camera = new Camera();
  const scene = new Scene({ language, areaPad: pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, language) });
  const selection = new Selection();
  const renderer = new Renderer(canvas, { camera, scene, selection, theme, language });
  renderer.resize(1600, 1200);
  const menus = [];
  new CanvasInput(canvas, {
    camera, scene, selection, renderer, theme, shortcuts,
    onNodeMenu: (screen, world, origin) => menus.push({ world, origin, scope: scene.scopeAt(world) }),
  }).attach();
  const add = (id, x, y, scope, values) => scene.addNode(language.node(id), { x, y, scope, values });
  const ev = (x, y, extra = {}) => ({ clientX: x, clientY: y, button: 0, pointerId: 1, ...extra });
  const click = (x, y, extra) => {
    canvas.dispatch('pointerdown', ev(x, y, extra));
    canvas.dispatch('pointerup', ev(x, y, extra));
  };
  const drag = (a, b, extra = {}) => {
    canvas.dispatch('pointerdown', ev(a.x, a.y, extra));
    canvas.dispatch('pointermove', ev((a.x + b.x) / 2, (a.y + b.y) / 2, extra));
    canvas.dispatch('pointermove', ev(b.x, b.y, extra));
    canvas.dispatch('pointerup', ev(b.x, b.y, extra));
  };
  // res / player.gd / _ready / Print
  const res = add('folder', 100, 100, ROOT, { name: 'res' });
  const file = add('file', 120, 160, res.id, { name: 'player.gd' });
  const fn = add('function', 140, 220, file.id, { name: '_ready' });
  const print = add('print', 160, 280, fn.id);
  scene.fitAreas();
  return { canvas, camera, scene, selection, renderer, menus, add, click, drag, ev, res, file, fn, print };
}

// Centro do cabeçalho de uma área e do botão ⇕.
const headerPoint = (a) => ({ x: a.x + a.layout.headerX + a.layout.titleX + 4, y: a.y + a.layout.headerTop + a.layout.headerY });
const togglePoint = (a) => ({ x: a.x + a.layout.headerX + a.layout.toggleX + a.layout.toggleW / 2, y: a.y + a.layout.headerTop + a.layout.headerY });

test('regras: o que cada área aceita (linguagem); a raiz aceita tudo', () => {
  const def = (id) => language.node(id);
  const node = (id) => ({ contains: def(id).contains });
  assert.ok(accepts(node('folder'), def('file')));
  assert.ok(accepts(node('folder'), def('folder')));
  assert.ok(!accepts(node('folder'), def('print')));
  assert.ok(accepts(node('file'), def('class')));
  assert.ok(accepts(node('file'), def('print')));
  assert.ok(!accepts(node('file'), def('folder')));
  assert.ok(accepts(node('class'), def('function')));
  assert.ok(!accepts(node('class'), def('file')));
  assert.ok(accepts(node('function'), def('print')));
  assert.ok(!accepts(node('function'), def('function')));
  assert.ok(accepts(null, def('folder')));
});

test('tamanho pelo conteúdo, das de dentro para as de fora; cabeçalho no canto', () => {
  const { scene, res, file, fn, print } = setup();
  // Function cobre o Print com a margem; File cobre a Function; Folder cobre o File.
  assert.equal(fn.x + fn.w, print.x + print.w + pad);
  assert.equal(fn.y + fn.h, print.y + print.h + pad);
  assert.ok(file.x + file.w >= fn.x + fn.w + pad);
  assert.ok(res.y + res.h >= file.y + file.h + pad);
  assert.equal(fn.layout.headerX, pad); // aberto: cabeçalho a `pad` da borda
  // Mover o Print para a direita aumenta tudo; voltar encolhe.
  const before = [fn.w, file.w, res.w];
  print.x += 300;
  scene.fitAreas();
  assert.deepEqual([fn.w, file.w, res.w].map((w, i) => w - before[i]), [300, 300, 300]);
  print.x -= 300;
  scene.fitAreas();
  assert.deepEqual([fn.w, file.w, res.w], before);
  // Passar da borda esquerda: a área anda até ele (o cabeçalho continua no canto).
  print.x = fn.x - 100;
  scene.fitAreas();
  assert.equal(fn.x, print.x - pad);
});

test('puxador só aumenta; fechar deixa o tamanho do cabeçalho e esconde o conteúdo', () => {
  const { scene, fn, print } = setup();
  const contentW = fn.w;
  fn.manual = { w: contentW + 200, h: 0 };
  scene.fitAreas();
  assert.equal(fn.w, contentW + 200);
  fn.manual = { w: 10, h: 10 };
  scene.fitAreas();
  assert.equal(fn.w, contentW); // menor que o conteúdo, não
  scene.toggleArea(fn);
  assert.equal(fn.open, false);
  assert.deepEqual([fn.w, fn.h], [fn.layout.headerW, 40]);
  assert.equal(scene.isVisible(print), false);
  assert.equal(scene.hitTest({ x: print.x + 5, y: print.y + 5 })?.id === print.id, false);
  scene.toggleArea(fn);
  assert.equal(scene.isVisible(print), true);
});

test('procurar no ponto: cabeçalho por cima, depois o conteúdo, depois o corpo; escopo do ponto', () => {
  const { scene, res, file, fn, print } = setup();
  assert.equal(scene.hitTest({ x: print.x + 5, y: print.y + 5 }), print);
  assert.equal(scene.hitTest(headerPoint(fn)), fn);
  assert.equal(scene.areaPart(fn, headerPoint(fn)), 'header');
  assert.equal(scene.areaPart(fn, togglePoint(fn)), 'toggle');
  assert.equal(scene.areaPart(fn, { x: fn.x + fn.w - 3, y: fn.y + fn.h - 3 }), 'handle');
  const body = { x: fn.x + fn.w - pad - 1, y: fn.y + fn.h - pad - 1 };
  assert.equal(scene.areaPart(fn, body), 'body');
  assert.equal(scene.scopeAt(body), fn.id);
  assert.equal(scene.scopeAt({ x: res.x + 3, y: res.y + res.h - 3 }), res.id);
  assert.equal(scene.scopeAt({ x: -500, y: -500 }), ROOT);
  scene.toggleArea(file);
  assert.equal(scene.scopeAt(body), ROOT); // file fechou: res encolheu e o ponto ficou fora
  assert.equal(scene.scopeAt({ x: res.x + 3, y: res.y + res.h - 3 }), res.id); // fechado não é escopo
});

test('abrir/fechar deixa o cabeçalho parado no lugar', () => {
  const { scene, fn } = setup();
  const at = () => [fn.x + fn.layout.headerX, fn.y + fn.layout.headerTop];
  const before = at();
  scene.toggleArea(fn);
  assert.deepEqual(at(), before);
  scene.toggleArea(fn);
  assert.deepEqual(at(), before);
});

test('fios só na mesma área; o ▷ do cabeçalho da Function liga com quem está dentro', () => {
  const { scene, add, fn, print } = setup();
  const outside = add('print', 900, 100);
  const pin = (node, dir, i = 0) => ({ node, pin: node[dir][i] });
  assert.ok(canConnect(pin(fn, 'outputs'), pin(print, 'inputs'), language).ok);
  const r = canConnect(pin(fn, 'outputs'), pin(outside, 'inputs'), language);
  assert.equal(r.ok, false);
  assert.match(r.reason, /fios não cruzam áreas/);
  assert.equal(canConnect(pin(print, 'outputs'), pin(outside, 'inputs'), language).ok, false);
});

test('apagar área apaga tudo dentro (e os fios); trazer para frente leva a área inteira', () => {
  const { scene, res, file, fn, print, add } = setup();
  const other = add('folder', 900, 100);
  scene.connect({ node: fn, pin: fn.outputs[0] }, { node: print, pin: print.inputs[0] });
  scene.bringToFront(print);
  assert.deepEqual(scene.inScope(ROOT).at(-1), res);
  assert.ok(scene.elements.indexOf(res) > scene.elements.indexOf(other));
  scene.remove([file.id]);
  assert.deepEqual(scene.elements.map((n) => n.id), [res.id, other.id].sort((a, b) => scene.elements.findIndex((n) => n.id === a) - scene.elements.findIndex((n) => n.id === b)));
  assert.equal(scene.wires.length, 0);
});

test('clique no ⇕ e duplo clique no cabeçalho abrem/fecham; esconder tira da seleção', () => {
  const { canvas, scene, selection, click, ev, fn, print } = setup();
  selection.set([print.id]);
  const t = togglePoint(fn);
  click(t.x, t.y);
  assert.equal(fn.open, false);
  assert.equal(selection.has(print.id), false);
  click(t.x, t.y);
  assert.equal(fn.open, true);
  const h = headerPoint(fn);
  canvas.dispatch('dblclick', ev(h.x, h.y));
  assert.equal(fn.open, false);
  canvas.dispatch('dblclick', ev(h.x, h.y));
  assert.equal(fn.open, true);
  assert.ok(scene);
});

test('arrastar o cabeçalho move a área com tudo dentro', () => {
  const { drag, res, file, fn, print } = setup();
  const before = [res, file, fn, print].map((n) => [n.x, n.y]);
  const h = headerPoint(res);
  drag(h, { x: h.x + 100, y: h.y + 40 });
  assert.deepEqual([res, file, fn, print].map((n) => [n.x, n.y]), before.map(([x, y]) => [x + 100, y + 40]));
});

test('puxador redimensiona; corpo vazio começa seleção presa à área; clique direito no corpo abre menu nela', () => {
  const { scene, selection, drag, click, menus, add, fn, print } = setup();
  const corner = { x: fn.x + fn.w - 3, y: fn.y + fn.h - 3 };
  const w = fn.w;
  drag(corner, { x: corner.x + 120, y: corner.y + 60 });
  assert.equal(fn.w, w + 120);
  // Seleção por retângulo no corpo da Function pega o Print, não o que está fora.
  const outside = add('print', fn.x + fn.w + 40, print.y);
  const start = { x: fn.x + fn.w - 5, y: fn.y + fn.h - pad - 5 };
  drag(start, { x: print.x - 5, y: print.y - 5 }); // da direita para a esquerda: pega o que toca
  assert.deepEqual([...selection.ids], [print.id]);
  assert.ok(!selection.has(outside.id));
  // Clique direito no corpo vazio abre o menu na área.
  click(start.x, start.y, { button: 2 });
  assert.equal(menus.at(-1).scope, fn.id);
  assert.ok(scene);
});

test('desenha área aberta (moldura, conteúdo, cabeçalho, puxador) e fechada', () => {
  const { canvas, scene, renderer, fn } = setup();
  canvas.calls.length = 0;
  renderer.draw();
  const texts = canvas.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  for (const t of ['res', 'player.gd', '_ready', 'Print']) assert.ok(texts.includes(t), t);
  scene.toggleArea(fn);
  canvas.calls.length = 0;
  renderer.draw();
  const texts2 = canvas.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.ok(texts2.includes('_ready'));
  assert.ok(!texts2.includes('Print')); // escondido
});

test('cores: pasta escolhida no inspetor, arquivo pela extensão, classe #196633', () => {
  const { scene, renderer, res, file, add } = setup();
  assert.equal(renderer.border(res), theme.node.border); // pasta sem cor: padrão
  scene.setField(res, 'color', '#ff0000');
  assert.equal(renderer.border(res), '#ff0000');
  assert.equal(renderer.border(file), language.extensions.gd);
  scene.setField(file, 'name', 'data.json');
  assert.equal(renderer.border(file), language.extensions.json);
  const cls = add('class', 900, 900);
  assert.equal(renderer.border(cls), '#196633');
});

test('salvar: hierarquia, aberta/fechada e puxador voltam iguais', () => {
  const { scene, camera, fn, file } = setup();
  scene.toggleArea(fn);
  file.manual = { w: 600, h: 0 };
  scene.fitAreas();
  const data = JSON.parse(JSON.stringify(serialize(scene, camera)));
  const other = new Scene({ language, areaPad: pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, language) });
  deserialize(data, { scene: other, camera: new Camera(), language });
  other.fitAreas();
  assert.deepEqual(serialize(other, camera), data);
  assert.equal(other.byId(fn.id).open, false);
  assert.equal(other.byId(file.id).w, 600);
});

test('cabeçalho da área: ⇕ vem antes do pino de fluxo', () => {
  const { fn } = setup();
  const exec = fn.outputs.find((p) => p.kind === 'flow');
  assert.ok(fn.layout.toggleX + fn.layout.toggleW < exec.hx - exec.size / 2); // hx: posição no cabeçalho
  assert.ok(exec.hx > fn.layout.titleX);
});
