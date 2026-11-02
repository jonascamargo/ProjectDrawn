// O app inteiro (js/main.js) com DOM falso: monta, desenha e cria nó pelo menu.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installDom } from './fakeDom.js';

const { canvas, hint } = installDom();
const { app } = await import('../js/main.js');
const ev = (x, y, extra = {}) => ({ clientX: x, clientY: y, button: 0, pointerId: 1, ...extra });
const byName = (name) => app.scene.elements.find((n) => n.title === name);
// Ponto vazio no corpo de uma área (canto inferior direito, dentro da margem).
const bodyPoint = (area) => ({ x: area.x + area.w - 5, y: area.y + area.h - 5 });

test('abre com o exemplo: res / assets, player.gd (_ready → Print), enemy.gd, data.json', () => {
  assert.deepEqual(app.scene.elements.map((n) => n.title), ['res', 'assets', 'player.gd', '_ready', 'Print', 'enemy.gd', 'data.json']);
  assert.equal(app.scene.wires.length, 1);
  canvas.calls.length = 0;
  app.renderer.draw();
  const texts = canvas.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  // O pino text do Print mostra o valor digitado ("") no lugar do nome.
  for (const t of ['res', 'assets', 'player.gd', '_ready', 'Print', 'enemy.gd', 'data.json', '""']) assert.ok(texts.includes(t), t);
});

test('dica de atalhos montada do arquivo de atalhos', () => {
  assert.match(hint.text, /Ctrl\+A: selecionar tudo/);
  assert.match(hint.text, /Botão direito: clique no vazio: criar nó/);
  assert.match(hint.text, /Espaço: segurar \+ arrastar/);
});

test('clique direito: na raiz só Folder e File; dentro do _ready só nós de script, criados nele', () => {
  const menu = app.menu;
  canvas.dispatch('pointerdown', ev(1100, 900, { button: 2 }));
  canvas.dispatch('pointerup', ev(1100, 900, { button: 2 }));
  assert.equal(!menu.el.hidden, true);
  assert.deepEqual(menu.items.map((d) => d.id), ['folder', 'file']);
  menu.input.dispatch('keydown', { key: 'Escape' });

  const ready = byName('_ready');
  const p = bodyPoint(ready);
  canvas.dispatch('pointerdown', ev(p.x, p.y, { button: 2 }));
  canvas.dispatch('pointerup', ev(p.x, p.y, { button: 2 }));
  assert.ok(!menu.items.some((d) => d.area)); // nada de pasta, arquivo, classe ou função
  assert.equal(menu.items.length, 13);
  menu.input.value = 'add';
  menu.input.dispatch('input');
  assert.deepEqual(menu.items.map((d) => d.id), ['add']);
  menu.input.dispatch('keydown', { key: 'Enter' });
  assert.equal(!menu.el.hidden, false);
  const node = app.scene.elements.at(-1);
  assert.equal(node.title, 'Add');
  assert.equal(node.scope, ready.id);
  assert.deepEqual([node.x, node.y], [p.x, p.y]);
  assert.deepEqual([...app.selection.ids], [node.id]);
});

test('menu: setas navegam, Esc fecha, busca sem resultado mostra aviso', () => {
  const menu = app.menu;
  menu.open({ x: 10, y: 10 }, { x: 0, y: 0 });
  menu.input.dispatch('keydown', { key: 'ArrowDown' });
  menu.input.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(menu.active, 2);
  assert.ok(menu.list.children[2].classList.contains('active'));
  menu.input.dispatch('keydown', { key: 'ArrowUp' });
  menu.input.dispatch('keydown', { key: 'ArrowUp' });
  menu.input.dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(menu.active, 16); // dá a volta (17 nós na lista sem filtro)
  menu.input.value = 'zzz';
  menu.input.dispatch('input');
  assert.match(menu.list.text, /Nenhum nó encontrado/);
  menu.input.dispatch('keydown', { key: 'Enter' }); // não cria nada
  menu.input.dispatch('keydown', { key: 'Escape' });
  assert.equal(!menu.el.hidden, false);
});

