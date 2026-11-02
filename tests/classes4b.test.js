// Etapa 4b: o arquivo .gd é uma classe (class_name, Extends da Godot ou do projeto); os nativos vêm
// da cadeia do Extends; classes do projeto viram tipos.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Camera } from '../js/core/canvas/camera.js';
import { Selection } from '../js/core/canvas/selection.js';
import { Languages } from '../js/core/languages.js';
import { layoutNode } from '../js/core/node.js';
import { ROOT, Scene } from '../js/core/scene.js';
import { deserialize, serialize } from '../js/core/storage.js';
import { language as gdscript } from '../js/lang/godot/index.js';
import { language as teste2 } from '../js/lang/teste2/index.js';
import { theme } from '../js/theme/default.js';
import { Inspector } from '../js/ui/inspector.js';
import { NativesPanel } from '../js/ui/nativesPanel.js';
import { TypePicker } from '../js/ui/typePicker.js';
import { installDom } from './fakeDom.js';

const languages = new Languages([gdscript, teste2]);
const all = (f, el, out = []) => (f(el) && out.push(el), el.children.forEach((c) => all(f, c, out)), out);

function setup() {
  installDom();
  const scene = new Scene({ languages, areaPad: theme.area.pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  const file = (name, x, values = {}) => scene.addNode(languages.def('file'), { x, y: 0, scope: ROOT, values: { name, ...values } });
  const add = (id, scope, values, x = 20, y = 60) => scene.addNode(languages.def(id, 'gdscript'), { x, y, scope, values });
  return { scene, file, add };
}

test('arquivo .gd: campos Class name e Extends (Node); a extensão troca os campos e os valores ficam', () => {
  const { scene, file } = setup();
  const f = file('player.gd');
  assert.deepEqual(f.fields.map((x) => x.id), ['name', 'class_name', 'extends']);
  assert.equal(f.values.extends, 'Node');
  assert.equal(scene.isClass(f), true);
  scene.setField(f, 'class_name', 'Player');
  scene.setField(f, 'name', 'player.gdshader');
  assert.deepEqual(f.fields.map((x) => x.id), ['name']);
  assert.equal(scene.isClass(f), false);
  scene.setField(f, 'name', 'player.gd');
  assert.equal(f.values.class_name, 'Player');
});

test('nativos pela cadeia: _process só herdando de Node; _draw de CanvasItem; trocar destrava', () => {
  const { scene, file, add } = setup();
  const f = file('player.gd');
  const names = (scope) => scene.menuDefs(scope).filter((d) => d.category === 'Native methods').map((d) => d.title);
  assert.ok(names(f.id).includes('_process'));
  assert.ok(!names(f.id).includes('_draw'));
  const proc = add('function', f.id, { name: '_process' });
  assert.deepEqual(proc.values.params, [{ id: 'delta', name: 'delta', type: 'float', native: true }]);
  scene.setField(f, 'extends', 'Node2D');
  assert.ok(names(f.id).includes('_draw')); // CanvasItem
  scene.setField(f, 'extends', 'RefCounted');
  assert.equal(scene.nativeOf(proc), null);
  assert.deepEqual(proc.values.params, [{ id: 'delta', name: 'delta', type: 'float' }]); // destravou
  assert.ok(!names(f.id).includes('_process'));
  scene.setField(f, 'extends', 'Node');
  assert.equal(scene.nativeOf(proc).name, '_process'); // travou de novo
  // Classe interna: a cadeia dela (sem extends: RefCounted).
  const inner = add('class', f.id, { name: 'Helper' }, 20, 600);
  assert.ok(!names(inner.id).includes('_ready'));
  scene.setField(inner, 'extends', 'Node');
  assert.ok(names(inner.id).includes('_ready'));
  assert.equal(scene.addNative('gdscript', '_draw', { x: 30, y: 700 }, inner.id), null); // Node não tem _draw
});

test('Extends do projeto: player.gd extends entity.gd; cadeia até a classe da Godot e membros herdados', () => {
  const { scene, file, add } = setup();
  const entity = file('entity.gd', 0, { class_name: 'Entity', extends: 'CharacterBody2D' });
  add('variable', entity.id, { name: 'hp', type: 'int' });
  const player = file('player.gd', 900);
  scene.setField(player, 'extends', entity.id);
  assert.deepEqual(scene.superclasses(player), [entity]);
  assert.equal(scene.engineBase(player), 'CharacterBody2D');
  assert.ok(scene.nativesIn('gdscript', player.id).some((n) => n.name === '_physics_process'));
  const fn = add('function', player.id, { name: 'jump' }, 920);
  assert.deepEqual(scene.menuDefs(fn.id).filter((d) => d.category === 'Inherited').map((d) => d.title), ['get hp', 'set hp']);
  assert.ok(!scene.superclassCandidates(entity).includes(player)); // sem ciclo
  scene.remove([entity.id]);
  assert.equal(scene.missingSuperclass(player), true);
});

test('classes do projeto como tipos: grupo próprio; ligam na pai (do projeto e da Godot)', () => {
  const { scene, file, add } = setup();
  const entity = file('entity.gd', 0, { class_name: 'Entity', extends: 'CharacterBody2D' });
  const player = file('player.gd', 900, { class_name: 'Player' });
  scene.setField(player, 'extends', entity.id);
  const types = scene.typesFor(add('variable', player.id));
  assert.equal(types.Player.group, 'Project classes');
  assert.equal(types.Entity.color, gdscript.projectClassColor);
  const fn = add('function', player.id, { name: 'test' }, 920);
  const v = (name, type) => add('variable', fn.id, { name, type }, 940);
  const out = (n) => ({ node: n, pin: n.outputs.find((p) => p.id === 'value') });
  const inp = (n) => ({ node: n, pin: n.inputs.find((p) => p.id === 'value') });
  const p = v('p', 'Player');
  assert.ok(scene.canConnect(out(p), inp(v('e', 'Entity'))).ok);
  assert.ok(scene.canConnect(out(p), inp(v('n', 'Node'))).ok); // pela cadeia da Godot
  assert.ok(!scene.canConnect(out(p), inp(v('n3', 'Node3D'))).ok);
  assert.ok(!scene.canConnect(out(v('e2', 'Entity')), inp(v('p2', 'Player'))).ok);
  assert.equal(scene.typeDef(p, p.outputs.find((x) => x.id === 'value')).label, 'Player');
});

test('inspetor: Extends com busca (classes do projeto e da Godot); escolher do projeto guarda o id', () => {
  const { scene, file } = setup();
  const entity = file('entity.gd', 0, { class_name: 'Entity' });
  const player = file('player.gd', 900);
  const selection = new Selection();
  const inspector = new Inspector(document.body, { scene, selection });
  selection.set([player.id]);
  inspector.refresh();
  assert.deepEqual(all((e) => e.tagName === 'LABEL', inspector.body).map((l) => l.children[0].textContent), ['Name', 'Class name', 'Extends']);
  const button = all((e) => e.className === 'inspector__type', inspector.body)[0];
  assert.equal(button.textContent, 'Node');
  button.dispatch('click');
  const picker = inspector.typePicker;
  // Escolhido Node: Godot classes no topo.
  assert.deepEqual(picker.list.children.filter((li) => li.className === 'group').map((li) => li.textContent), ['Godot classes', 'Basic', 'Project classes']);
  picker.input.value = 'entity';
  picker.input.dispatch('input');
  const index = picker.items.findIndex((o) => o.label === 'Entity (entity.gd)');
  assert.equal(picker.items[index].group, 'Project classes');
  picker.pick(index);
  assert.equal(player.values.extends, entity.id);
  assert.equal(all((e) => e.className === 'inspector__type', inspector.body)[0].textContent, 'Entity (entity.gd)');
  all((e) => e.className === 'inspector__type', inspector.body)[0].dispatch('click');
  picker.pick(picker.items.findIndex((o) => o.id === null)); // — (nenhuma)
  assert.equal(player.values.extends, null);
  assert.equal(scene.engineBase(player), 'RefCounted');
});

test('salvar: class_name e extends (inclusive nenhum) voltam', () => {
  const { scene, file } = setup();
  const entity = file('entity.gd', 0, { class_name: 'Entity' });
  const player = file('player.gd', 900);
  scene.setField(player, 'extends', entity.id);
  const loose = file('tool.gd', 1800);
  scene.setField(loose, 'extends', null);
  const data = JSON.parse(JSON.stringify(serialize(scene, new Camera())));
  const again = new Scene({ languages });
  deserialize(data, { scene: again, camera: new Camera() });
  assert.equal(again.byId(entity.id).values.class_name, 'Entity');
  assert.equal(again.byId(player.id).values.extends, entity.id);
  assert.equal(again.byId(loose.id).values.extends, null);
});

test('abrir: função salva antes do arquivo dela não quebra e volta como nativa', () => {
  const { scene, file, add } = setup();
  const f = file('player.gd', 0, { extends: 'Node' });
  const proc = add('function', f.id, { name: '_process' });
  const call = scene.addReference(proc, 'get');
  const data = JSON.parse(JSON.stringify(serialize(scene, new Camera())));
  data.nodes.reverse(); // a chamada e a função antes do arquivo
  const again = new Scene({ languages });
  deserialize(data, { scene: again, camera: new Camera() });
  assert.deepEqual(again.byId(proc.id).values.params, [{ id: 'delta', name: 'delta', type: 'float', native: true }]);
  assert.equal(again.nativeOf(again.byId(proc.id)).name, '_process');
  assert.deepEqual(again.byId(call.id).inputs.map((p) => p.id), ['run', 'delta']);
  assert.equal(again.classAround(12345), null); // área que não existe
});

test('aba Native methods: na GDScript escolhe a classe; Node2D mostra _draw', () => {
  installDom();
  const picker = new TypePicker(document.body);
  const panel = new NativesPanel({ languages, typePicker: picker });
  const names = () => panel.list.children.map((li) => li.text.split('(')[0]);
  assert.equal(panel.classButton.textContent, 'Node');
  assert.ok(names().includes('_process') && !names().includes('_draw'));
  panel.classButton.dispatch('click');
  picker.input.value = 'node2d';
  picker.input.dispatch('input');
  picker.pick(0);
  assert.equal(panel.classButton.textContent, 'Node2D');
  assert.ok(names().includes('_draw'));
  panel.select.value = 'teste2';
  panel.select.dispatch('change');
  assert.equal(panel.classButton.hidden, true); // lista fixa: sem classe
  assert.deepEqual(names(), ['vertex', 'fragment', 'light']);
});
