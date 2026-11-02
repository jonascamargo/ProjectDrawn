// Referências (etapa 2c): Ctrl+clique = get, Alt+clique = set; acompanham nome e tipo;
// alcance (área da variável e as de dentro); quebrada ao apagar; destaque; salvar.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortcuts } from '../js/config/shortcuts.js';
import { Camera } from '../js/core/canvas/camera.js';
import { CanvasInput } from '../js/core/canvas/input.js';
import { filterNodes } from '../js/core/canvas/nodeMenu.js';
import { Renderer } from '../js/core/canvas/renderer.js';
import { Selection } from '../js/core/canvas/selection.js';
import { layoutNode } from '../js/core/node.js';
import { ROOT, Scene } from '../js/core/scene.js';
import { deserialize, serialize } from '../js/core/storage.js';
import { language, languages } from './langs.js';
import { theme } from '../js/theme/default.js';
import { FakeElement, installDom } from './fakeDom.js';

function setup() {
  installDom();
  const canvas = new FakeElement('canvas');
  const camera = new Camera();
  const scene = new Scene({ languages, areaPad: theme.area.pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  const selection = new Selection();
  const renderer = new Renderer(canvas, { camera, scene, selection, theme });
  renderer.resize(1600, 1200);
  new CanvasInput(canvas, { camera, scene, selection, renderer, theme, shortcuts }).attach();
  const add = (id, x, y, scope, values) => scene.addNode(languages.def(id), { x, y, scope, values });
  const file = add('file', 60, 60, ROOT, { name: 'player.gd' });
  const health = add('variable', 80, 120, file.id, { name: 'health', type: 'float' });
  const ready = add('function', 80, 320, file.id, { name: '_ready' });
  const print = add('print', 100, 380, ready.id);
  const other = add('function', 500, 320, file.id, { name: '_process' });
  const local = add('variable', 520, 380, other.id, { name: 'temp', type: 'text' });
  scene.fitAreas();
  const ev = (x, y, extra = {}) => ({ clientX: x, clientY: y, button: 0, pointerId: 1, ...extra });
  const click = (n, extra) => {
    const p = { x: n.x + n.w / 2, y: n.y + 10 };
    canvas.dispatch('pointerdown', ev(p.x, p.y, extra));
    canvas.dispatch('pointerup', ev(p.x, p.y, extra));
  };
  return { canvas, scene, selection, renderer, add, click, ev, file, health, ready, print, other, local };
}

test('Ctrl+clique cria get e Alt+clique cria set, ao lado da variável, selecionados', () => {
  const { scene, selection, click, health, file } = setup();
  click(health, { ctrlKey: true });
  const get = scene.elements.at(-1);
  assert.equal(get.type, 'var_get');
  assert.equal(get.ref, health.id);
  assert.equal(get.scope, file.id);
  assert.equal(get.title, 'health');
  assert.equal(get.tag, 'float');
  assert.equal(get.outputs[0].type, 'float');
  assert.equal(get.x, health.x + health.w + 30);
  assert.deepEqual([...selection.ids], [get.id]);
  click(health, { altKey: true });
  const set = scene.elements.at(-1);
  assert.equal(set.type, 'var_set');
  assert.equal(set.title, 'set health');
  assert.deepEqual(set.inputs.map((p) => p.type), [null, 'float']);
  assert.equal(set.inputs[1].cy, set.outputs[1].cy); // value ↔ value na mesma linha
  assert.equal(set.h > 40, true); // set tem corpo; get é compacto
  assert.equal(get.h, 40);
});

test('clique comum não cria nada; Ctrl+clique em nó sem referências também não', () => {
  const { scene, click, health, print } = setup();
  const n = scene.elements.length;
  click(health);
  click(print, { ctrlKey: true });
  assert.equal(scene.elements.length, n);
});

test('referência acompanha nome e tipo; tipo novo tira fios que não servem', () => {
  const { scene, health, ready } = setup();
  const get = scene.addReference(health, 'get');
  // Leva o get para dentro do _ready e liga num To Text (aceita qualquer) e num Add (float).
  scene.moveInto([get], ready.id);
  const add = scene.addNode(languages.def('add'), { x: 300, y: 400, scope: ready.id });
  scene.connect({ node: get, pin: get.outputs[0] }, { node: add, pin: add.inputs[0] });
  assert.equal(scene.wiresOf(get).length, 1);
  scene.setField(health, 'name', 'hp');
  assert.equal(get.title, 'hp');
  scene.setField(health, 'type', 'text');
  assert.equal(get.tag, 'text');
  assert.equal(get.outputs[0].type, 'text');
  assert.equal(scene.wiresOf(get).length, 0); // text não entra em float
});

test('alcance pela posição atual: soltar fora pode, mas fica vermelho; voltar resolve', () => {
  const { scene, health, ready, other, local, file } = setup();
  const get = scene.addReference(health, 'get');
  assert.equal(scene.canDrop([get], ready.id).ok, true);
  const tempGet = scene.addReference(local, 'get');
  assert.equal(tempGet.scope, other.id);
  assert.equal(scene.canDrop([tempGet], ready.id).ok, true); // pode soltar…
  scene.moveInto([tempGet], ready.id);
  assert.equal(tempGet.outOfReach, true); // …mas fica fora do alcance
  scene.moveInto([tempGet], file.id);
  assert.equal(tempGet.outOfReach, true); // no arquivo, fora da função, também
  scene.moveInto([tempGet], other.id);
  assert.equal(tempGet.outOfReach, false);
});

test('a variável muda de lugar: as referências que ficaram fora do alcance ficam vermelhas', () => {
  const { scene, canvas, renderer, health, ready, file } = setup();
  const get = scene.addReference(health, 'get');
  const set = scene.addReference(health, 'set');
  assert.equal(get.outOfReach, false);
  scene.moveInto([health], ready.id); // variável vai para dentro do _ready; get e set ficaram no arquivo
  assert.equal(get.outOfReach, true);
  assert.equal(set.outOfReach, true);
  canvas.calls.length = 0;
  renderer.draw();
  assert.ok(canvas.calls.some((c) => c[0] === 'setLineDash' && c[1].length === 2));
  scene.moveInto([get], ready.id);
  assert.equal(get.outOfReach, false);
  scene.moveInto([health], file.id);
  assert.equal(set.outOfReach, false);
});

test('religar: referência quebrada escolhe outra variável ao alcance', () => {
  const { scene, health, add, file, ready } = setup();
  const get = scene.addReference(health, 'get');
  scene.moveInto([get], ready.id);
  const hp = add('variable', 300, 120, file.id, { name: 'hp', type: 'int' });
  scene.remove([health.id]);
  assert.equal(get.broken, true);
  const candidates = scene.relinkCandidates(get).map((n) => n.title);
  assert.deepEqual(candidates, ['hp']); // 'temp' (do _process) não alcança o _ready
  scene.relink(get, hp);
  assert.equal(get.broken, false);
  assert.equal(get.title, 'hp');
  assert.equal(get.tag, 'int');
});

test('apagar a variável deixa as referências quebradas (borda vermelha, aviso no inspetor)', () => {
  const { scene, canvas, renderer, health } = setup();
  const get = scene.addReference(health, 'get');
  const set = scene.addReference(health, 'set');
  scene.remove([health.id]);
  assert.equal(get.broken, true);
  assert.equal(set.broken, true);
  assert.equal(get.title, 'health'); // nome continua
  canvas.calls.length = 0;
  renderer.draw();
  assert.ok(canvas.calls.some((c) => c[0] === 'setLineDash' && c[1].length === 2));
});

test('destaque: selecionar a variável destaca as referências, e o contrário', () => {
  const { scene, selection, renderer, health, print } = setup();
  const get = scene.addReference(health, 'get');
  const set = scene.addReference(health, 'set');
  selection.set([health.id]);
  renderer.draw();
  assert.deepEqual(new Set([...renderer.related].map((n) => n.id)), new Set([get.id, set.id]));
  selection.set([get.id]);
  renderer.draw();
  assert.deepEqual(new Set([...renderer.related].map((n) => n.id)), new Set([health.id, set.id]));
  selection.set([print.id]);
  renderer.draw();
  assert.equal(renderer.related.size, 0);
});

test('get/set não aparecem no menu; salvar guarda a referência e reabre ligada', () => {
  const { scene, health } = setup();
  const visible = language.nodes.filter((d) => !d.hidden);
  assert.ok(!filterNodes(visible, 'get').some((d) => d.reference));
  const get = scene.addReference(health, 'get');
  const data = JSON.parse(JSON.stringify(serialize(scene, new Camera())));
  assert.equal(data.nodes.find((n) => n.id === get.id).ref, health.id);
  const again = new Scene({ languages, areaPad: theme.area.pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  deserialize(data, { scene: again, camera: new Camera() });
  const get2 = again.byId(get.id);
  assert.equal(get2.title, 'health');
  assert.equal(get2.tag, 'float');
  assert.equal(get2.broken, false);
});

test('inspetor de uma referência mostra de onde vem; quebrada mostra o aviso', async () => {
  const { Inspector } = await import('../js/ui/inspector.js');
  const { scene, selection, health } = setup();
  const inspector = new Inspector(document.body, { scene, selection });
  const get = scene.addReference(health, 'get');
  selection.set([get.id]);
  inspector.refresh();
  assert.match(inspector.body.text, /Referência a "health"/);
  scene.remove([health.id]);
  inspector.refresh();
  assert.match(inspector.body.text, /foi apagado/);
});
