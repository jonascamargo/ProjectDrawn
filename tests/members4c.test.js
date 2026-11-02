// Etapa 4c: métodos e propriedades das classes da Godot como nós (montados na hora), pino target
// (sem fio = o próprio script) e o menu pela cadeia do script, pelo fio de um objeto e pela busca.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Camera } from '../js/core/canvas/camera.js';
import { NodeMenu } from '../js/core/canvas/nodeMenu.js';
import { Selection } from '../js/core/canvas/selection.js';
import { Languages } from '../js/core/languages.js';
import { layoutNode } from '../js/core/node.js';
import { ROOT, Scene } from '../js/core/scene.js';
import { deserialize, serialize } from '../js/core/storage.js';
import { members } from '../js/lang/godot/api/members.js';
import { language as gdscript } from '../js/lang/godot/index.js';
import { theme } from '../js/theme/default.js';
import { Inspector } from '../js/ui/inspector.js';
import { installDom } from './fakeDom.js';

const languages = new Languages([gdscript]);
const def = (id) => languages.def(id, 'gdscript');
const ids = (pins) => pins.map((p) => p.id);

function setup(base = 'CharacterBody2D') {
  installDom();
  const scene = new Scene({ languages, areaPad: theme.area.pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  const file = scene.addNode(languages.def('file'), { x: 0, y: 0, scope: ROOT, values: { name: 'player.gd', extends: base } });
  const fn = scene.addNode(def('function'), { x: 20, y: 60, scope: file.id, values: { name: 'jump' } });
  const add = (id, values) => scene.addNode(def(id), { x: 40, y: 120, scope: fn.id, values });
  return { scene, file, fn, add };
}

test('API: métodos e propriedades por classe (tipos simplificados)', () => {
  const body = members.CharacterBody2D;
  assert.ok(body.m.some(([n]) => n === 'move_and_slide'));
  assert.deepEqual(body.p.find(([n]) => n === 'velocity'), ['velocity', 'Vector2', 1]);
  const all = Object.values(members).flatMap((c) => c.m.flatMap(([, args, ret]) => [ret, ...args.map(([, t]) => t)]));
  assert.ok(!all.some((t) => t && /::|,/.test(t))); // sem enum::, typedarray:: nem listas
});

test('nós: método com fluxo e target; const é cálculo; static sem target; propriedade get/set', () => {
  const move = def('m:CharacterBody2D.move_and_slide');
  assert.equal(move.concept, 'method');
  assert.deepEqual(ids(move.inputs), ['run', 'target']);
  assert.deepEqual(move.outputs.map((p) => [p.id, p.type ?? null]), [['next', null], ['result', 'bool']]);
  assert.equal(move.inputs[1].self, true);
  const getPos = def('m:Node2D.get_position');
  assert.deepEqual(ids(getPos.inputs), ['target']); // const: sem fluxo
  const [cls, entry] = Object.entries(members).find(([, c]) => c.m.some(([, , , f]) => f & 1));
  const name = entry.m.find(([, , , f]) => f & 1)[0];
  assert.ok(!def(`m:${cls}.${name}`).inputs.some((p) => p.id === 'target')); // static
  assert.deepEqual(ids(def('p:Node2D.position.get').inputs), ['target']);
  assert.deepEqual(ids(def('p:Node2D.position.set').inputs), ['run', 'target', 'value']);
  assert.equal(def('p:Node2D.position.set').title, 'set position');
  assert.equal(def('m:Node2D.get_position'), def('m:Node2D.get_position')); // montado uma vez
});

test('menu: a cadeia do script (CharacterBody2D → … → Node); a busca geral só com texto', () => {
  const { scene, fn } = setup();
  const defs = scene.menuDefs(fn.id);
  const near = defs.filter((d) => !d.searchOnly);
  const has = (list, title, category) => list.some((d) => d.title === title && d.category === category);
  assert.ok(has(near, 'move_and_slide', 'CharacterBody2D'));
  assert.ok(has(near, 'position', 'Node2D') && has(near, 'set velocity', 'CharacterBody2D'));
  assert.ok(has(near, 'get_tree', 'Node'));
  assert.ok(!has(near, 'grab_focus', 'Control')); // não é da cadeia
  assert.ok(defs.some((d) => d.searchOnly && d.title === 'grab_focus' && d.category === 'Control'));
  installDom();
  const menu = new NodeMenu(document.body, { onPick: () => {} });
  menu.open({ x: 0, y: 0 }, { x: 0, y: 0 }, { defs });
  assert.ok(!menu.items.some((d) => d.searchOnly));
  assert.match(menu.list.text, /mais \d+: digite para filtrar/); // mais de 200
  menu.input.value = 'grab_focus';
  menu.input.dispatch('input');
  assert.ok(menu.items.some((d) => d.category === 'Control'));
});

test('target sem fio: o script precisa herdar da classe; com fio de um objeto, vale o objeto', () => {
  const { scene, file, add } = setup('Node');
  const setPos = add('p:Node2D.position.set');
  assert.equal(scene.selfMissing(setPos), true); // Node não é Node2D
  scene.setField(file, 'extends', 'CharacterBody2D');
  assert.equal(scene.selfMissing(setPos), false); // herda de Node2D
  scene.setField(file, 'extends', 'Node');
  const other = add('variable', { name: 'sprite', type: 'Sprite2D' });
  const target = setPos.inputs.find((p) => p.id === 'target');
  assert.ok(scene.connect({ node: other, pin: other.outputs.find((p) => p.id === 'value') }, { node: setPos, pin: target }).ok);
  assert.equal(scene.selfMissing(setPos), false);
  // Inspetor: aviso quando falta o objeto.
  const lone = add('m:Node2D.rotate');
  const selection = new Selection();
  const inspector = new Inspector(document.body, { scene, selection });
  selection.set([lone.id]);
  inspector.refresh();
  assert.match(inspector.body.text, /não herda de Node2D/);
});

test('fio solto de uma saída Node2D: o menu traz os métodos de Node2D (e pais), ligáveis no target', () => {
  const { scene, file, add } = setup('Node');
  const v = add('variable', { name: 'icon', type: 'Sprite2D' });
  const origin = { node: v, pin: v.outputs.find((p) => p.id === 'value') };
  const defs = scene.menuDefs(file.id, origin);
  assert.ok(defs.some((d) => d.id === 'm:Sprite2D.get_rect'));
  assert.ok(defs.some((d) => d.id === 'p:Node2D.position.set')); // da pai
  assert.ok(!defs.some((d) => d.searchOnly)); // com fio, sem a busca geral
  const node = scene.addNode(def('p:Node2D.position.set'), { x: 300, y: 120, scope: v.scope });
  assert.ok(scene.canConnect(origin, { node, pin: node.inputs.find((p) => p.id === 'target') }).ok);
});

test('salvar: nó de método volta pelo id (montado na hora)', () => {
  const { scene, add } = setup();
  const move = add('m:CharacterBody2D.move_and_slide');
  const data = JSON.parse(JSON.stringify(serialize(scene, new Camera())));
  const again = new Scene({ languages });
  deserialize(data, { scene: again, camera: new Camera() });
  const back = again.byId(move.id);
  assert.equal(back.type, 'm:CharacterBody2D.move_and_slide');
  assert.deepEqual(ids(back.inputs), ['run', 'target']);
  assert.equal(again.selfMissing(back), false);
});