test('menu: clique num item cria; clique fora fecha', () => {
  const menu = app.menu;
  const before = app.scene.elements.length;
  menu.open({ x: 10, y: 10 }, { x: 40, y: 40 });
  const li = menu.list.children[0];
  menu.list.dispatch('pointerdown', { target: li.children[0] });
  assert.equal(app.scene.elements.length, before + 1);
  assert.equal(app.scene.elements.at(-1).title, 'folder');
  menu.open({ x: 10, y: 10 }, { x: 0, y: 0 });
  document.dispatch('pointerdown', { target: canvas });
  assert.equal(!menu.el.hidden, false);
});

test('menu abre dentro da janela perto da borda', () => {
  const menu = app.menu;
  menu.open({ x: 990, y: 690 }, { x: 0, y: 0 });
  assert.equal(menu.el.style.left, `${1000 - 240 - 8}px`);
  assert.equal(menu.el.style.top, `${700 - 200 - 8}px`);
  menu.close();
});

test('fio solto no vazio da área → menu só com nós compatíveis → nó nasce ligado, na mesma área', async () => {
  const { pinAnchor } = await import('../js/core/node.js');
  const menu = app.menu;
  const ready = byName('_ready');
  const print = byName('Print');
  app.camera.zoomAt(0, 0, 1);
  app.camera.x = 0;
  app.camera.y = 0;
  ready.manual = { w: ready.w + 300, h: ready.h + 200 }; // espaço vazio dentro da área
  app.scene.fitAreas();
  const from = pinAnchor(print, print.outputs[0]);
  const to = { x: ready.x + ready.w - 100, y: ready.y + ready.h - 60 };
  canvas.dispatch('pointerdown', ev(from.x, from.y));
  canvas.dispatch('pointermove', ev(to.x, to.y));
  canvas.dispatch('pointerup', ev(to.x, to.y));
  assert.equal(!menu.el.hidden, true);
  // Saída de fluxo: só os nós com entrada de fluxo.
  assert.deepEqual(menu.items.map((d) => d.id), ['call', 'repeat', 'print', 'if']);
  menu.input.value = 'if';
  menu.input.dispatch('input');
  menu.input.dispatch('keydown', { key: 'Enter' });
  const node = app.scene.elements.at(-1);
  assert.equal(node.type, 'if');
  assert.equal(node.scope, ready.id);
  assert.deepEqual(pinAnchor(node, node.inputs[0]), to);
  const wire = app.scene.wires.at(-1);
  assert.deepEqual([wire.from.node, wire.to.node], [print.id, node.id]);
});

// Acha um elemento na árvore falsa.
const find = (el, test) => (test(el) ? el : el.children.map((c) => find(c, test)).find(Boolean) ?? null);
const findAll = (el, test, out = []) => {
  if (test(el)) out.push(el);
  el.children.forEach((c) => findAll(c, test, out));
  return out;
};

test('tema aplicado no HTML: variáveis --ui-* a partir de theme.ui', async () => {
  const { theme } = await import('../js/theme/default.js');
  assert.equal(document.documentElement.style.vars['--ui-bg'], theme.ui.bg);
  assert.equal(document.documentElement.style.vars['--ui-panelWidth'], theme.ui.panelWidth);
});

test('inspetor: aberto ao iniciar; I recolhe e abre', () => {
  assert.equal(!app.inspector.el.hidden, true);
  window.dispatch('keydown', { key: 'i', code: 'KeyI' });
  assert.equal(!app.inspector.el.hidden, false);
  window.dispatch('keydown', { key: 'i', code: 'KeyI' });
  assert.equal(!app.inspector.el.hidden, true);
});

