// Etapa 3d: herança. Class com Extends (classes da mesma linguagem no projeto); variáveis e funções
// da classe pai ao alcance dentro da filha e no menu dela (Inherited).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Camera } from '../js/core/canvas/camera.js';
import { Selection } from '../js/core/canvas/selection.js';
import { layoutNode } from '../js/core/node.js';
import { ROOT, Scene } from '../js/core/scene.js';
import { deserialize, serialize } from '../js/core/storage.js';
import { theme } from '../js/theme/default.js';
import { Inspector } from '../js/ui/inspector.js';
import { installDom } from './fakeDom.js';
import { languages } from './langs.js';

function setup() {
  installDom();
  const scene = new Scene({ languages, areaPad: theme.area.pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  const add = (id, x, y, scope, values, lang) => scene.addNode(languages.def(id, lang), { x, y, scope, values });
  const base = add('file', 0, 0, ROOT, { name: 'entity.gd' });
  const entity = add('class', 20, 60, base.id, { name: 'Entity' });
  const hp = add('variable', 40, 120, entity.id, { name: 'hp', type: 'int' });
  const damage = add('function', 40, 300, entity.id, { name: 'damage' });
  const other = add('file', 900, 0, ROOT, { name: 'player.gd' });
  const player = add('class', 920, 60, other.id, { name: 'Player' });
  const jump = add('function', 940, 120, player.id, { name: 'jump' });
  scene.fitAreas();
  return { scene, add, base, entity, hp, damage, other, player, jump };
}

test('Extends: candidatas da mesma linguagem, sem ela mesma e sem as filhas; cadeia de pais', () => {
  const { scene, add, entity, player, other } = setup();
  assert.deepEqual(scene.superclassCandidates(player).map((c) => c.title), ['Entity']);
  scene.setField(player, 'extends', entity.id);
  assert.deepEqual(scene.superclasses(player), [entity]);
  assert.deepEqual(scene.superclassCandidates(entity).map((c) => c.title), []); // Player já herda dela
  const boss = add('class', 920, 900, other.id, { name: 'Boss', extends: player.id });
  assert.deepEqual(scene.superclasses(boss), [player, entity]);
  assert.ok(!scene.superclassCandidates(entity).includes(boss));
  scene.setField(entity, 'extends', boss.id); // à força: o ciclo não trava
  assert.deepEqual(scene.superclasses(boss), [player, entity]);
});

test('alcance: get/set e chamada de membros da pai valem dentro da filha (e só nela)', () => {
  const { scene, entity, hp, damage, player, jump, other } = setup();
  const get = scene.addReference(hp, 'get');
  const call = scene.addReference(damage, 'get');
  scene.moveInto([get, call], jump.id);
  assert.equal(get.outOfReach, true); // ainda não herda
  scene.setField(player, 'extends', entity.id);
  assert.equal(get.outOfReach, false);
  assert.equal(call.outOfReach, false);
  scene.moveInto([get], other.id); // no arquivo, fora da classe filha
  assert.equal(get.outOfReach, true);
  scene.setField(player, 'extends', null);
  assert.equal(call.outOfReach, true);
});

test('menu na filha (e nas funções dela): Inherited com get/set da variável e a chamada da função', () => {
  const { scene, entity, player, jump, other } = setup();
  const inherited = (scope) => scene.menuDefs(scope).filter((d) => d.category === 'Inherited').map((d) => d.title);
  assert.deepEqual(inherited(player.id), []);
  scene.setField(player, 'extends', entity.id);
  assert.deepEqual(inherited(player.id), ['get hp', 'set hp', 'damage()']);
  assert.deepEqual(inherited(jump.id), ['get hp', 'set hp', 'damage()']);
  assert.deepEqual(inherited(other.id), []); // fora da classe
  const def = scene.menuDefs(jump.id).find((d) => d.title === 'damage()');
  const call = scene.addFromMenu(def, { x: 960, y: 200 }, jump.id);
  assert.equal(call.concept, 'call');
  assert.equal(call.title, 'damage');
  assert.equal(call.outOfReach, false);
  const set = scene.addFromMenu(scene.menuDefs(jump.id).find((d) => d.title === 'set hp'), { x: 960, y: 260 }, jump.id);
  assert.equal(set.title, 'set hp');
  assert.equal(set.inputs.find((p) => p.id === 'value').type, 'int');
});

test('classe pai apagada: aviso; inspetor com Extends e a lista de herdados', () => {
  const { scene, entity, player } = setup();
  const selection = new Selection();
  const inspector = new Inspector(document.body, { scene, selection });
  selection.set([player.id]);
  inspector.refresh();
  const all = (f, el = inspector.body, out = []) => (f(el) && out.push(el), el.children.forEach((c) => all(f, c, out)), out);
  const select = all((e) => e.tagName === 'SELECT')[0];
  assert.deepEqual(select.children.map((o) => o.textContent), ['—', 'Entity (entity.gd)']);
  select.value = String(entity.id);
  select.dispatch('change');
  assert.equal(player.values.extends, entity.id);
  assert.deepEqual(all((e) => e.className === 'inspector__member').map((p) => p.textContent), ['hp: int', 'damage()']);
  scene.remove([entity.id]);
  inspector.signature = null;
  inspector.refresh();
  assert.match(inspector.body.text, /A classe pai foi apagada/);
  assert.equal(all((e) => e.tagName === 'SELECT')[0].value, '');
  assert.deepEqual(scene.superclasses(player), []);
});

test('salvar: o Extends volta e a referência herdada continua ao alcance', () => {
  const { scene, entity, hp, player, jump } = setup();
  scene.setField(player, 'extends', entity.id);
  const get = scene.addReference(hp, 'get');
  scene.moveInto([get], jump.id);
  const data = JSON.parse(JSON.stringify(serialize(scene, new Camera())));
  const again = new Scene({ languages });
  deserialize(data, { scene: again, camera: new Camera() });
  assert.equal(again.byId(player.id).values.extends, entity.id);
  assert.equal(again.byId(get.id).outOfReach, false);
});
