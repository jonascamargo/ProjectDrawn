// Regras de ligação, fios na cena e reroute.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlPoints, distanceToCurve } from '../js/core/canvas/curve.js';
import { layoutNode, pinAnchor, pinDirection } from '../js/core/node.js';
import { Scene } from '../js/core/scene.js';
import { kindsConnect } from '../js/core/wireKinds.js';
import { canConnect, firstCompatiblePin } from '../js/core/wires.js';
import { language, languages } from './langs.js';
import { theme } from '../js/theme/default.js';

const measure = (text) => text.length * 7;

function setup() {
  const scene = new Scene({ languages, layout: (n) => layoutNode(n, theme, measure) });
  const add = (id, x = 0, y = 0) => scene.addNode(languages.def(id), { x, y });
  const pin = (node, id, dir = 'out') => ({ node, pin: node[dir === 'out' ? 'outputs' : 'inputs'].find((p) => p.id === id) });
  return { scene, add, pin };
}

test('tipos de fio que se ligam', () => {
  assert.ok(kindsConnect('flow', 'flow'));
  assert.ok(kindsConnect('condition', 'condition'));
  assert.ok(!kindsConnect('condition', 'flow'));
  assert.ok(kindsConnect('condition', 'data')); // em entrada que aceita bool (ver canConnect)
  assert.ok(kindsConnect('data', 'data'));
  assert.ok(kindsConnect('data', 'condition')); // qualquer valor vale como condição
  assert.ok(kindsConnect('config', 'config'));
  assert.ok(!kindsConnect('flow', 'data'));
  assert.ok(!kindsConnect('flow', 'condition'));
  assert.ok(!kindsConnect('data', 'config'));
});

test('canConnect: lados, mesmo nó, tipo de fio, tipo de dado (com motivo)', () => {
  const { add, pin } = setup();
  const start = add('start');
  const print = add('print');
  const iff = add('if');
  const sum = add('add');
  const toText = add('to_text');
  const variable = add('variable');
  // Ordem tanto faz: devolve from = saída.
  const r = canConnect(pin(print, 'run', 'in'), pin(start, 'next'), language);
  assert.ok(r.ok);
  assert.equal(r.from.node, start);
  assert.equal(canConnect(pin(start, 'next'), pin(iff, 'true'), language).reason, 'saída não liga em saída');
  assert.equal(canConnect(pin(print, 'run', 'in'), pin(print, 'text', 'in'), language).reason, 'não liga no mesmo nó');
  assert.equal(canConnect(pin(start, 'next'), pin(print, 'text', 'in'), language).reason, 'fluxo não liga em dados');
  assert.ok(canConnect(pin(iff, 'true'), pin(print, 'run', 'in'), language).ok); // verdadeiro é fluxo
  assert.equal(canConnect(pin(iff, 'true'), pin(iff, 'condition', 'in'), language).reason, 'não liga no mesmo nó');
  const iff2 = add('if');
  assert.equal(canConnect(pin(iff, 'true'), pin(iff2, 'condition', 'in'), language).reason, 'fluxo não liga em condicional');
  assert.equal(canConnect(pin(sum, 'result'), pin(print, 'text', 'in'), language).reason, 'text não aceita float');
  assert.ok(canConnect(pin(sum, 'result'), pin(toText, 'value', 'in'), language).ok); // número → qualquer
  assert.ok(canConnect(pin(variable, 'value'), pin(sum, 'a', 'in'), language).ok); // qualquer → número
  assert.ok(canConnect(pin(toText, 'text'), pin(print, 'text', 'in'), language).ok);
  assert.equal(canConnect(pin(sum, 'result'), pin(variable, 'config', 'in'), language).reason, 'dados não liga em configuração');
});

test('ligar, já ligados, e limite substitui o fio mais antigo', () => {
  const { scene, add, pin } = setup();
  const a = add('add');
  const b = add('add');
  const print = add('to_text');
  assert.ok(scene.connect(pin(a, 'result'), pin(print, 'value', 'in')).ok);
  assert.equal(scene.connect(pin(a, 'result'), pin(print, 'value', 'in')).reason, 'já estão ligados');
  // Entrada de dados aceita 1: o fio de b substitui o de a.
  const r = scene.connect(pin(b, 'result'), pin(print, 'value', 'in'));
  assert.ok(r.ok);
  assert.equal(scene.wires.length, 1);
  assert.equal(scene.wires[0].from.node, b.id);
  // Saída de dados sem limite: a liga em dois lugares.
  const other = add('to_text');
  scene.connect(pin(a, 'result'), pin(other, 'value', 'in'));
  scene.connect(pin(a, 'result'), pin(b, 'a', 'in'));
  assert.equal(scene.wiresAt(a, a.outputs[0]).length, 2);
});

