// Etapa 3a: conceitos (um por arquivo) e registro de linguagens (a extensão do arquivo escolhe a
// linguagem; cada arquivo só aceita os nós da dele).
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { Camera } from '../js/core/canvas/camera.js';
import { Renderer } from '../js/core/canvas/renderer.js';
import { Selection } from '../js/core/canvas/selection.js';
import { concepts } from '../js/core/concepts/index.js';
import { Languages } from '../js/core/languages.js';
import { layoutNode } from '../js/core/node.js';
import { ROOT, Scene } from '../js/core/scene.js';
import { deserialize, serialize } from '../js/core/storage.js';
import { theme } from '../js/theme/default.js';
import { Inspector } from '../js/ui/inspector.js';
import { FakeElement, installDom } from './fakeDom.js';
import { languages } from './langs.js';

function setup() {
  installDom();
  const canvas = new FakeElement('canvas');
  const camera = new Camera();
  const scene = new Scene({ languages, areaPad: theme.area.pad, layout: (n) => layoutNode(n, theme, (t) => t.length * 7, languages.of(n)) });
  const selection = new Selection();
  const renderer = new Renderer(canvas, { camera, scene, selection, theme });
  renderer.resize(1600, 1200);
  const add = (id, lang, x, y, scope, values) => scene.addNode(languages.def(id, lang), { x, y, scope, values });
  const res = add('folder', null, 0, 0, ROOT, { name: 'res' });
  const gd = add('file', null, 20, 60, res.id, { name: 'player.gd' });
  const shader = add('file', null, 600, 60, res.id, { name: 'water.gdshader' });
  const json = add('file', null, 1200, 60, res.id, { name: 'data.json' });
  return { canvas, scene, selection, renderer, add, res, gd, shader, json };
}
const ids = (defs) => defs.map((d) => d.id);

test('conceitos: um arquivo por conceito, todos no índice', () => {
  const files = readdirSync(new URL('../js/core/concepts/', import.meta.url)).filter((f) => f !== 'index.js');
  assert.equal(files.length, Object.keys(concepts).length);
  assert.ok(['folder', 'file', 'class', 'function', 'variable', 'get', 'set', 'path'].every((id) => concepts[id]));
});

test('registro: o nó ganha as regras do conceito e a marca da linguagem; conceito errado é erro', () => {
  const variable = languages.def('variable', 'teste');
  assert.equal(variable.lang, 'teste');
  assert.deepEqual(variable.references, { get: 'get', set: 'set', pin: 'value' });
  assert.equal(languages.def('class', 'teste').area, true);
  assert.equal(languages.def('var_get', 'teste').hidden, true);
  assert.equal(languages.def('folder').lang, null); // do núcleo
  assert.equal(languages.def('variable', 'teste2'), null);
  assert.throws(() => new Languages([{ id: 'x', nodes: [{ id: 'a', concept: 'nada' }] }]), /invalid concept "nada"/);
  assert.throws(() => new Languages([{ id: 'x', nodes: [{ id: 'f', concept: 'file' }] }]), /invalid concept "file"/);
});

test('a extensão escolhe a linguagem; sem linguagem para a extensão, null', () => {
  const { scene, gd, shader, json } = setup();
  assert.equal(languages.forFile(gd).id, 'teste');
  assert.equal(languages.forFile(shader).id, 'teste2');
  assert.equal(languages.forFile(json), null);
  assert.equal(scene.scriptType(shader), 'teste2');
  assert.equal(languages.byConcept('teste2', 'get').id, 'uniform_get');
});

test('menu: raiz só pasta/arquivo; cada arquivo só os nós da linguagem dele; .json nada', () => {
  const { scene, res, gd, shader, json } = setup();
  assert.deepEqual(ids(scene.menuDefs(ROOT)), ['folder', 'file']);
  assert.deepEqual(ids(scene.menuDefs(res.id)), ['folder', 'file']);
  assert.ok(scene.menuDefs(gd.id).every((d) => d.lang === 'teste'));
  assert.ok(ids(scene.menuDefs(gd.id)).includes('print'));
  // No shader: os nós dele e os métodos nativos (funções com o nome de cada um).
  assert.deepEqual(scene.menuDefs(shader.id).map((d) => d.title), ['Function', 'uniform', 'Mix', 'vertex', 'fragment', 'light']);
  assert.deepEqual(scene.menuDefs(json.id), []);
  assert.equal(scene.accepts(shader.id, languages.def('print', 'teste')), false);
});

