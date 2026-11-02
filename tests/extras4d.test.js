// Etapa 4d: métodos dos tipos básicos, constantes e enums, singletons (sem target) e operadores.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Camera } from '../js/core/canvas/camera.js';
import { Languages } from '../js/core/languages.js';
import { layoutNode } from '../js/core/node.js';
import { ROOT, Scene } from '../js/core/scene.js';
import { deserialize, serialize } from '../js/core/storage.js';
import { builtinMethods, constants, singletons } from '../js/lang/godot/api/extras.js';
import { language as gdscript } from '../js/lang/godot/index.js';
import { theme } from '../js/theme/default.js';
import { installDom } from './fakeDom.js';

const languages = new Languages([gdscript]);
const def = (id) => languages.def(id, 'gdscript');
const ids = (pins) => pins.map((p) => p.id);

function setup() {
  installDom();
  const scene = new Scene({ languages, areaPad: theme.area.pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  const file = scene.addNode(languages.def('file'), { x: 0, y: 0, scope: ROOT, values: { name: 'player.gd', extends: 'CharacterBody2D' } });
  const fn = scene.addNode(def('function'), { x: 20, y: 60, scope: file.id, values: { name: 'jump' } });
  const add = (id, values) => scene.addNode(def(id), { x: 40, y: 120, scope: fn.id, values });
  const out = (n, id) => ({ node: n, pin: n.outputs.find((p) => p.id === id) });
  const inp = (n, id) => ({ node: n, pin: n.inputs.find((p) => p.id === id) });
  return { scene, file, fn, add, out, inp };
}

test('API: métodos dos tipos básicos, constantes (globais, classes, tipos) e singletons', () => {
  assert.ok(builtinMethods.Vector2.some(([n, , ret, f]) => n === 'normalized' && ret === 'Vector2' && f & 2));
  assert.deepEqual(constants.Vector2.find(([n]) => n === 'ZERO'), ['ZERO', 'Vector2']);
  assert.deepEqual(constants['@GlobalScope'].find(([n]) => n === 'KEY_SPACE'), ['KEY_SPACE', 'int']);
  assert.ok(constants.Node.some(([n]) => n === 'PROCESS_MODE_ALWAYS'));
  assert.ok(singletons.includes('Input') && singletons.includes('Engine'));
});

test('nós: método de tipo básico (target = o valor), constante, singleton sem target', () => {
  const normalized = def('b:Vector2.normalized');
  assert.deepEqual(ids(normalized.inputs), ['target']); // const: sem fluxo
  assert.deepEqual([normalized.inputs[0].label, normalized.inputs[0].type, !!normalized.inputs[0].self], ['value', 'Vector2', false]);
  assert.deepEqual(ids(def('b:Array.append').inputs), ['run', 'target', 'value']); // muda o Array: fluxo
  const zero = def('c:Vector2.ZERO');
  assert.equal(zero.concept, 'constant');
  assert.equal(zero.compact, true);
  assert.deepEqual(zero.outputs.map((p) => p.type), ['Vector2']);
  assert.equal(def('c:@GlobalScope.KEY_SPACE').category, 'Global');
  const axis = def('m:Input.get_axis');
  assert.ok(!axis.inputs.some((p) => p.id === 'target')); // singleton
  assert.deepEqual(axis.inputs.map((p) => p.id), ['negative_action', 'positive_action']);
});

test('menu: fio de uma saída Vector2 traz os métodos dela; constantes e singletons na busca geral', () => {
  const { scene, fn, add, out } = setup();
  const v = add('variable', { name: 'dir', type: 'Vector2' });
  const fromV = scene.menuDefs(fn.id, out(v, 'value'));
  assert.ok(fromV.some((d) => d.id === 'b:Vector2.normalized'));
  const all = scene.menuDefs(fn.id);
  const search = (id) => all.find((d) => d.id === id);
  assert.equal(search('c:@GlobalScope.KEY_SPACE').searchOnly, true);
  assert.equal(search('m:Input.get_axis').searchOnly, true);
  assert.ok(!all.some((d) => d.id === 'c:Node.PROCESS_MODE_ALWAYS' && !d.searchOnly)); // constantes: só buscando
  // Método de tipo básico sem fio no target usa o valor digitado (sem aviso de self).
  const norm = add('b:Vector2.normalized');
  scene.setInputValue(norm, 'target', [3, 4]);
  assert.deepEqual(norm.inputValues.target, [3, 4]);
  assert.equal(scene.selfMissing(norm), false);
  assert.equal(scene.selfMissing(add('m:Input.get_axis')), false);
});

test('operadores: Multiply com Type (padrão float) e Infer type; comparações e lógica', () => {
  const { scene, add, out, inp } = setup();
  const mul = add('multiply');
  assert.deepEqual([mul.inputs.map((p) => p.type), mul.outputs[0].type], [['float', 'float'], 'float']);
  scene.setField(mul, 'type', 'Vector2');
  assert.deepEqual(mul.inputs.map((p) => p.type), ['Vector2', 'Vector2']);
  scene.setField(mul, 'type', 'float');
  scene.setField(mul, 'infer', true);
  const n = add('variable', { name: 'n', type: 'int' });
  assert.ok(scene.connect(out(n, 'value'), inp(mul, 'a')).ok);
  assert.equal(mul.outputs[0].type, 'int'); // pegou o tipo do a
  const eq = add('equal');
  const iff = add('if');
  const name = add('variable', { name: 'name', type: 'String' });
  assert.ok(scene.connect(out(name, 'value'), inp(eq, 'a')).ok); // qualquer valor
  assert.ok(scene.connect(out(eq, 'result'), inp(iff, 'condition')).ok);
  const not = add('not');
  assert.ok(scene.connect(out(eq, 'result'), inp(not, 'a')).ok);
  assert.deepEqual(['subtract', 'divide', 'modulo', 'not_equal', 'less', 'less_equal', 'greater_equal', 'or'].map((id) => !!def(id)), Array(8).fill(true));
});

test('exemplo: velocity.x = Input.get_axis("ui_left", "ui_right") * speed', () => {
  const { scene, file, add, out, inp } = setup();
  const speed = scene.addNode(def('variable'), { x: 600, y: 20, scope: file.id, values: { name: 'speed', type: 'float' } });
  const get = scene.addReference(speed, 'get');
  scene.moveInto([get], add('if').scope);
  const axis = add('m:Input.get_axis');
  scene.setInputValue(axis, 'negative_action', 'ui_left');
  const mul = add('multiply');
  const setVel = add('p:CharacterBody2D.velocity.set');
  scene.splitPin(setVel, setVel.inputs.find((p) => p.id === 'value'));
  assert.ok(scene.connect(out(axis, 'result'), inp(mul, 'a')).ok);
  assert.ok(scene.connect(out(get, 'value'), inp(mul, 'b')).ok);
  assert.ok(scene.connect(out(mul, 'result'), inp(setVel, 'value.x')).ok);
  assert.equal(scene.selfMissing(setVel), false); // o script é um CharacterBody2D
  assert.equal(axis.inputValues.negative_action, 'ui_left'); // StringName: texto digitado
});

test('salvar: constante e método de tipo básico voltam pelo id', () => {
  const { scene, add } = setup();
  const zero = add('c:Vector2.ZERO');
  const len = add('b:Vector2.length');
  const data = JSON.parse(JSON.stringify(serialize(scene, new Camera())));
  const again = new Scene({ languages });
  deserialize(data, { scene: again, camera: new Camera() });
  assert.equal(again.byId(zero.id).type, 'c:Vector2.ZERO');
  assert.deepEqual(ids(again.byId(len.id).outputs), ['result']);
});