test('inspetor: vazio, vários, nó com campos (Name, Type, Infer type) e fio', async () => {
  const { inspector, selection, scene, renderer } = app;
  selection.clear();
  renderer.requestRender();
  assert.match(inspector.body.text, /Selecione um nó ou fio/);
  selection.set([scene.elements[0].id, scene.elements[1].id]);
  renderer.requestRender();
  assert.match(inspector.body.text, /2 itens selecionados/);

  const { language } = await import('../js/lang/teste/index.js');
  const ready = byName('_ready');
  const v = scene.addNode(language.node('variable'), { x: ready.x + 20, y: ready.y + 400, scope: ready.id });
  selection.set([v.id]);
  renderer.requestRender();
  const labels = findAll(inspector.body, (e) => e.tagName === 'LABEL').map((l) => l.children[0].textContent);
  assert.deepEqual(labels, ['Name', 'Type', 'Infer type', 'Flow pins']); // any: sem campo de valor
  // Name: digitar muda o título.
  const name = find(inspector.body, (e) => e.tagName === 'INPUT' && e.type === 'text');
  name.value = 'idade';
  name.dispatch('input');
  assert.equal(v.title, 'idade');
  // Type: lista com os tipos da linguagem; trocar muda a tag.
  const select = find(inspector.body, (e) => e.tagName === 'SELECT');
  assert.deepEqual(select.children.map((o) => o.value), ['any', 'int', 'float', 'bool', 'text', 'vector2', 'vector3']);
  select.value = 'text';
  select.dispatch('change');
  assert.equal(v.tag, 'text');
  // Infer type: marca, trava o Type e mostra a ajuda.
  const check = find(inspector.body, (e) => e.tagName === 'INPUT' && e.type === 'checkbox');
  check.checked = true;
  check.dispatch('change');
  const select2 = find(inspector.body, (e) => e.tagName === 'SELECT');
  assert.equal(select2.disabled, true);
  assert.match(inspector.body.text, /O tipo vem do fio ligado na entrada "value"/);

  const { pinAnchor } = await import('../js/core/node.js');
  const sum = scene.elements.find((n) => n.type === 'add' && n.scope === ready.id);
  const r = scene.connect({ node: sum, pin: sum.outputs[0] }, { node: v, pin: v.inputs.find((p) => p.id === 'value') });
  assert.ok(r.ok);
  renderer.requestRender();
  assert.equal(find(inspector.body, (e) => e.tagName === 'SELECT').value, 'float'); // inspetor acompanha a inferência
  selection.set([r.wire.id]);
  renderer.requestRender();
  assert.match(inspector.body.text, /From.*Add\.result/);
  assert.match(inspector.body.text, /To.*idade\.value/);
  assert.match(inspector.body.text, /Kind.*data/);
  assert.ok(pinAnchor);
});

test('salvar automático e reabrir: o que foi salvo volta igual', async () => {
  const { serialize } = await import('../js/core/storage.js');
  await app.autosave.flush();
  const saved = await app.store.load();
  assert.deepEqual(saved, JSON.parse(JSON.stringify(serialize(app.scene, app.camera))));
  assert.ok(saved.nodes.some((n) => n.values?.name === 'idade'));
});

test('sem o menu do navegador no clique direito (fora dos campos de texto)', () => {
  let blocked = 0;
  document.dispatch('contextmenu', { target: canvas, preventDefault: () => blocked++ });
  document.dispatch('contextmenu', { target: app.menu.el, preventDefault: () => blocked++ });
  assert.equal(blocked, 2);
  const input = document.createElement('input');
  document.dispatch('contextmenu', { target: input, preventDefault: () => blocked++ });
  assert.equal(blocked, 2);
});

test('inspetor à esquerda; menu de criar abre na posição da página', () => {
  assert.equal(document.body.children[0], app.inspector.el);
  canvas.left = 280; // o canvas começa depois do inspetor
  canvas.dispatch('pointerdown', { clientX: 300, clientY: 750, button: 2, pointerId: 1 });
  canvas.dispatch('pointerup', { clientX: 300, clientY: 750, button: 2, pointerId: 1 });
  assert.equal(!app.menu.el.hidden, true);
  assert.equal(app.menu.el.style.left, '300px');
  assert.deepEqual(app.menu.world, app.camera.toWorld(20, 750));
  app.menu.close();
  canvas.left = 0;
});

test('seletor de cor não fecha enquanto escolhe: o campo continua o mesmo até o seletor fechar', () => {
  const { inspector, selection, renderer } = app;
  const res = byName('res');
  selection.set([res.id]);
  renderer.requestRender();
  const input = find(inspector.body, (e) => e.tagName === 'INPUT' && e.type === 'color');
  document.activeElement = input; // seletor aberto
  input.value = '#ff0000';
  input.dispatch('input');
  input.value = '#00ff00';
  input.dispatch('input');
  assert.equal(res.values.color, '#00ff00');
  assert.equal(find(inspector.body, (e) => e.tagName === 'INPUT' && e.type === 'color'), input); // não trocou
  input.dispatch('change'); // seletor fechou
  document.activeElement = null;
  const button = find(inspector.body, (e) => e.tagName === 'BUTTON');
  assert.equal(button.disabled, false); // Default habilitado
  button.dispatch('click');
  assert.equal(res.values.color, null);
});
