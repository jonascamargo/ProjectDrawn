// Etapa 2e: abrir/fechar pinos com componentes (Vector2/Vector3), pinos de fluxo opcionais na
// Variable e o menu do clique direito no pino.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortcuts } from '../js/config/shortcuts.js';
import { Camera } from '../js/core/canvas/camera.js';
import { CanvasInput } from '../js/core/canvas/input.js';
import { Renderer } from '../js/core/canvas/renderer.js';
import { Selection } from '../js/core/canvas/selection.js';
import { headerPin, layoutNode, pinAnchor, shownPins } from '../js/core/node.js';
import { ROOT, Scene } from '../js/core/scene.js';
import { deserialize, serialize } from '../js/core/storage.js';
import { language, languages } from './langs.js';
import { theme } from '../js/theme/default.js';
import { Inspector } from '../js/ui/inspector.js';
import { FakeElement, installDom } from './fakeDom.js';

function setup() {
  installDom();
  const canvas = new FakeElement('canvas');
  const camera = new Camera();
  const scene = new Scene({ languages, areaPad: theme.area.pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  const selection = new Selection();
  const renderer = new Renderer(canvas, { camera, scene, selection, theme });
  renderer.resize(1600, 1200);
  const menus = [];
  new CanvasInput(canvas, { camera, scene, selection, renderer, theme, shortcuts, onPinMenu: (screen, at) => menus.push(at) }).attach();
  const file = scene.addNode(languages.def('file'), { x: 0, y: 0, scope: ROOT, values: { name: 'player.gd' } });
  const add = (id, x, y, values) => scene.addNode(languages.def(id), { x, y, scope: file.id, values });
  return { canvas, scene, selection, renderer, menus, add, file };
}
const pin = (node, side, id) => node[side === 'in' ? 'inputs' : 'outputs'].find((p) => p.id === id);
const ids = (pins) => pins.map((p) => p.id);

test('abrir a saída Vector3: x, y, z float, cada um com pino; fechar volta e tira os fios', () => {
  const { scene, add } = setup();
  const v = add('variable', 0, 0, { name: 'pos', type: 'vector3' });
  const sum = add('add', 400, 0);
  const out = pin(v, 'out', 'value');
  assert.equal(scene.canSplit(v, out), true);
  scene.splitPin(v, out);
  assert.deepEqual(ids(shownPins(v, 'out')), ['value.x', 'value.y', 'value.z']);
  assert.ok(shownPins(v, 'out').every((p) => p.type === 'float' && p.parent === 'value'));
  // Cada componente liga separado (float → float).
  assert.ok(scene.connect({ node: v, pin: pin(v, 'out', 'value.y') }, { node: sum, pin: sum.inputs[0] }).ok);
  scene.recombinePin(v, out);
  assert.deepEqual(ids(shownPins(v, 'out')), ['value']);
  assert.equal(scene.wiresOf(v).length, 0);
});

test('abrir a entrada: valores digitados por componente vão para o vetor; com fio, o componente usa o fio', () => {
  const { scene, add } = setup();
  const v = add('variable', 0, 0, { name: 'pos', type: 'vector3' });
  scene.setInputValue(v, 'value', [1, 2, 3]);
  const input = pin(v, 'in', 'value');
  scene.splitPin(v, input);
  const z = pin(v, 'in', 'value.z');
  assert.equal(scene.inputValue(v, z), 3);
  scene.setInputValue(v, 'value.z', '7.5');
  assert.deepEqual(v.inputValues.value, [1, 2, 7.5]);
  // Os dois lados abertos: value.x ↔ value.x na mesma linha (par), cada componente na sua.
  scene.splitPin(v, pin(v, 'out', 'value'));
  assert.equal(pin(v, 'in', 'value.x').cy, pin(v, 'out', 'value.x').cy);
  assert.ok(pin(v, 'in', 'value.y').cy > pin(v, 'in', 'value.x').cy);
  scene.recombinePin(v, input);
  assert.deepEqual(v.inputValues.value, [1, 2, 7.5]); // o valor fica no vetor inteiro
});

test('abrir tira os fios do pino inteiro; trocar o tipo fecha o pino aberto; int/any não abrem', () => {
  const { scene, add } = setup();
  const v = add('variable', 0, 0, { name: 'pos', type: 'vector2' });
  const w = add('variable', 400, 0, { name: 'other', type: 'vector2' });
  scene.connect({ node: v, pin: pin(v, 'out', 'value') }, { node: w, pin: pin(w, 'in', 'value') });
  scene.splitPin(v, pin(v, 'out', 'value'));
  assert.deepEqual(ids(shownPins(v, 'out')), ['value.x', 'value.y']);
  assert.equal(scene.wiresOf(v).length, 0);
  scene.setField(v, 'type', 'int');
  assert.deepEqual(ids(shownPins(v, 'out')), ['value']);
  assert.equal(scene.canSplit(v, pin(v, 'out', 'value')), false);
  scene.setField(v, 'type', 'any');
  assert.equal(scene.canSplit(v, pin(v, 'out', 'value')), false);
});

test('referência acompanha o tipo sem estragar o pino aberto dela', () => {
  const { scene, add } = setup();
  const v = add('variable', 0, 0, { name: 'pos', type: 'vector3' });
  const get = scene.addReference(v, 'get');
  assert.equal(get.h, 40); // compacto
  scene.splitPin(get, get.outputs[0]);
  assert.ok(get.h > 40); // aberto: vira nó normal, um componente por linha
  scene.syncReference(get);
  assert.deepEqual(shownPins(get, 'out').map((p) => p.type), ['float', 'float', 'float']);
  scene.recombinePin(get, get.outputs[0]);
  assert.equal(get.h, 40); // fechado: compacto de novo
  scene.splitPin(get, get.outputs[0]);
  scene.setField(v, 'type', 'vector2');
  assert.deepEqual(ids(shownPins(get, 'out')), ['value']); // tipo mudou: fecha
});

test('Flow pins: marcado aparece ▷ no cabeçalho (entrada e saída); desmarcado some com os fios', () => {
  const { scene, add } = setup();
  const v = add('variable', 0, 0, { name: 'hp', type: 'int' });
  const start = add('start', -300, 0);
  assert.equal(headerPin(shownPins(v, 'in')), null);
  scene.setField(v, 'flow', true);
  const run = pin(v, 'in', 'run');
  assert.equal(headerPin(shownPins(v, 'in')), run);
  assert.equal(run.cy, 20); // no cabeçalho
  assert.ok(pin(v, 'out', 'next').cx > run.cx);
  assert.ok(scene.connect({ node: start, pin: start.outputs[0] }, { node: v, pin: run }).ok);
  scene.setField(v, 'flow', false);
  assert.equal(scene.wiresOf(v).length, 0);
  assert.equal(scene.pinAt(pinAnchor(v, run), 5)?.pin === run, false); // escondido não é clicável
});

test('clique direito sem arrastar num pino pede o menu; arrastando é pan', () => {
  const { canvas, scene, menus, add } = setup();
  const v = add('variable', 100, 100, { name: 'pos', type: 'vector3' });
  scene.fitAreas();
  const p = pinAnchor(v, pin(v, 'out', 'value'));
  canvas.dispatch('pointerdown', { clientX: p.x, clientY: p.y, button: 2, pointerId: 1 });
  canvas.dispatch('pointerup', { clientX: p.x, clientY: p.y, button: 2, pointerId: 1 });
  assert.equal(menus.length, 1);
  assert.equal(menus[0].pin.id, 'value');
  canvas.dispatch('pointerdown', { clientX: p.x, clientY: p.y, button: 2, pointerId: 1 });
  canvas.dispatch('pointermove', { clientX: p.x + 40, clientY: p.y, button: 2, pointerId: 1 });
  canvas.dispatch('pointerup', { clientX: p.x + 40, clientY: p.y, button: 2, pointerId: 1 });
  assert.equal(menus.length, 1);
});

test('inspetor: seção Pins com Split/Recombine; entradas dos componentes como float', () => {
  const { scene, selection, add } = setup();
  const inspector = new Inspector(document.body, { scene, selection });
  const v = add('variable', 0, 0, { name: 'pos', type: 'vector2' });
  selection.set([v.id]);
  inspector.refresh();
  const find = (el, f) => (f(el) ? el : el.children.map((c) => find(c, f)).find(Boolean) ?? null);
  const all = (el, f, out = []) => (f(el) && out.push(el), el.children.forEach((c) => all(c, f, out)), out);
  const buttons = all(inspector.body, (e) => e.tagName === 'BUTTON' && e.textContent === 'Split');
  assert.equal(buttons.length, 2); // entrada e saída value
  buttons[0].dispatch('click');
  assert.deepEqual(ids(shownPins(v, 'in')).filter((id) => id.startsWith('value')), ['value.x', 'value.y']);
  const labels = all(inspector.body, (e) => e.tagName === 'LABEL').map((l) => l.children[0].textContent);
  assert.ok(labels.includes('value.x') && labels.includes('value.y'));
  assert.ok(find(inspector.body, (e) => e.tagName === 'BUTTON' && /Recombine \(2\)/.test(e.textContent)));
});

test('salvar guarda os pinos abertos (e os fios nos componentes)', () => {
  const { scene, add } = setup();
  const v = add('variable', 0, 0, { name: 'pos', type: 'vector3' });
  const sum = add('add', 400, 0);
  scene.splitPin(v, pin(v, 'out', 'value'));
  scene.connect({ node: v, pin: pin(v, 'out', 'value.x') }, { node: sum, pin: sum.inputs[0] });
  const data = JSON.parse(JSON.stringify(serialize(scene, new Camera())));
  const again = new Scene({ languages, areaPad: theme.area.pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  deserialize(data, { scene: again, camera: new Camera() });
  const v2 = again.byId(v.id);
  assert.deepEqual(ids(shownPins(v2, 'out')), ['value.x', 'value.y', 'value.z']);
  assert.equal(again.wires.length, 1);
  assert.equal(again.wires[0].from.pin, 'value.x');
});

test('menu de contexto: abre com as ações, escolher executa e fecha', async () => {
  installDom();
  const { ContextMenu } = await import('../js/core/canvas/contextMenu.js');
  const menu = new ContextMenu(document.body);
  let ran = 0;
  menu.open({ x: 10, y: 10 }, [{ label: 'Split', run: () => ran++ }]);
  assert.equal(menu.el.hidden, false);
  menu.el.children[0].dispatch('pointerdown');
  assert.equal(ran, 1);
  assert.equal(menu.el.hidden, true);
});
