// Etapa 3c: métodos nativos da linguagem (ex.: _process(delta)): a Function com esse nome é
// reconhecida (parâmetros e retorno travados), e os nativos aparecem no menu e na aba do painel.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Camera } from '../js/core/canvas/camera.js';
import { layoutNode } from '../js/core/node.js';
import { ROOT, Scene } from '../js/core/scene.js';
import { deserialize, serialize } from '../js/core/storage.js';
import { theme } from '../js/theme/default.js';
import { Inspector } from '../js/ui/inspector.js';
import { NativesPanel } from '../js/ui/nativesPanel.js';
import { Selection } from '../js/core/canvas/selection.js';
import { installDom } from './fakeDom.js';
import { languages } from './langs.js';

function setup() {
  installDom();
  const scene = new Scene({ languages, areaPad: theme.area.pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  const add = (id, x, y, scope, values) => scene.addNode(languages.def(id), { x, y, scope, values });
  const file = add('file', 0, 0, ROOT, { name: 'player.gd' });
  const fn = add('function', 20, 60, file.id, { name: 'jump' });
  return { scene, add, file, fn };
}
const all = (f, el, out = []) => (f(el) && out.push(el), el.children.forEach((c) => all(f, c, out)), out);

const delta = { id: 'delta', name: 'delta', type: 'float', native: true };

test('personalizada renomeada para nativo vira o nativo: nome, parâmetros dele e retorno travados', () => {
  const { scene, fn } = setup();
  assert.equal(scene.nativeOf(fn), null);
  scene.setField(fn, 'params', [{ id: 'p1', name: 'speed', type: 'float' }]);
  scene.setField(fn, 'returns', 'int');
  scene.setField(fn, 'name', '_process');
  assert.equal(scene.nativeOf(fn).name, '_process');
  // O que ela tinha fica como extra, com valor padrão; o retorno é o do nativo.
  assert.deepEqual(fn.values.params, [delta, { id: 'p1', name: 'speed', type: 'float', default: 0 }]);
  assert.equal(fn.values.returns, null);
  scene.setField(fn, 'name', 'tick'); // nome travado
  scene.setField(fn, 'returns', 'int');
  assert.equal(fn.values.name, '_process');
  assert.equal(fn.values.returns, null);
  scene.setField(fn, 'params', []); // o nativo fica; os extras saem
  assert.deepEqual(fn.values.params, [delta]);
  scene.setField(fn, 'params', [delta, { id: 'p2', name: 'pos', type: 'vector2', default: ['1', '2'] }]);
  assert.deepEqual(fn.values.params[1].default, [1, 2]);
  // Arrastar o event para dentro da função: o nó do parâmetro nativo.
  const input = scene.addNative('teste', '_input', { x: 20, y: 900 }, fn.scope);
  const node = scene.addParameter(input, 'event', { x: input.x + 20, y: input.y + 60 }, input.id);
  assert.equal(node.title, 'event');
  assert.equal(node.tag, 'any');
});

test('inspetor: nativo com aviso, nome e parâmetro dele travados; extra com valor padrão', () => {
  const { scene, fn } = setup();
  scene.setField(fn, 'name', '_physics_process');
  const selection = new Selection();
  const inspector = new Inspector(document.body, { scene, selection });
  selection.set([fn.id]);
  inspector.refresh();
  assert.match(inspector.body.text, /Método nativo de Teste/);
  const text = () => all((e) => e.tagName === 'INPUT' && e.type === 'text', inspector.body);
  assert.equal(text()[0].disabled, true); // Name
  let rows = all((e) => e.className === 'inspector__param', inspector.body);
  assert.equal(rows.length, 1);
  assert.equal(all((e) => e.tagName === 'INPUT', rows[0])[0].value, 'delta');
  assert.ok(all((e) => ['INPUT', 'SELECT'].includes(e.tagName), rows[0]).every((e) => e.disabled));
  assert.equal(all((e) => e.tagName === 'BUTTON' && ['×', '↑', '↓'].includes(e.textContent), rows[0]).length, 0);
  assert.equal(all((e) => e.className === 'inspector__drag', rows[0]).length, 1); // dá para arrastar
  const selects = all((e) => e.tagName === 'SELECT', inspector.body);
  assert.equal(selects.at(-1).disabled, true); // Return type
  // + Add: extra depois do nativo, com campo de valor padrão; não sobe acima do nativo.
  all((e) => e.tagName === 'BUTTON' && e.textContent === '+ Add', inspector.body)[0].dispatch('click');
  rows = all((e) => e.className === 'inspector__param', inspector.body);
  assert.equal(rows.length, 2);
  assert.equal(all((e) => e.tagName === 'BUTTON' && e.textContent === '↑', rows[1])[0].disabled, true);
  // any: sem editor, o padrão é null.
  assert.match(all((e) => e.className === 'inspector__param-default', rows[1])[0].text, /null/);
  const type = all((e) => e.tagName === 'SELECT', rows[1])[0];
  type.value = 'int';
  type.dispatch('change');
  rows = all((e) => e.className === 'inspector__param', inspector.body);
  const editor = (row) => all((e) => e.tagName === 'INPUT', all((e) => e.className === 'inspector__param-default', row)[0]);
  // int: campo de número inteiro.
  const [int] = editor(rows[1]);
  assert.deepEqual([int.type, int.step], ['number', '1']);
  int.value = '3.7';
  int.dispatch('input');
  assert.deepEqual(fn.values.params[1], { id: 'p1', name: 'arg1', type: 'int', default: 3 });
  // bool: checkbox.
  const set = (typeId) => {
    const select = all((e) => e.tagName === 'SELECT', all((e) => e.className === 'inspector__param', inspector.body)[1])[0];
    select.value = typeId;
    select.dispatch('change');
    return editor(all((e) => e.className === 'inspector__param', inspector.body)[1]);
  };
  const [bool] = set('bool');
  assert.equal(bool.type, 'checkbox');
  bool.checked = true;
  bool.dispatch('change');
  assert.equal(fn.values.params[1].default, true);
  // Vector3: três campos float.
  const xyz = set('vector3');
  assert.deepEqual(xyz.map((i) => [i.type, i.step]), [['number', 'any'], ['number', 'any'], ['number', 'any']]);
  xyz[2].value = '1.5';
  xyz[2].dispatch('input');
  assert.deepEqual(fn.values.params[1].default, [0, 0, 1.5]);
});

test('menu: no arquivo e na classe, os nativos da linguagem; criar um já vem com os parâmetros', () => {
  const { scene, add, file, fn } = setup();
  const natives = scene.menuDefs(file.id).filter((d) => d.category === 'Native methods');
  assert.deepEqual(natives.map((d) => d.title), ['_ready', '_process', '_physics_process', '_input']);
  const cls = add('class', 20, 600, file.id);
  assert.equal(scene.menuDefs(cls.id).filter((d) => d.category === 'Native methods').length, 4);
  assert.equal(scene.menuDefs(fn.id).filter((d) => d.category === 'Native methods').length, 0); // função não tem função dentro
  const proc = scene.addNode(natives[1], { x: 20, y: 300, scope: file.id });
  assert.equal(proc.title, '_process');
  assert.deepEqual(proc.values.params.map((p) => p.name), ['delta']);
  assert.equal(scene.addNative('teste', '_input', { x: 0, y: 0 }, ROOT), null); // na raiz não cabe
  assert.equal(scene.addNative('teste', '_input', { x: 20, y: 900 }, file.id).values.params[0].name, 'event');
});

test('salvar: a função nativa volta com os parâmetros da linguagem', () => {
  const { scene, fn } = setup();
  scene.setField(fn, 'name', '_process');
  const data = JSON.parse(JSON.stringify(serialize(scene, new Camera())));
  const again = new Scene({ languages });
  deserialize(data, { scene: again, camera: new Camera() });
  assert.deepEqual(again.byId(fn.id).values.params, [delta]);
});

test('aba Native methods: escolhe a linguagem, busca e começa a arrastar', () => {
  installDom();
  const dragged = [];
  const panel = new NativesPanel({ languages, onDragNative: (l, n) => dragged.push([l.id, n.name]) });
  const items = () => panel.list.children.map((li) => li.text);
  assert.deepEqual(panel.select.children.map((o) => o.textContent), ['Teste', 'Teste 2']);
  assert.deepEqual(items(), ['_ready()→ void', '_process(delta: float)→ void', '_physics_process(delta: float)→ void', '_input(event: any)→ void']);
  panel.input.value = 'proc';
  panel.input.dispatch('input');
  assert.deepEqual(items().map((s) => s.split('(')[0]), ['_process', '_physics_process']);
  panel.list.children[0].dispatch('pointerdown');
  assert.deepEqual(dragged, [['teste', '_process']]);
  panel.input.value = 'zzz';
  panel.input.dispatch('input');
  assert.match(panel.list.text, /Nenhum método encontrado/);
  panel.input.value = '';
  panel.select.value = 'teste2';
  panel.select.dispatch('change');
  assert.deepEqual(items().map((s) => s.split('(')[0]), ['vertex', 'fragment', 'light']);
});

test('app: aba no painel; arrastar _process da aba para dentro do player.gd cria a função lá', async () => {
  const { canvas } = installDom();
  const { app } = await import('../js/main.js');
  const tabs = app.inspector.tabs.children;
  assert.deepEqual(tabs.map((b) => b.textContent), ['Inspector', 'Native methods']);
  assert.equal(app.natives.el.hidden, true);
  tabs[1].dispatch('click');
  assert.equal(app.natives.el.hidden, false);
  assert.equal(app.inspector.body.hidden, true);
  const player = app.scene.elements.find((n) => n.title === 'player.gd');
  const item = (name) => app.natives.list.children.find((li) => li.text.startsWith(`${name}(`));
  item('_process').dispatch('pointerdown');
  const at = app.camera.toScreen(player.x + player.w - 10, player.y + player.h - 10);
  document.dispatch('pointerup', { clientX: at.x, clientY: at.y });
  const fn = app.scene.elements.at(-1);
  assert.equal(fn.title, '_process');
  assert.equal(fn.scope, player.id);
  assert.deepEqual(fn.values.params.map((p) => p.name), ['delta']);
  // Soltar fora de um arquivo não cria nada.
  const count = app.scene.elements.length;
  item('_process').dispatch('pointerdown');
  document.dispatch('pointerup', { clientX: 795, clientY: 595 });
  assert.equal(app.scene.elements.length, count);
});
