// Etapa 3c1: nome do arquivo com a extensão num select (ou livre, com Other) e menu com a categoria
// curta quando o nome do nó não deixa espaço.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Selection } from '../js/core/canvas/selection.js';
import { NodeMenu, shortCategory } from '../js/core/canvas/nodeMenu.js';
import { layoutNode } from '../js/core/node.js';
import { ROOT, Scene } from '../js/core/scene.js';
import { theme } from '../js/theme/default.js';
import { Inspector } from '../js/ui/inspector.js';
import { installDom } from './fakeDom.js';
import { languages } from './langs.js';

const all = (f, el, out = []) => (f(el) && out.push(el), el.children.forEach((c) => all(f, c, out)), out);

function setup(name) {
  installDom();
  const scene = new Scene({ languages, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  const file = scene.addNode(languages.def('file'), { x: 0, y: 0, scope: ROOT, values: { name } });
  const selection = new Selection();
  const inspector = new Inspector(document.body, { scene, selection });
  selection.set([file.id]);
  inspector.refresh();
  const input = () => all((e) => e.tagName === 'INPUT' && e.type === 'text', inspector.body)[0];
  const select = () => all((e) => e.tagName === 'SELECT', inspector.body)[0];
  return { scene, file, input, select };
}

test('menu: Folder e File; o arquivo novo nasce script.gd e a função personalizada my_function', () => {
  assert.equal(languages.def('folder').title, 'Folder');
  assert.equal(languages.def('file').title, 'File');
  const { scene } = setup('a.gd');
  const file = scene.addNode(languages.def('file'), { x: 0, y: 500, scope: ROOT });
  assert.equal(file.title, 'script.gd');
  assert.equal(scene.addNode(languages.def('function'), { x: 0, y: 0, scope: file.id }).title, 'my_function');
});

test('arquivo: nome num campo e extensão num select (.gd, .gdshader, Other), rótulo acima', () => {
  const { file, input, select } = setup('player.gd');
  assert.match(input().parent.parent.className, /inspector__row--stacked/);
  assert.equal(input().value, 'player');
  assert.deepEqual(select().children.map((o) => o.textContent), ['.gd', '.gdshader', 'Other']);
  assert.equal(select().value, 'gd');
  input().value = 'enemy';
  input().dispatch('input');
  assert.equal(file.values.name, 'enemy.gd');
  select().value = 'gdshader';
  select().dispatch('change');
  assert.equal(file.values.name, 'enemy.gdshader');
  assert.equal(input().value, 'enemy');
});

test('Other: nome livre com a extensão junto; voltar a uma extensão conhecida troca a do nome', () => {
  const { file, input, select } = setup('data.json'); // extensão sem linguagem: já abre livre
  assert.equal(select().value, '');
  assert.equal(input().value, 'data.json');
  const again = setup('main.gd');
  again.select().value = '';
  again.select().dispatch('change');
  assert.equal(again.input().value, 'main.gd'); // livre: o nome inteiro
  again.input().value = 'main.txt';
  again.input().dispatch('input');
  assert.equal(again.file.values.name, 'main.txt');
  again.select().value = 'gd';
  again.select().dispatch('change');
  assert.equal(again.file.values.name, 'main.gd');
  assert.equal(again.input().value, 'main');
  assert.equal(file.values.name, 'data.json');
});

test('menu: categoria curta quando a linha não cabe (a completa na dica)', () => {
  assert.equal(shortCategory('Native methods'), 'Native');
  assert.equal(shortCategory('Flow'), 'Flow');
  installDom();
  const menu = new NodeMenu(document.body, { onPick: () => {} });
  const defs = [{ title: '_physics_process', category: 'Native methods' }, { title: 'If', category: 'Flow' }];
  menu.open({ x: 0, y: 0 }, { x: 0, y: 0 }, { defs });
  assert.equal(menu.list.children[0].children[1].textContent, 'Native methods'); // cabe
  menu.fits = (li) => li.children[0].textContent !== '_physics_process';
  menu.refresh();
  const small = menu.list.children[0].children[1];
  assert.equal(small.textContent, 'Native');
  assert.equal(small.title, 'Native methods');
  assert.equal(menu.list.children[1].children[1].textContent, 'Flow');
});
