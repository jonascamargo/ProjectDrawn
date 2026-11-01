// O app inteiro (js/main.js) com DOM falso: monta, desenha e cria nó pelo menu.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installDom } from './fakeDom.js';

const { canvas, hint } = installDom();
const { app } = await import('../js/main.js');
const ev = (x, y, extra = {}) => ({ clientX: x, clientY: y, button: 0, pointerId: 1, ...extra });

test('abre com um nó de cada e desenha títulos e nomes dos pinos', () => {
  assert.equal(app.scene.elements.length, 6);
  canvas.calls.length = 0;
  app.renderer.draw();
  const texts = canvas.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  for (const t of ['Início', 'Imprimir', 'Se', 'Somar', 'Variável', 'Para texto', 'verdadeiro', 'configuração']) {
    assert.ok(texts.includes(t), t);
  }
});

test('dica de atalhos montada do arquivo de atalhos', () => {
  assert.match(hint.text, /Ctrl\+A: selecionar tudo/);
  assert.match(hint.text, /Botão direito: clique no vazio: criar nó/);
  assert.match(hint.text, /Espaço: segurar \+ arrastar/);
});

test('clique direito no vazio → busca → Enter cria o nó no ponto, selecionado', () => {
  const menu = app.menu;
  canvas.dispatch('pointerdown', ev(700, 500, { button: 2 }));
  canvas.dispatch('pointerup', ev(700, 500, { button: 2 }));
  assert.equal(menu.isOpen, true);
  assert.equal(menu.list.children.length, 6);
  menu.input.value = 'som';
  menu.input.dispatch('input');
  assert.deepEqual(menu.items.map((d) => d.id), ['add']);
  menu.input.dispatch('keydown', { key: 'Enter' });
  assert.equal(menu.isOpen, false);
  const node = app.scene.elements.at(-1);
  assert.equal(node.title, 'Somar');
  assert.deepEqual([node.x, node.y], [700, 500]);
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
  assert.equal(menu.active, 5); // dá a volta
  menu.input.value = 'zzz';
  menu.input.dispatch('input');
  assert.match(menu.list.text, /Nenhum nó encontrado/);
  menu.input.dispatch('keydown', { key: 'Enter' }); // não cria nada
  menu.input.dispatch('keydown', { key: 'Escape' });
  assert.equal(menu.isOpen, false);
});

test('menu: clique num item cria; clique fora fecha', () => {
  const menu = app.menu;
  const before = app.scene.elements.length;
  menu.open({ x: 10, y: 10 }, { x: 40, y: 40 });
  const li = menu.list.children[0];
  menu.list.dispatch('pointerdown', { target: li.children[0] });
  assert.equal(app.scene.elements.length, before + 1);
  assert.equal(app.scene.elements.at(-1).title, 'Início');
  menu.open({ x: 10, y: 10 }, { x: 0, y: 0 });
  document.dispatch('pointerdown', { target: canvas });
  assert.equal(menu.isOpen, false);
});

test('menu abre dentro da janela perto da borda', () => {
  const menu = app.menu;
  menu.open({ x: 990, y: 690 }, { x: 0, y: 0 });
  assert.equal(menu.el.style.left, `${1000 - 240 - 8}px`);
  assert.equal(menu.el.style.top, `${700 - 200 - 8}px`);
  menu.close();
});
