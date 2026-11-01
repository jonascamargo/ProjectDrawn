import { distanceToCurve } from './canvas/curve.js';
import { createNode, pinAnchor, pinAt, pinDirection, setRerouteFlipped } from './node.js';
import { canConnect, rerouteDef } from './wires.js';

// Elementos do canvas: nós e fios. Cada nó pertence a um escopo
// (por enquanto só 'root'; na etapa 2 as áreas viram escopos).
// Fio: { id, from: { node, pin }, to: { node, pin } } com ids (from = lado da saída).
// Nós e fios usam a mesma numeração de id, então a seleção guarda os dois sem confusão.
export const ROOT = 'root';

export class Scene {
  // layout(node): calcula tamanho e posição dos pinos (quem sabe medir texto é o desenho).
  // language: regras de tipo de dado (canAssign) e nomes dos tipos.
  constructor({ layout = () => {}, language = {} } = {}) {
    this.elements = [];
    this.wires = [];
    this.nextId = 1;
    this.layout = layout;
    this.language = language;
  }

  addNode(def, { x, y, scope = ROOT }) {
    const node = createNode(def, { id: this.nextId++, x, y, scope });
    this.layout(node);
    this.elements.push(node);
    return node;
  }

  byId(id) {
    return this.elements.find((el) => el.id === id);
  }

  wireById(id) {
    return this.wires.find((w) => w.id === id);
  }

  // Pontas do fio com os objetos: { from: { node, pin }, to: { node, pin } }.
  ends(wire) {
    const find = (ref, pins) => {
      const node = this.byId(ref.node);
      return { node, pin: node[pins].find((p) => p.id === ref.pin) };
    };
    return { from: find(wire.from, 'outputs'), to: find(wire.to, 'inputs') };
  }

  wiresAt(node, pin) {
    const side = pin.direction === 'out' ? 'from' : 'to';
    return this.wires.filter((w) => w[side].node === node.id && w[side].pin === pin.id);
  }

  isConnected(node, pin) {
    return this.wiresAt(node, pin).length > 0;
  }

  // Liga dois pinos (em qualquer ordem). Pino no limite: o fio mais antigo sai para o novo entrar.
  connect(a, b) {
    const check = canConnect(a, b, this.language);
    if (!check.ok) return check;
    const { from, to } = check;
    const ref = (end) => ({ node: end.node.id, pin: end.pin.id });
    const same = this.wiresAt(from.node, from.pin).some((w) => w.to.node === to.node.id && w.to.pin === to.pin.id);
    if (same) return { ok: false, reason: 'já estão ligados' };
    for (const end of [from, to]) {
      const existing = this.wiresAt(end.node, end.pin);
      if (end.pin.max != null && existing.length >= end.pin.max) {
        this.disconnect(existing.slice(0, existing.length - end.pin.max + 1).map((w) => w.id));
      }
    }
    const wire = { id: this.nextId++, from: ref(from), to: ref(to) };
    this.wires.push(wire);
    return { ok: true, wire };
  }

  disconnect(ids) {
    const gone = new Set(ids);
    this.wires = this.wires.filter((w) => !gone.has(w.id));
  }

  // Apaga nós e fios pelos ids. Os fios dos nós apagados saem junto; um reroute apagado
  // refaz o fio, ligando direto as pontas de antes e de depois dele.
  remove(ids) {
    const gone = new Set(ids);
    const relinks = [];
    for (const node of this.elements.filter((el) => gone.has(el.id) && el.reroute)) {
      const before = this.wiresAt(node, node.inputs[0]).filter((w) => !gone.has(w.id)).map((w) => this.ends(w).from);
      const after = this.wiresAt(node, node.outputs[0]).filter((w) => !gone.has(w.id)).map((w) => this.ends(w).to);
      for (const a of before) for (const b of after) relinks.push([a, b]);
    }
    this.elements = this.elements.filter((el) => !gone.has(el.id));
    this.wires = this.wires.filter((w) => !gone.has(w.id) && !gone.has(w.from.node) && !gone.has(w.to.node));
    for (const [a, b] of relinks) {
      if (!gone.has(a.node.id) && !gone.has(b.node.id)) this.connect(a, b);
    }
  }

  // Leva o nó para cima de todos (desenhado por último, clicado primeiro).
  bringToFront(node) {
    const i = this.elements.indexOf(node);
    if (i >= 0 && i < this.elements.length - 1) {
      this.elements.splice(i, 1);
      this.elements.push(node);
    }
  }

  inScope(scope) {
    return this.elements.filter((el) => el.scope === scope);
  }

  // Elemento mais acima no ponto (o último desenhado ganha).
  hitTest(p) {
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (p.x >= el.x && p.x <= el.x + el.w && p.y >= el.y && p.y <= el.y + el.h) return el;
    }
    return null;
  }

  // Vira cada reroute para o lado do fluxo, como na Unreal: se o que vem depois dele está à
  // esquerda do que vem antes, ele vira (sem fio de um lado, compara com o próprio reroute).
  refreshReroutes() {
    for (const node of this.elements) {
      if (!node.reroute) continue;
      const center = node.x + node.w / 2;
      const average = (ends) => (ends.length ? ends.reduce((sum, e) => sum + pinAnchor(e.node, e.pin).x, 0) / ends.length : center);
      const before = average(this.wiresAt(node, node.inputs[0]).map((w) => this.ends(w).from));
      const after = average(this.wiresAt(node, node.outputs[0]).map((w) => this.ends(w).to));
      setRerouteFlipped(node, after < before);
    }
  }

  // Pino perto do ponto, no nó mais acima: { node, pin } ou null.
  pinAt(p, radius) {
    this.refreshReroutes();
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const pin = pinAt(this.elements[i], p, radius);
      if (pin) return { node: this.elements[i], pin };
    }
    return null;
  }

  // Fio perto do ponto (dentro da tolerância), o mais recente primeiro.
  wireAt(p, tolerance) {
    this.refreshReroutes();
    for (let i = this.wires.length - 1; i >= 0; i--) {
      const { from, to } = this.ends(this.wires[i]);
      const a = pinAnchor(from.node, from.pin);
      const b = pinAnchor(to.node, to.pin);
      if (distanceToCurve(p, a, b, pinDirection(from.node, from.pin), pinDirection(to.node, to.pin)) <= tolerance) return this.wires[i];
    }
    return null;
  }

  // Põe um reroute no fio, centrado no ponto: origem → reroute → destino.
  addReroute(wire, point) {
    const { from, to } = this.ends(wire);
    const node = this.addNode(rerouteDef(from.pin, to.pin), { x: point.x, y: point.y, scope: from.node.scope });
    node.x = point.x - node.w / 2;
    node.y = point.y - node.h / 2;
    this.disconnect([wire.id]);
    this.connect(from, { node, pin: node.inputs[0] });
    this.connect({ node, pin: node.outputs[0] }, to);
    return node;
  }

  // Escopo do ponto: onde uma seleção por retângulo começa.
  scopeAt() {
    return ROOT;
  }

  bounds(elements = this.elements) {
    if (!elements.length) return null;
    const x = Math.min(...elements.map((el) => el.x));
    const y = Math.min(...elements.map((el) => el.y));
    const right = Math.max(...elements.map((el) => el.x + el.w));
    const bottom = Math.max(...elements.map((el) => el.y + el.h));
    return { x, y, w: right - x, h: bottom - y };
  }
}
