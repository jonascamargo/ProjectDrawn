// Idioma, campos do nó (inspetor), inferência de tipo, ícones e salvamento.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Camera } from '../js/core/canvas/camera.js';
import { registerLocale, setLocale, t } from '../js/core/i18n.js';
import { layoutNode } from '../js/core/node.js';
import { Scene } from '../js/core/scene.js';
import { createAutosave, createIdbStore, createMemoryStore, deserialize, serialize } from '../js/core/storage.js';
import { canConnect } from '../js/core/wires.js';
import { language } from '../js/lang/teste/index.js';
import { theme } from '../js/theme/default.js';
import ptBR from '../js/i18n/pt-BR.js';
import { fakeIndexedDB } from './fakeDom.js';

const measure = (text) => text.length * 7;

function setup() {
  const scene = new Scene({ language, layout: (n) => layoutNode(n, theme, measure, language) });
  const add = (id, x = 0, y = 0) => scene.addNode(language.node(id), { x, y });
  const pin = (node, id, dir = 'out') => ({ node, pin: node[dir === 'out' ? 'outputs' : 'inputs'].find((p) => p.id === id) });
  return { scene, add, pin };
}

test('idioma: textos de ajuda com parâmetros, outro idioma, chave sem texto', () => {
  assert.equal(t('pin.maxMany', { n: 3 }), 'até 3 fios');
  assert.equal(t('nada.aqui'), 'nada.aqui');
  registerLocale('en', { 'pin.in': 'input' });
  setLocale('en');
  assert.equal(t('pin.in'), 'input');
  setLocale('pt-BR');
  assert.equal(t('pin.in'), 'entrada');
  assert.throws(() => setLocale('xx'));
});

test('idioma: todo atalho tem texto de ajuda; nomes dos nós em inglês', async () => {
  const { shortcuts } = await import('../js/config/shortcuts.js');
  for (const action of [...Object.keys(shortcuts.keys), ...Object.keys(shortcuts.mouse)]) {
    assert.ok(ptBR[`shortcut.${action}`], action);
  }
  for (const def of language.nodes) {
    assert.match(def.title, /^[\x20-\x7e]+$/, def.title); // só ASCII: sem acento
    for (const p of [...(def.inputs ?? []), ...(def.outputs ?? [])]) assert.match(p.label ?? '', /^[\x20-\x7e]*$/);
  }
});

test('campos: Name vira o título; Type muda tag e pinos e desconecta tudo do nó', () => {
  const { scene, add, pin } = setup();
  const v = add('variable');
  const sum = add('add');
  const toText = add('to_text');
  assert.equal(v.title, 'value');
  scene.setField(v, 'name', 'idade');
  assert.equal(v.title, 'idade');
  scene.setField(v, 'name', '');
  assert.equal(v.title, 'Variable'); // vazio volta ao título da definição
  scene.connect(pin(sum, 'result'), pin(v, 'value', 'in'));
  scene.connect(pin(v, 'value'), pin(toText, 'value', 'in'));
  assert.equal(scene.wiresOf(v).length, 2);
  scene.setField(v, 'type', 'number');
  assert.equal(v.tag, 'number');
  assert.equal(v.inputs[1].type, 'number');
  assert.equal(v.outputs[0].type, 'number');
  assert.equal(v.inputs[0].type, null); // config não muda
  assert.equal(scene.wiresOf(v).length, 0);
  // Mesmo valor: nada acontece (não desconecta de novo).
  scene.connect(pin(sum, 'result'), pin(v, 'value', 'in'));
  scene.setField(v, 'type', 'number');
  assert.equal(scene.wiresOf(v).length, 1);
});

