// Etapa 3b: parâmetros e retorno da Function (inspetor), nó do parâmetro (arrastado do inspetor),
// Return dentro da função e Call (Ctrl+clique na função) seguindo nome, parâmetros e retorno.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortcuts } from '../js/config/shortcuts.js';
import { Camera } from '../js/core/canvas/camera.js';
import { CanvasInput } from '../js/core/canvas/input.js';
import { Renderer } from '../js/core/canvas/renderer.js';
import { Selection } from '../js/core/canvas/selection.js';
import { layoutNode, shownPins } from '../js/core/node.js';
import { ROOT, Scene } from '../js/core/scene.js';
import { deserialize, serialize } from '../js/core/storage.js';
import { theme } from '../js/theme/default.js';
import { Inspector } from '../js/ui/inspector.js';
import { FakeElement, installDom } from './fakeDom.js';
import { languages } from './langs.js';

function setup() {
  installDom();
  const canvas = new FakeElement('canvas');
  const camera = new Camera();
  const scene = new Scene({ languages, areaPad: theme.area.pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  const selection = new Selection();
  const renderer = new Renderer(canvas, { camera, scene, selection, theme });
  renderer.resize(1600, 1200);
  new CanvasInput(canvas, { camera, scene, selection, renderer, theme, shortcuts }).attach();
  const add = (id, x, y, scope, values) => scene.addNode(languages.def(id), { x, y, scope, values });
  const file = add('file', 0, 0, ROOT, { name: 'player.gd' });
  const fn = add('function', 20, 60, file.id, { name: 'damage' });
  const other = add('function', 20, 600, file.id, { name: '_ready' });
  scene.fitAreas();
  return { canvas, scene, selection, renderer, add, file, fn, other };
}
const ids = (pins) => pins.map((p) => p.id);
const params = (...list) => list.map(([id, name, type]) => ({ id, name, type }));

test('Ctrl+clique na função cria a chamada ao lado, com um pino por parâmetro e o retorno', () => {
  const { canvas, scene, selection, fn } = setup();
  scene.setField(fn, 'params', params(['p1', 'amount', 'int'], ['p2', 'crit', 'bool']));
  scene.setField(fn, 'returns', 'float');
  const p = { x: fn.x + fn.layout.headerX + fn.layout.titleX + 4, y: fn.y + fn.layout.headerTop + fn.layout.headerY };
  canvas.dispatch('pointerdown', { clientX: p.x, clientY: p.y, button: 0, pointerId: 1, ctrlKey: true });
  canvas.dispatch('pointerup', { clientX: p.x, clientY: p.y, button: 0, pointerId: 1, ctrlKey: true });
  const call = scene.elements.at(-1);
  assert.equal(call.concept, 'call');
  assert.equal(call.title, 'damage');
  assert.equal(call.scope, fn.scope);
  assert.ok(call.x > fn.x + fn.w);
  assert.deepEqual(selection.ids, new Set([call.id]));
  assert.deepEqual(ids(call.inputs), ['run', 'p1', 'p2']);
  assert.deepEqual(call.inputs.map((q) => q.label), ['', 'amount', 'crit']);
  assert.deepEqual(call.inputs.map((q) => q.type), [null, 'int', 'bool']);
  assert.deepEqual(ids(call.outputs), ['next', 'value']);
  assert.equal(call.outputs[1].type, 'float');
});

test('a chamada segue a função: renomear, trocar tipo, remover parâmetro (o fio dele sai), void', () => {
  const { scene, add, fn, other } = setup();
  scene.setField(fn, 'params', params(['p1', 'amount', 'int'], ['p2', 'crit', 'bool']));
  const call = scene.addReference(fn, 'get');
  scene.moveInto([call], other.id);
  const v = add('variable', 40, 700, other.id, { name: 'hp', type: 'int' });
  const b = add('variable', 40, 800, other.id, { name: 'lucky', type: 'bool' });
  assert.ok(scene.connect({ node: v, pin: v.outputs.at(-1) }, { node: call, pin: call.inputs[1] }).ok);
  assert.ok(scene.connect({ node: b, pin: b.outputs.at(-1) }, { node: call, pin: call.inputs[2] }).ok);
  scene.setInputValue(call, 'p1', '5');
  scene.setField(fn, 'name', 'hit');
  assert.equal(call.title, 'hit');
  scene.setField(fn, 'params', params(['p1', 'value', 'int']));
  assert.deepEqual(ids(call.inputs), ['run', 'p1']);
  assert.equal(call.inputs[1].label, 'value');
  assert.equal(scene.wiresOf(call).length, 1); // o do p1 continua; o do p2 saiu
  assert.equal(call.inputValues.p1, 5);
  scene.setField(fn, 'params', params(['p1', 'value', 'text']));
  assert.equal(scene.wiresOf(call).length, 0); // int não entra em text
  assert.equal(call.inputValues.p1, '5');
  scene.setField(fn, 'returns', 'int');
  assert.deepEqual(ids(call.outputs), ['next', 'value']);
  scene.setField(fn, 'returns', null);
  assert.deepEqual(ids(call.outputs), ['next']);
  assert.equal(call.outOfReach, false); // outra função do mesmo arquivo: ao alcance
  scene.remove([fn.id]);
  assert.equal(call.broken, true);
});

test('Return só dentro da função; o valor segue o tipo de retorno (void: sem o pino, sem o fio)', () => {
  const { scene, add, file, fn } = setup();
  assert.ok(!scene.menuDefs(file.id).some((d) => d.id === 'return'));
  assert.ok(scene.menuDefs(fn.id).some((d) => d.id === 'return'));
  const ret = add('return', 40, 120, fn.id);
  assert.deepEqual(ids(shownPins(ret, 'in')), ['run']); // void
  scene.setField(fn, 'returns', 'int');
  assert.deepEqual(ids(shownPins(ret, 'in')), ['run', 'value']);
  assert.equal(ret.inputs[1].type, 'int');
  const v = add('variable', 40, 300, fn.id, { name: 'n', type: 'int' });
  assert.ok(scene.connect({ node: v, pin: v.outputs.at(-1) }, { node: ret, pin: ret.inputs[1] }).ok);
  scene.setField(fn, 'returns', null);
  assert.equal(scene.wiresOf(ret).length, 0);
  assert.match(scene.canDrop([ret], file.id).reason, /não aceita Return/);
});

test('nó do parâmetro: nasce na função com nome e tipo; fora dela fica marcado; removido fica quebrado', () => {
  const { scene, fn, other, file } = setup();
  scene.setField(fn, 'params', params(['p1', 'amount', 'int']));
  assert.equal(scene.addParameter(fn, 'p1', { x: 0, y: 0 }, ROOT), null); // na raiz não cabe
  const node = scene.addParameter(fn, 'p1', { x: 40, y: 120 }, fn.id);
  assert.equal(node.title, 'amount');
  assert.equal(node.outputs[0].type, 'int');
  assert.equal(node.outOfReach, false);
  scene.setField(fn, 'params', params(['p1', 'damage', 'float']));
  assert.equal(node.title, 'damage');
  assert.equal(node.tag, 'float');
  scene.moveInto([node], other.id);
  assert.equal(node.outOfReach, true); // em outra função
  scene.moveInto([node], file.id);
  assert.equal(node.outOfReach, true); // no arquivo, fora da função
  scene.moveInto([node], fn.id);
  assert.equal(node.outOfReach, false);
  scene.setField(fn, 'params', []);
  assert.equal(node.broken, true);
  assert.deepEqual(scene.relinkCandidates(node), []);
});

test('inspetor: Parameters (adicionar, nome e tipo, ordem, remover), Return type com void e arrastar a alça', () => {
  const { scene, selection, fn } = setup();
  const dragged = [];
  const inspector = new Inspector(document.body, { scene, selection, onDragParam: (f, p) => dragged.push([f, p.id]) });
  selection.set([fn.id]);
  inspector.refresh();
  const all = (f, el = inspector.body, out = []) => (f(el) && out.push(el), el.children.forEach((c) => all(f, c, out)), out);
  const button = (text) => all((e) => e.tagName === 'BUTTON' && e.textContent === text);
  button('+ Add')[0].dispatch('click');
  button('+ Add')[0].dispatch('click');
  assert.deepEqual(fn.values.params, params(['p1', 'arg0', 'any'], ['p2', 'arg1', 'any']));
  const rows = () => all((e) => e.className === 'inspector__param');
  // Digitar o nome não redesenha; trocar o tipo depois mantém o nome digitado.
  const name = all((e) => e.tagName === 'INPUT' && e.type === 'text', rows()[1])[0];
  name.value = 'speed';
  name.dispatch('input');
  const type = all((e) => e.tagName === 'SELECT', rows()[1])[0];
  type.value = 'float';
  type.dispatch('change');
  assert.deepEqual(fn.values.params[1], { id: 'p2', name: 'speed', type: 'float' });
  button('↑')[1].dispatch('click');
  assert.deepEqual(fn.values.params.map((p) => p.id), ['p2', 'p1']);
  button('×')[1].dispatch('click');
  assert.deepEqual(fn.values.params.map((p) => p.id), ['p2']);
  button('+ Add')[0].dispatch('click');
  assert.equal(fn.values.params[1].id, 'p3'); // id novo, não reaproveita
  const returns = all((e) => e.tagName === 'SELECT').at(-1);
  assert.equal(returns.children[0].textContent, 'void');
  assert.equal(returns.value, '');
  returns.value = 'int';
  returns.dispatch('change');
  assert.equal(fn.values.returns, 'int');
  all((e) => e.className === 'inspector__drag')[0].dispatch('pointerdown');
  assert.deepEqual(dragged, [[fn, 'p2']]);
});

test('salvar: parâmetros, chamada com fio no parâmetro e nó do parâmetro voltam iguais', () => {
  const { scene, add, fn, other } = setup();
  scene.setField(fn, 'params', params(['p1', 'amount', 'vector3']));
  scene.setField(fn, 'returns', 'int');
  const call = scene.addReference(fn, 'get');
  scene.moveInto([call], other.id);
  const v = add('variable', 40, 700, other.id, { name: 'pos', type: 'vector3' });
  scene.connect({ node: v, pin: v.outputs.at(-1) }, { node: call, pin: call.inputs[1] });
  const param = scene.addParameter(fn, 'p1', { x: 40, y: 120 }, fn.id);
  scene.splitPin(param, param.outputs[0]);
  const data = JSON.parse(JSON.stringify(serialize(scene, new Camera())));
  const again = new Scene({ languages, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  deserialize(data, { scene: again, camera: new Camera() });
  const call2 = again.byId(call.id);
  assert.deepEqual(ids(call2.inputs), ['run', 'p1']);
  assert.deepEqual(ids(call2.outputs), ['next', 'value']);
  assert.equal(again.wiresOf(call2).length, 1);
  const param2 = again.byId(param.id);
  assert.equal(param2.refKey, 'p1');
  assert.equal(param2.title, 'amount');
  assert.deepEqual(ids(shownPins(param2, 'out')), ['value.x', 'value.y', 'value.z']);
});

test('app: arrastar o parâmetro do inspetor e soltar dentro da função cria o nó lá', async () => {
  const { canvas } = installDom();
  const { app } = await import('../js/main.js');
  const player = app.scene.elements.find((n) => n.title === 'player.gd');
  const ready = app.scene.addNode(app.languages.def('function'), { x: player.x + 20, y: player.y + 500, scope: player.id, values: { name: 'jump' } });
  app.scene.fitAreas();
  Object.assign(app.camera, { x: ready.x - 100, y: ready.y - 100, zoom: 1 }); // a função na tela
  app.scene.setField(ready, 'params', params(['p1', 'delta', 'float']));
  app.selection.set([ready.id]);
  app.renderer.requestRender();
  const all = (f, el = app.inspector.body, out = []) => (f(el) && out.push(el), el.children.forEach((c) => all(f, c, out)), out);
  all((e) => e.className === 'inspector__drag')[0].dispatch('pointerdown');
  assert.equal(document.body.classList.contains('dragging-item'), true);
  const at = app.camera.toScreen(ready.x + ready.w - 20, ready.y + ready.h - 20);
  const r = canvas.getBoundingClientRect();
  document.dispatch('pointerup', { clientX: at.x + r.left, clientY: at.y + r.top });
  const node = app.scene.elements.at(-1);
  assert.equal(node.concept, 'parameter');
  assert.equal(node.title, 'delta');
  assert.equal(node.scope, ready.id);
  assert.equal(document.body.classList.contains('dragging-item'), false);
  assert.deepEqual(app.selection.ids, new Set([node.id]));
});