test('saída de fluxo aceita 1: ligar em outro lugar tira o fio antigo; entrada de fluxo aceita vários', () => {
  const { scene, add, pin } = setup();
  const s1 = add('start');
  const s2 = add('start');
  const p1 = add('print');
  const p2 = add('print');
  scene.connect(pin(s1, 'next'), pin(p1, 'run', 'in'));
  scene.connect(pin(s1, 'next'), pin(p2, 'run', 'in'));
  assert.equal(scene.wires.length, 1);
  assert.equal(scene.wires[0].to.node, p2.id);
  scene.connect(pin(s2, 'next'), pin(p2, 'run', 'in'));
  assert.equal(scene.wiresAt(p2, p2.inputs[0]).length, 2);
  assert.ok(scene.isConnected(p2, p2.inputs[0]));
  assert.ok(!scene.isConnected(p1, p1.inputs[0]));
});

test('apagar nó apaga os fios dele; apagar fio pelo id', () => {
  const { scene, add, pin } = setup();
  const s = add('start');
  const p = add('print');
  const t = add('to_text');
  scene.connect(pin(s, 'next'), pin(p, 'run', 'in'));
  const w = scene.connect(pin(t, 'text'), pin(p, 'text', 'in')).wire;
  scene.remove([w.id]);
  assert.equal(scene.wires.length, 1);
  scene.remove([p.id]);
  assert.equal(scene.wires.length, 0);
  assert.equal(scene.elements.length, 2);
});

test('reroute: entra no meio do fio, mantém tipos e limites; apagar refaz o fio', () => {
  const { scene, add, pin } = setup();
  const iff = add('if', 0, 0);
  const p = add('print', 400, 0);
  const w = scene.connect(pin(iff, 'true'), pin(p, 'run', 'in')).wire;
  const r = scene.addReroute(w, { x: 200, y: 50 });
  assert.ok(r.reroute);
  assert.deepEqual(pinAnchor(r, r.outputs[0]), { x: 200, y: 50 });
  assert.equal(r.inputs[0].kind, 'flow');
  assert.equal(r.outputs[0].kind, 'flow');
  assert.equal(scene.wires.length, 2);
  assert.ok(scene.wires.every((x) => x.id !== w.id));
  // Saída do reroute é fluxo: não liga em dados.
  const t = add('to_text');
  assert.ok(!canConnect(pin(r, 'out'), pin(t, 'value', 'in'), language).ok);
  scene.remove([r.id]);
  assert.equal(scene.wires.length, 1);
  assert.deepEqual([scene.wires[0].from.node, scene.wires[0].to.node], [iff.id, p.id]);
});

test('reroute de dados com várias saídas: apagar religa todas', () => {
  const { scene, add, pin } = setup();
  const sum = add('add', 0, 0);
  const t1 = add('to_text', 400, 0);
  const t2 = add('to_text', 400, 200);
  const w = scene.connect(pin(sum, 'result'), pin(t1, 'value', 'in')).wire;
  const r = scene.addReroute(w, { x: 200, y: 40 });
  scene.connect(pin(r, 'out'), pin(t2, 'value', 'in'));
  scene.remove([r.id]);
  assert.deepEqual(scene.wires.map((x) => [x.from.node, x.to.node]), [[sum.id, t1.id], [sum.id, t2.id]]);
});

test('apagar reroute junto com uma das pontas não religa', () => {
  const { scene, add, pin } = setup();
  const s = add('start');
  const p = add('print', 400, 0);
  const r = scene.addReroute(scene.connect(pin(s, 'next'), pin(p, 'run', 'in')).wire, { x: 200, y: 40 });
  scene.remove([r.id, p.id]);
  assert.equal(scene.wires.length, 0);
});

test('reroute: área de clique maior que o ponto; meio arrasta, bordas puxam fio', () => {
  const { scene, add, pin } = setup();
  const s = add('start');
  const p = add('print', 400, 0);
  const r = scene.addReroute(scene.connect(pin(s, 'next'), pin(p, 'run', 'in')).wire, { x: 200, y: 40 });
  const half = theme.reroute.hitSize / 2;
  assert.ok(theme.reroute.hitSize > theme.reroute.size);
  assert.equal(scene.hitTest({ x: 200 + half - 1, y: 40 }), r);
  assert.equal(scene.pinAt({ x: 200, y: 40 }, 9), null); // meio: arrasta
  assert.equal(scene.pinAt({ x: 200 + half, y: 40 }, 9)?.pin, r.outputs[0]);
  assert.equal(scene.pinAt({ x: 200 - half, y: 40 }, 9)?.pin, r.inputs[0]);
});