test('inferir tipo: vem do fio na entrada value; trava o tipo; tira só os fios que não servem', () => {
  const { scene, add, pin } = setup();
  const v = add('variable');
  const sum = add('add');
  const user = add('text');
  const print = add('print');
  scene.connect(pin(v, 'value'), pin(print, 'text', 'in')); // any → text: liga
  scene.setField(v, 'infer', true);
  assert.equal(v.values.type, 'any'); // nada ligado na entrada: tipo padrão
  scene.connect(pin(sum, 'result'), pin(v, 'value', 'in'));
  assert.equal(v.values.type, 'number');
  assert.equal(v.tag, 'number');
  assert.equal(v.outputs[0].type, 'number');
  assert.equal(v.inputs[1].type, 'any'); // a entrada de onde vem o tipo aceita qualquer um
  assert.equal(scene.wiresOf(v).length, 1); // o de sum continua; o que ia para text (number → text) saiu
  assert.ok(canConnect(pin(sum, 'result'), pin(v, 'value', 'in'), language).ok);
  // Trocar a origem: tipo acompanha.
  scene.connect(pin(user, 'get'), pin(v, 'value', 'in'));
  assert.equal(v.values.type, 'text');
  // Desligar: volta ao padrão.
  scene.disconnect(scene.wiresOf(v).map((w) => w.id));
  assert.equal(v.values.type, 'any');
  // Desmarcar: o tipo fica como está, a entrada volta a ter o tipo e não segue mais o fio.
  scene.connect(pin(sum, 'result'), pin(v, 'value', 'in'));
  scene.setField(v, 'infer', false);
  assert.equal(v.inputs[1].type, 'number');
  assert.equal(scene.wiresOf(v).length, 1); // o de sum (number) continua valendo
  assert.equal(scene.connect(pin(user, 'get'), pin(v, 'value', 'in')).ok, false);
  assert.equal(v.values.type, 'number');
});

test('ícones: vêm da linguagem (arquivo SVG e cor); etiqueta com a largura do SVG a 14px', async () => {
  const { loadIcons } = await import('../js/core/canvas/icons.js');
  const { installDom } = await import('./fakeDom.js');
  installDom();
  const icons = {
    ok: { file: 'icons/function.svg', color: '#123456' },
    broken: { file: 'icons/quebrado.svg', color: '#000' },
  };
  const warn = console.warn;
  console.warn = () => {};
  await loadIcons(icons);
  console.warn = warn;
  assert.ok(icons.ok.image);
  assert.deepEqual([icons.ok.width, icons.ok.height], [12, 14]);
  assert.equal(icons.broken.image, undefined); // não carregou: nó sem ícone, sem erro
  assert.deepEqual(Object.keys(language.icons), ['function', 'event', 'loop', 'condition', 'folder', 'file', 'class']);
  assert.deepEqual(Object.values(language.icons).map((i) => i.color), ['#0A6CC2', '#C20A0A', '#C2850A', '#666666', null, null, '#196633']);
  assert.equal(language.node('greater').icon, 'condition');
  assert.equal(language.node('and').icon, 'condition');
  Object.assign(language.icons.event, { width: 15, height: 14 });
  const { add } = setup();
  const start = add('start');
  assert.equal(start.layout.tagW, (15 * 14) / 14 + theme.tag.padX * 2);
  assert.equal(theme.icon.size, 14);
  assert.equal(theme.icon.color, '#2E2E2E');
  assert.equal(theme.tag.text, '#2E2E2E');
});

