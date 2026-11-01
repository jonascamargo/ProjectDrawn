// Reabrir o app com um projeto salvo no IndexedDB: volta como estava, sem os nós de exemplo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIdbStore } from '../js/core/storage.js';
import { fakeIndexedDB, installDom } from './fakeDom.js';

installDom();
globalThis.indexedDB = fakeIndexedDB();
await createIdbStore().save({
  version: 1,
  camera: { x: -40, y: 10, zoom: 2 },
  nextId: 10,
  nodes: [
    { id: 1, type: 'variable', x: 100, y: 100, scope: 'root', values: { name: 'idade', type: 'number', infer: false } },
    { id: 2, type: 'add', x: 400, y: 100, scope: 'root', values: {} },
  ],
  wires: [{ id: 3, from: { node: 2, pin: 'result' }, to: { node: 1, pin: 'value' } }],
});
const { app } = await import('../js/main.js');

test('abre o projeto salvo: nós, valores, fio e câmera', () => {
  assert.equal(app.scene.elements.length, 2);
  assert.equal(app.scene.byId(1).title, 'idade');
  assert.equal(app.scene.byId(1).tag, 'number');
  assert.equal(app.scene.wires.length, 1);
  assert.equal(app.camera.zoom, 2);
  assert.equal(app.scene.addNode({ id: 'x', title: 'x' }, { x: 0, y: 0 }).id, 10);
});