test('fio no ponto, trazer para frente e pino compatível', () => {
  const { scene, add, pin } = setup();
  const s = add('start', 0, 0);
  const p = add('print', 400, 0);
  scene.connect(pin(s, 'next'), pin(p, 'run', 'in'));
  const a = pinAnchor(s, s.outputs[0]);
  const b = pinAnchor(p, p.inputs[0]);
  assert.ok(distanceToCurve({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, a, b) < 1);
  assert.ok(scene.wireAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 5));
  assert.equal(scene.wireAt({ x: (a.x + b.x) / 2, y: a.y + 60 }, 5), null);
  scene.bringToFront(s);
  assert.equal(scene.elements.at(-1), s);
  const t = add('to_text');
  assert.equal(firstCompatiblePin(t, pin(s, 'next'), language), null);
  assert.equal(firstCompatiblePin(p, pin(s, 'next'), language), p.inputs[0]);
  assert.equal(firstCompatiblePin(p, pin(t, 'text'), language), p.inputs[1]);
});

test('condicional é valor lógico: Maior que → E → condição do Se', () => {
  const { scene, add, pin } = setup();
  const g1 = add('greater');
  const g2 = add('greater');
  const and = add('and');
  const iff = add('if');
  const print = add('print');
  assert.ok(scene.connect(pin(g1, 'result'), pin(and, 'a', 'in')).ok);
  assert.ok(scene.connect(pin(g2, 'result'), pin(and, 'b', 'in')).ok);
  assert.ok(scene.connect(pin(and, 'result'), pin(iff, 'condition', 'in')).ok);
  // Saída condicional sem limite: a mesma comparação alimenta duas condições.
  const iff2 = add('if');
  assert.ok(scene.connect(pin(g1, 'result'), pin(iff2, 'condition', 'in')).ok);
  assert.equal(scene.wiresAt(g1, g1.outputs[0]).length, 2);
  // Entrada condicional aceita 1: outra comparação substitui.
  scene.connect(pin(g2, 'result'), pin(iff, 'condition', 'in'));
  assert.equal(scene.wiresAt(iff, iff.inputs[1]).length, 1);
  assert.equal(scene.wiresAt(iff, iff.inputs[1])[0].from.node, g2.id);
  assert.equal(canConnect(pin(g1, 'result'), pin(print, 'text', 'in'), language).reason, 'text não aceita condicional'); // só em bool
  assert.equal(canConnect(pin(g1, 'result'), pin(print, 'run', 'in'), language).reason, 'condicional não liga em fluxo');
});

test('reroute vira de lado quando o destino fica à esquerda da origem', () => {
  const { scene, add, pin } = setup();
  const s = add('start', 0, 0);
  const p = add('print', 400, 0);
  const r = scene.addReroute(scene.connect(pin(s, 'next'), pin(p, 'run', 'in')).wire, { x: 200, y: 40 });
  scene.refreshReroutes();
  assert.equal(r.flipped, false);
  assert.equal(pinDirection(r, r.outputs[0]), 1);
  // Destino passa para a esquerda da origem: o reroute vira.
  p.x = -400;
  scene.refreshReroutes();
  assert.equal(r.flipped, true);
  assert.equal(pinDirection(r, r.outputs[0]), -1);
  assert.equal(pinDirection(r, r.inputs[0]), 1);
  // Bordas trocam: a saída (puxar fio) fica à esquerda.
  const half = theme.reroute.hitSize / 2;
  assert.equal(scene.pinAt({ x: 200 - half, y: 40 }, 9)?.pin, r.outputs[0]);
  assert.equal(scene.pinAt({ x: 200 + half, y: 40 }, 9)?.pin, r.inputs[0]);
  // A curva sai do reroute para a esquerda (controle à esquerda do ponto).
  const [, c1] = controlPoints({ x: 200, y: 40 }, { x: -300, y: 40 }, pinDirection(r, r.outputs[0]), -1);
  assert.ok(c1.x < 200);
});

test('reroute sem fio de um lado compara com ele mesmo', () => {
  const { scene, add, pin } = setup();
  const s = add('start', 0, 0);
  const p = add('print', 400, 0);
  const r = scene.addReroute(scene.connect(pin(s, 'next'), pin(p, 'run', 'in')).wire, { x: 200, y: 40 });
  scene.remove([p.id]);
  scene.refreshReroutes();
  assert.equal(r.flipped, false); // origem à esquerda
  s.x = 600;
  scene.refreshReroutes();
  assert.equal(r.flipped, true); // origem à direita
});