test('soltar: nó de uma linguagem não vai para arquivo de outra; pasta num shader sem nó de caminho', () => {
  const { scene, add, res, gd, shader } = setup();
  const mix = add('mix', 'teste2', 620, 120, shader.id);
  assert.match(scene.canDrop([mix], gd.id).reason, /Mix só vai para um script da linguagem Teste 2/);
  const other = add('file', null, 0, 900, res.id, { name: 'foam.gdshader' });
  assert.ok(scene.canDrop([mix], other.id).ok);
  assert.match(scene.canDrop([gd], shader.id).reason, /Teste 2 não tem nó de caminho/);
});

test('cada nó usa os tipos da linguagem dele (pinos, cores, lista de tipos no inspetor)', () => {
  const { scene, selection, renderer, add, shader } = setup();
  const u = add('uniform', 'teste2', 620, 120, shader.id, { name: 'speed' });
  assert.equal(scene.typeDef(u, u.inputs[0]).label, 'float');
  assert.equal(renderer.pinColor(u, u.outputs[0]), '#6e5bff');
  const inspector = new Inspector(document.body, { scene, selection });
  selection.set([u.id]);
  inspector.refresh();
  const find = (el, f) => (f(el) ? el : el.children.map((c) => find(c, f)).find(Boolean) ?? null);
  const select = find(inspector.body, (e) => e.tagName === 'SELECT');
  assert.deepEqual(select.children.map((o) => o.value), ['float', 'vec3']);
  // Referência da segunda linguagem: o get dela (pelo conceito).
  const get = scene.addReference(u, 'get');
  assert.equal(get.type, 'uniform_get');
  assert.equal(get.title, 'speed');
});

test('arquivo trocou de extensão: os nós da outra linguagem ficam vermelhos, com o aviso', () => {
  const { canvas, scene, selection, renderer, add, gd } = setup();
  const print = add('print', 'teste', 40, 120, gd.id);
  const dashed = () => {
    canvas.calls.length = 0;
    renderer.draw();
    return canvas.calls.some((c) => c[0] === 'setLineDash' && c[1].length === 2);
  };
  assert.equal(scene.isForeign(print), false);
  assert.equal(dashed(), false);
  scene.setField(gd, 'name', 'player.gdshader');
  assert.equal(scene.isForeign(print), true);
  assert.equal(dashed(), true); // borda tracejada (vermelha)
  const inspector = new Inspector(document.body, { scene, selection });
  selection.set([print.id]);
  inspector.refresh();
  assert.match(inspector.body.text, /linguagem Teste, mas está em player\.gdshader/);
  scene.setField(gd, 'name', 'player.gd');
  assert.equal(scene.isForeign(print), false);
});

test('salvar guarda a linguagem do nó; dados antigos (sem lang) acham o tipo', () => {
  const { scene, add, shader, gd } = setup();
  const f = add('function', 'teste2', 620, 120, shader.id);
  add('function', 'teste', 40, 120, gd.id);
  const data = JSON.parse(JSON.stringify(serialize(scene, new Camera())));
  assert.equal(data.nodes.find((n) => n.id === f.id).lang, 'teste2');
  const again = new Scene({ languages });
  deserialize(data, { scene: again, camera: new Camera() });
  assert.equal(again.byId(f.id).lang, 'teste2');
  assert.equal(again.byId(f.id).title, 'my_function');
  for (const n of data.nodes) delete n.lang;
  const old = new Scene({ languages });
  deserialize(data, { scene: old, camera: new Camera() });
  assert.equal(old.byId(gd.id).concept, 'file'); // do núcleo
  assert.equal(old.byId(f.id).lang, 'teste'); // sem lang: a primeira linguagem que tem o tipo
});
