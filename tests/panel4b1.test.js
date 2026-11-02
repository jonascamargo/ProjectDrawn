// Etapa 4b1: dado em condicional (e condicional em bool), grupo do tipo escolhido primeiro, nome
// cortado na aba de nativos, painel redimensionável e lista de atalhos com Alt+H.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Selection } from '../js/core/canvas/selection.js';
import { layoutNode } from '../js/core/node.js';
import { ROOT, Scene } from '../js/core/scene.js';
import { canConnect } from '../js/core/wires.js';
import { language as gdscript } from '../js/lang/godot/index.js';
import { theme } from '../js/theme/default.js';
import { Inspector } from '../js/ui/inspector.js';
import { NativesPanel } from '../js/ui/nativesPanel.js';
import { TypePicker } from '../js/ui/typePicker.js';
import { installDom } from './fakeDom.js';
import { language, languages } from './langs.js';

test('dado liga em condicional (qualquer tipo); condicional liga em dado só se aceita bool', () => {
  installDom();
  const scene = new Scene({ languages, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  const file = scene.addNode(languages.def('file'), { x: 0, y: 0, scope: ROOT, values: { name: 'a.gd' } });
  const add = (id, values) => scene.addNode(languages.def(id, 'teste'), { x: 20, y: 60, scope: file.id, values });
  const out = (n, id) => ({ node: n, pin: n.outputs.find((p) => p.id === id) });
  const inp = (n, id) => ({ node: n, pin: n.inputs.find((p) => p.id === id) });
  const iff = add('if');
  const sum = add('add');
  assert.ok(canConnect(out(sum, 'result'), inp(iff, 'condition'), language).ok); // float como condição
  const text = add('variable', { name: 's', type: 'text' });
  assert.ok(canConnect(out(text, 'value'), inp(iff, 'condition'), language).ok); // texto também
  const greater = add('greater');
  const flag = add('variable', { name: 'ok', type: 'bool' });
  assert.ok(canConnect(out(greater, 'result'), inp(flag, 'value'), language).ok); // var ok = a > b
  const any = add('variable', { name: 'v' });
  assert.ok(canConnect(out(greater, 'result'), inp(any, 'value'), language).ok);
  const n = add('variable', { name: 'n', type: 'int' });
  assert.equal(canConnect(out(greater, 'result'), inp(n, 'value'), language).reason, 'int não aceita condicional');
  assert.ok(scene.connect(out(sum, 'result'), inp(iff, 'condition')).ok);
});

test('seletor de tipo: o grupo do tipo escolhido vem primeiro', () => {
  installDom();
  const picker = new TypePicker(document.body);
  const groups = () => picker.list.children.filter((li) => li.className === 'group').map((li) => li.textContent);
  picker.open(document.body, { types: gdscript.types, value: 'Node2D', onPick: () => {} });
  assert.deepEqual(groups(), ['Godot classes', 'Basic']);
  const items = picker.list.children.filter((li) => li.className !== 'group');
  assert.equal(items[0].textContent, 'Node2D'); // o escolhido no começo do grupo
  assert.equal(items[0].className, 'active');
  picker.open(document.body, { types: gdscript.types, value: 'int', onPick: () => {} });
  assert.deepEqual(groups(), ['Basic', 'Godot classes']);
});

test('aba de nativos: o nome fica num campo que corta (classe própria) com o nome completo na dica', () => {
  installDom();
  const panel = new NativesPanel({ languages });
  const name = panel.list.children[1].children[0];
  assert.equal(name.className, 'natives__name');
  assert.equal(name.title, '_process(delta: float)');
});

test('painel: arrastar o puxador muda a largura (com limites) e guarda neste navegador', () => {
  installDom();
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v) };
  document.documentElement.style.setProperty('--ui-panelWidth', '300px');
  const scene = new Scene({ languages });
  const inspector = new Inspector(document.body, { scene, selection: new Selection() });
  assert.equal(document.body.children[0], inspector.el);
  assert.equal(document.body.children[1], inspector.handle); // logo depois do painel
  inspector.handle.dispatch('pointerdown', { clientX: 300, pointerId: 1 });
  assert.equal(document.body.classList.contains('resizing-panel'), true);
  inspector.handle.dispatch('pointermove', { clientX: 380, pointerId: 1 });
  assert.equal(document.documentElement.style.vars['--ui-panelWidth'], '380px');
  inspector.handle.dispatch('pointermove', { clientX: 2000, pointerId: 1 });
  assert.equal(document.documentElement.style.vars['--ui-panelWidth'], '640px'); // máximo
  inspector.handle.dispatch('pointermove', { clientX: 0, pointerId: 1 });
  assert.equal(document.documentElement.style.vars['--ui-panelWidth'], '220px'); // mínimo
  inspector.handle.dispatch('pointerup', { pointerId: 1 });
  assert.equal(store['projectdrawn.panelWidth'], '220');
  // Ao abrir de novo, volta com a largura guardada.
  installDom();
  new Inspector(document.body, { scene, selection: new Selection() });
  assert.equal(document.documentElement.style.vars['--ui-panelWidth'], '220px');
  delete globalThis.localStorage;
});

test('app: atalhos escondidos no começo; o botão e Alt+H mostram e escondem', async () => {
  const { hint } = installDom();
  const { app } = await import('../js/main.js');
  assert.equal(hint.hidden, true);
  assert.match(hint.text, /Alt\+H: mostrar\/esconder esta lista de atalhos/);
  app.hintButton.dispatch('click');
  assert.equal(hint.hidden, false);
  assert.equal(app.hintButton.classList.contains('active'), true);
  window.dispatch('keydown', { key: 'h', code: 'KeyH', altKey: true });
  assert.equal(hint.hidden, true);
  window.dispatch('keydown', { key: '˙', code: 'KeyH', altKey: true }); // Alt+H no Mac
  assert.equal(hint.hidden, false);
});
