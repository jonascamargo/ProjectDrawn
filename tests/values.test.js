// Valores digitados nos pinos (etapa 2d): tipos (int, float, bool, text, Vector3), valor no nó no
// lugar do nome (um só no meio do par), inspetor com o campo do tipo, origem do fio e desconectar.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Camera } from '../js/core/canvas/camera.js';
import { Renderer } from '../js/core/canvas/renderer.js';
import { Selection } from '../js/core/canvas/selection.js';
import { layoutNode } from '../js/core/node.js';
import { ROOT, Scene } from '../js/core/scene.js';
import { deserialize, serialize } from '../js/core/storage.js';
import { coerceValue, defaultValue, formatValue } from '../js/core/values.js';
import { language, languages } from './langs.js';
import { theme } from '../js/theme/default.js';
import { Inspector } from '../js/ui/inspector.js';
import { FakeElement, installDom } from './fakeDom.js';

const T = language.types;

function setup() {
  installDom();
  const canvas = new FakeElement('canvas');
  const camera = new Camera();
  const scene = new Scene({ languages, areaPad: theme.area.pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  const selection = new Selection();
  const renderer = new Renderer(canvas, { camera, scene, selection, theme });
  renderer.resize(1600, 1200);
  const inspector = new Inspector(document.body, { scene, selection });
  const file = scene.addNode(languages.def('file'), { x: 0, y: 0, scope: ROOT, values: { name: 'player.gd' } });
  const add = (id, x, y, values) => scene.addNode(languages.def(id), { x, y, scope: file.id, values });
  return { canvas, scene, selection, renderer, inspector, file, add };
}

const find = (el, test) => (test(el) ? el : el.children.map((c) => find(c, test)).find(Boolean) ?? null);
const findAll = (el, test, out = []) => {
  if (test(el)) out.push(el);
  el.children.forEach((c) => findAll(c, test, out));
  return out;
};
const texts = (canvas) => canvas.calls.filter((c) => c[0] === 'fillText');

test('valores por tipo: int só inteiro, float com ponto, bool, text, Vector3 com 3 números', () => {
  assert.equal(coerceValue(T.int, '7.9'), 7);
  assert.equal(coerceValue(T.int, 'abc'), 0);
  assert.equal(coerceValue(T.float, '2,5'), 2.5);
  assert.equal(coerceValue(T.bool, 'true'), true);
  assert.equal(coerceValue(T.text, 12), '12');
  assert.deepEqual(coerceValue(T.vector3, ['1', 'x', 3.5]), [1, 0, 3.5]);
  assert.deepEqual(defaultValue(T.vector3), [0, 0, 0]);
  assert.equal(defaultValue(T.any), null); // any não tem campo
  assert.equal(formatValue(T.float, 2), '2.0');
  assert.equal(formatValue(T.int, 3), '3');
  assert.equal(formatValue(T.text, 'oi'), '"oi"');
  assert.equal(formatValue(T.vector3, [0, 1, 0]), '(0.0, 1.0, 0.0)');
});

test('no nó: o valor no lugar do nome; com fio, o nome volta; no par, um texto só no meio', () => {
  const { scene, canvas, renderer, add } = setup();
  const sum = add('add', 0, 100);
  scene.setInputValue(sum, 'a', '3.5');
  canvas.calls.length = 0;
  renderer.draw();
  const a = texts(canvas).find((c) => c[1] === '3.5');
  assert.ok(a, 'valor 3.5 no lugar de "a"');
  assert.ok(texts(canvas).some((c) => c[1] === '0.0')); // b sem valor: o padrão
  assert.ok(!texts(canvas).some((c) => c[1] === 'a'));
  const v = add('variable', 400, 100, { name: 'pos', type: 'vector3' });
  scene.setInputValue(v, 'value', [1, 2, 3]);
  canvas.calls.length = 0;
  renderer.draw();
  const shown = texts(canvas).filter((c) => c[1] === '(1.0, 2.0, 3.0)');
  assert.equal(shown.length, 1); // um só (não dois "value")
  assert.equal(shown[0][2], v.x + v.w / 2); // no meio da linha
  assert.ok(!texts(canvas).some((c) => c[1] === 'value'));
  // Com fio na entrada: volta o nome (no meio, ainda um só).
  const src = add('variable', 900, 100, { name: 'src', type: 'vector3' });
  scene.connect({ node: src, pin: src.outputs.find((p) => p.id === 'value') }, { node: v, pin: v.inputs.find((p) => p.id === 'value') });
  canvas.calls.length = 0;
  renderer.draw();
  assert.equal(texts(canvas).filter((c) => c[1] === 'value' && c[2] === v.x + v.w / 2).length, 1);
});

test('mudar o tipo converte o valor (o que não serve volta ao padrão); any não tem valor', () => {
  const { scene, add } = setup();
  const v = add('variable', 0, 0, { name: 'n', type: 'float' });
  scene.setInputValue(v, 'value', 2.75);
  scene.setField(v, 'type', 'int');
  assert.equal(v.inputValues.value, 2);
  scene.setField(v, 'type', 'vector3');
  assert.deepEqual(v.inputValues.value, [0, 0, 0]);
  scene.setField(v, 'type', 'any');
  assert.equal('value' in v.inputValues, false);
});

test('inspetor: campo pelo tipo (int, float, bool, Vector3 com x/y/z)', () => {
  const { scene, selection, inspector, add } = setup();
  const v = add('variable', 0, 0, { name: 'n', type: 'int' });
  selection.set([v.id]);
  inspector.refresh();
  let input = find(inspector.body, (e) => e.tagName === 'INPUT' && e.type === 'number');
  assert.equal(input.step, '1');
  input.value = '4.8';
  input.dispatch('input');
  assert.equal(v.inputValues.value, 4); // int: só inteiro
  scene.setField(v, 'type', 'float');
  inspector.refresh();
  input = find(inspector.body, (e) => e.tagName === 'INPUT' && e.type === 'number');
  assert.equal(input.step, 'any');
  input.value = '1.25';
  input.dispatch('input');
  assert.equal(v.inputValues.value, 1.25);
  scene.setField(v, 'type', 'bool');
  inspector.refresh();
  const check = findAll(inspector.body, (e) => e.tagName === 'INPUT' && e.type === 'checkbox').at(-1);
  check.checked = true;
  check.dispatch('change');
  assert.equal(v.inputValues.value, true);
  scene.setField(v, 'type', 'vector3');
  inspector.refresh();
  const xyz = findAll(inspector.body, (e) => e.tagName === 'INPUT' && e.type === 'number');
  assert.equal(xyz.length, 3);
  assert.match(inspector.body.text, /x.*y.*z/);
  xyz[1].value = '9';
  xyz[1].dispatch('input');
  assert.deepEqual(v.inputValues.value, [0, 9, 0]);
});

test('inspetor: com fio, mostra a origem e desconecta; Add mostra a e b', () => {
  const { scene, selection, inspector, add } = setup();
  const sum = add('add', 0, 0);
  const v = add('variable', 300, 0, { name: 'speed', type: 'float' });
  scene.connect({ node: sum, pin: sum.outputs[0] }, { node: v, pin: v.inputs.find((p) => p.id === 'value') });
  selection.set([v.id]);
  inspector.refresh();
  assert.match(inspector.body.text, /⟵.*Add\.result/);
  const button = findAll(inspector.body, (e) => e.tagName === 'BUTTON').find((b) => b.title === 'Disconnect');
  assert.equal(button.className, 'inspector__disconnect'); // ícone no lugar do texto
  assert.equal(button.textContent, '');
  button.dispatch('click');
  assert.equal(scene.wiresOf(v).length, 0);
  assert.ok(find(inspector.body, (e) => e.tagName === 'INPUT' && e.type === 'number')); // voltou o campo
  selection.set([sum.id]);
  inspector.refresh();
  const labels = findAll(inspector.body, (e) => e.tagName === 'LABEL').map((l) => l.children[0].textContent);
  assert.deepEqual(labels, ['a', 'b']);
});

test('inspetor: referência quebrada ou fora do alcance mostra o aviso e religa pela lista', () => {
  const { scene, selection, inspector, add } = setup();
  const health = add('variable', 0, 0, { name: 'health', type: 'int' });
  const hp = add('variable', 0, 200, { name: 'hp', type: 'float' });
  const get = scene.addReference(health, 'get');
  scene.remove([health.id]);
  selection.set([get.id]);
  inspector.refresh();
  assert.match(inspector.body.text, /foi apagado/);
  const select = find(inspector.body, (e) => e.tagName === 'SELECT');
  assert.deepEqual(select.children.map((o) => o.textContent), ['—', 'hp']);
  select.value = String(hp.id);
  select.dispatch('change');
  assert.equal(get.ref, hp.id);
  assert.equal(get.title, 'hp');
  inspector.refresh();
  assert.match(inspector.body.text, /Referência a "hp"/);
});

test('salvar guarda os valores digitados', () => {
  const { scene, add } = setup();
  const v = add('variable', 0, 0, { name: 'pos', type: 'vector3' });
  scene.setInputValue(v, 'value', [1, 2, 3]);
  const data = JSON.parse(JSON.stringify(serialize(scene, new Camera())));
  const again = new Scene({ languages, areaPad: theme.area.pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  deserialize(data, { scene: again, camera: new Camera() });
  assert.deepEqual(again.byId(v.id).inputValues.value, [1, 2, 3]);
});