test('salvar: ida e volta mantém nós, valores, fios, reroute e câmera', () => {
  const { scene, add, pin } = setup();
  const camera = new Camera();
  camera.x = 50;
  camera.zoom = 1.5;
  const v = add('variable', 10, 20);
  scene.setField(v, 'name', 'idade');
  scene.setField(v, 'type', 'number');
  const sum = add('add', 300, 0);
  const s = add('start', 0, 300);
  const p = add('print', 400, 300);
  scene.connect(pin(sum, 'result'), pin(v, 'value', 'in'));
  const r = scene.addReroute(scene.connect(pin(s, 'next'), pin(p, 'run', 'in')).wire, { x: 200, y: 340 });
  const data = JSON.parse(JSON.stringify(serialize(scene, camera)));

  const other = setup().scene;
  const camera2 = new Camera();
  deserialize(data, { scene: other, camera: camera2, language });
  assert.deepEqual(serialize(other, camera2), data);
  const v2 = other.byId(v.id);
  assert.equal(v2.title, 'idade');
  assert.equal(v2.tag, 'number');
  assert.ok(other.byId(r.id).reroute);
  assert.equal(other.wires.length, 3);
  assert.equal(camera2.zoom, 1.5);
  // Ids novos continuam depois dos carregados.
  assert.ok(other.addNode(language.node('start'), { x: 0, y: 0 }).id >= data.nextId);
});

test('salvar: nó desconhecido e fio sem ponta são ignorados', () => {
  const scene = setup().scene;
  deserialize({
    nodes: [{ id: 1, type: 'start', x: 0, y: 0, scope: 'root', values: {} }, { id: 2, type: 'sumiu', x: 0, y: 0 }],
    wires: [{ id: 3, from: { node: 1, pin: 'next' }, to: { node: 2, pin: 'run' } }],
  }, { scene, camera: new Camera(), language });
  assert.equal(scene.elements.length, 1);
  assert.equal(scene.wires.length, 0);
});

test('armazenamento: memória e IndexedDB (falso) guardam e devolvem', async () => {
  const mem = createMemoryStore();
  assert.equal(await mem.load(), null);
  await mem.save({ a: 1 });
  assert.deepEqual(await mem.load(), { a: 1 });

  const idb = fakeIndexedDB();
  const store = createIdbStore({ idb });
  assert.equal(await store.load(), null);
  await store.save({ version: 1, nodes: [] });
  assert.deepEqual(await store.load(), { version: 1, nodes: [] });
  assert.deepEqual(idb.created, ['projects']);
  assert.equal(createIdbStore({ idb: null }).constructor, Object); // sem IndexedDB: memória
});

test('armazenamento: banco próprio; o "projectdrawn" do app antigo (versão 2) fica intocado', async () => {
  const old = { version: 2, stores: new Map([['projects', new Map([['x', { antigo: true }]])]]) };
  const idb = fakeIndexedDB({ projectdrawn: old });
  const store = createIdbStore({ idb });
  await store.save({ version: 1 });
  assert.deepEqual(await store.load(), { version: 1 });
  assert.equal(old.version, 2);
  assert.deepEqual([...old.stores.get('projects').keys()], ['x']);
  assert.ok(idb.dbs['projectdrawn-canvas']);
});

test('armazenamento: banco que já existe numa versão maior, sem o armazém, ganha o armazém', async () => {
  const idb = fakeIndexedDB({ 'projectdrawn-canvas': { version: 3, stores: new Map() } });
  const store = createIdbStore({ idb });
  await store.save({ ok: 1 });
  assert.deepEqual(await store.load(), { ok: 1 });
  assert.equal(idb.dbs['projectdrawn-canvas'].version, 4);
});

test('falso fiel ao real: pedir versão menor que a existente dá VersionError', async () => {
  const idb = fakeIndexedDB({ projectdrawn: { version: 2, stores: new Map() } });
  const req = idb.open('projectdrawn', 1);
  const error = await new Promise((resolve) => { req.onerror = () => resolve(req.error); });
  assert.match(error.message, /VersionError/);
});

test('salvamento automático: espera parar de mudar e salva uma vez', async () => {
  const saves = [];
  let n = 0;
  const autosave = createAutosave({ save: async (d) => saves.push(d) }, () => ++n, { delay: 20 });
  autosave.schedule();
  autosave.schedule();
  autosave.schedule();
  assert.equal(autosave.pending, true);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(saves, [1]);
  assert.equal(autosave.pending, false);
  autosave.schedule();
  await autosave.flush();
  assert.deepEqual(saves, [1, 2]);
});
