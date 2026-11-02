// Etapa 4a: GDScript com a API gerada da Godot (tipos, classes, funções globais) e o seletor de
// tipo com busca no inspetor.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Selection } from '../js/core/canvas/selection.js';
import { Languages } from '../js/core/languages.js';
import { layoutNode } from '../js/core/node.js';
import { ROOT, Scene } from '../js/core/scene.js';
import { coerceValue, formatValue } from '../js/core/values.js';
import { classes, functions, version } from '../js/lang/godot/api/core.js';
import { language as gdscript } from '../js/lang/godot/index.js';
import { theme } from '../js/theme/default.js';
import { Inspector } from '../js/ui/inspector.js';
import { installDom } from './fakeDom.js';

const languages = new Languages([gdscript]);
const T = gdscript.types;
const all = (f, el, out = []) => (f(el) && out.push(el), el.children.forEach((c) => all(f, c, out)), out);

function setup() {
  installDom();
  const scene = new Scene({ languages, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  const file = scene.addNode(languages.def('file'), { x: 0, y: 0, scope: ROOT, values: { name: 'player.gd' } });
  const add = (id, values) => scene.addNode(languages.def(id, 'gdscript'), { x: 20, y: 60, scope: file.id, values });
  return { scene, file, add };
}

test('API gerada: versão, classes com a pai, funções globais; o gerador fica no repositório', () => {
  assert.equal(version, '4.7.0');
  assert.equal(classes.length, 1036);
  assert.deepEqual(classes.find(([n]) => n === 'Node2D'), ['Node2D', 'CanvasItem']);
  assert.equal(functions.length, 114);
  assert.match(readFileSync(new URL('../tools/godot_api.py', import.meta.url), 'utf8'), /extension_api\.json/);
});

test('tipos: Variant, básicos com editor e componentes, classes da Godot em outro grupo', () => {
  assert.equal(T.Variant.group, 'Basic');
  assert.deepEqual([T.int.editor, T.float.editor, T.bool.editor, T.String.editor], ['int', 'float', 'bool', 'text']);
  assert.deepEqual(T.Vector3.components, ['x', 'y', 'z']);
  assert.deepEqual(T.Color.components, ['r', 'g', 'b', 'a']);
  assert.equal(T.Vector2i.componentType, 'int');
  assert.deepEqual(coerceValue(T.Vector2i, ['1.9', '2']), [1, 2]);
  assert.equal(formatValue(T.Vector2i, [1, 2]), '(1, 2)');
  assert.equal(T.Node2D.group, 'Godot classes');
  assert.equal(T.Node2D.inherits, 'CanvasItem');
  assert.ok(Object.keys(T).length > 1000);
});

test('ligar: classe filha em entrada da pai, int em float, Variant; o contrário não', () => {
  const { canAssign } = gdscript;
  assert.ok(canAssign('Node2D', 'Node'));
  assert.ok(canAssign('CharacterBody2D', 'Object'));
  assert.ok(!canAssign('Node', 'Node2D'));
  assert.ok(canAssign('int', 'float'));
  assert.ok(!canAssign('float', 'int'));
  assert.ok(canAssign('Variant', 'Vector3') && canAssign('Vector3', 'Variant'));
  assert.ok(!canAssign('String', 'int'));
});

test('funções globais: print com fluxo; lerp é cálculo com retorno; no menu dentro da função', () => {
  const { scene, add } = setup();
  const print = languages.def('fn_print', 'gdscript');
  assert.deepEqual(print.inputs.map((p) => p.id), ['run', 'arg1']);
  assert.deepEqual(print.outputs.map((p) => p.id), ['next']);
  const sin = languages.def('fn_sin', 'gdscript');
  assert.deepEqual(sin.inputs.map((p) => [p.id, p.type]), [['angle_rad', 'float']]);
  assert.deepEqual(sin.outputs.map((p) => [p.id, p.type]), [['result', 'float']]);
  assert.equal(sin.category, 'Global math');
  const fn = add('function', { name: 'tick' });
  const menu = scene.menuDefs(fn.id).map((d) => d.title);
  assert.ok(['print', 'lerp', 'randi', 'For', 'While', 'If'].every((t) => menu.includes(t)));
});

test('inspetor: tipo da variável no seletor com busca (grupos); escolher muda o tipo e os pinos', () => {
  const { scene, add } = setup();
  const v = add('variable', { name: 'speed' });
  const selection = new Selection();
  const inspector = new Inspector(document.body, { scene, selection });
  selection.set([v.id]);
  inspector.refresh();
  const button = all((e) => e.className === 'inspector__type', inspector.body)[0];
  assert.equal(button.textContent, 'Variant');
  button.dispatch('click');
  const picker = inspector.typePicker;
  assert.equal(picker.el.hidden, false);
  assert.deepEqual(picker.list.children.filter((li) => li.className === 'group').map((li) => li.textContent), ['Basic', 'Godot classes']);
  assert.match(picker.list.text, /mais \d+: digite para filtrar/); // mais de 200: a busca filtra
  picker.input.value = 'vector3';
  picker.input.dispatch('input');
  assert.deepEqual(picker.items.map((o) => o.label), ['Vector3', 'Vector3i', 'PackedVector3Array']); // começa com a busca primeiro
  picker.list.dispatch('pointerdown', { target: picker.list.children[1] });
  assert.equal(picker.el.hidden, true);
  assert.equal(v.values.type, 'Vector3');
  assert.equal(v.outputs.find((p) => p.id === 'value').type, 'Vector3');
  assert.equal(all((e) => e.className === 'inspector__type', inspector.body)[0].textContent, 'Vector3');
  // Uma classe da Godot também é tipo: CharacterBody2D (Enter escolhe o primeiro).
  all((e) => e.className === 'inspector__type', inspector.body)[0].dispatch('click');
  picker.input.value = 'characterbody2';
  picker.input.dispatch('input');
  picker.input.dispatch('keydown', { key: 'Enter' });
  assert.equal(v.values.type, 'CharacterBody2D');
  assert.equal(v.tag, 'CharacterBody2D');
});

test('inspetor: retorno com void no seletor; parâmetro com o seletor também', () => {
  const { scene, add } = setup();
  const fn = add('function', { name: 'jump' });
  scene.setField(fn, 'params', [{ id: 'p1', name: 'height', type: 'float' }]);
  const selection = new Selection();
  const inspector = new Inspector(document.body, { scene, selection });
  selection.set([fn.id]);
  inspector.refresh();
  const buttons = all((e) => e.className === 'inspector__type', inspector.body);
  assert.deepEqual(buttons.map((b) => b.textContent), ['float', 'void']);
  buttons[1].dispatch('click');
  assert.equal(inspector.typePicker.items[0].label, 'void');
  inspector.typePicker.input.value = 'vector2';
  inspector.typePicker.input.dispatch('input');
  inspector.typePicker.pick(0);
  assert.equal(fn.values.returns, 'Vector2');
  all((e) => e.className === 'inspector__type', inspector.body)[0].dispatch('click');
  inspector.typePicker.input.value = 'int';
  inspector.typePicker.input.dispatch('input');
  inspector.typePicker.pick(0);
  assert.equal(fn.values.params[0].type, 'int');
  // Escape fecha sem mudar.
  all((e) => e.className === 'inspector__type', inspector.body)[0].dispatch('click');
  inspector.typePicker.input.dispatch('keydown', { key: 'Escape' });
  assert.equal(inspector.typePicker.el.hidden, true);
  assert.equal(fn.values.params[0].type, 'int');
});
