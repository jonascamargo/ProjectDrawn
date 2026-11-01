import { distanceToCurve } from './canvas/curve.js';
import { accepts, activeInferences, applyFields, createNode, pinAnchor, pinAt, pinDirection, pinScope, setRerouteFlipped } from './node.js';
import { t } from './i18n.js';
import { canConnect, rerouteDef } from './wires.js';

// Elementos do canvas: nós e fios. Cada nó pertence a um escopo: 'root' ou o id da área onde está.
// Áreas (pasta, arquivo, classe, função) contêm nós e outras áreas; fechada, o conteúdo some.
// Fio: { id, from: { node, pin }, to: { node, pin } } com ids (from = lado da saída).
// Nós e fios usam a mesma numeração de id, então a seleção guarda os dois sem confusão.
export const ROOT = 'root';

export class Scene {
  // layout(node): calcula tamanho e posição dos pinos (quem sabe medir texto é o desenho).
  // language: regras de tipo de dado (canAssign) e nomes dos tipos.
  // areaPad: margem entre a borda da área aberta e o conteúdo (e o cabeçalho).
  constructor({ layout = () => {}, language = {}, areaPad = 14 } = {}) {
    this.elements = [];
    this.wires = [];
    this.nextId = 1;
    this.layout = layout;
    this.language = language;
    this.areaPad = areaPad;
  }

  addNode(def, { x, y, scope = ROOT, id = this.nextId++, values, open }) {
    this.nextId = Math.max(this.nextId, id + 1);
    const node = createNode(def, { id, x, y, scope, values, open });
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
    if (same) return { ok: false, reason: t('wire.alreadyLinked') };
    for (const end of [from, to]) {
      const existing = this.wiresAt(end.node, end.pin);
      if (end.pin.max != null && existing.length >= end.pin.max) {
        this.disconnect(existing.slice(0, existing.length - end.pin.max + 1).map((w) => w.id));
      }
    }
    const wire = { id: this.nextId++, from: ref(from), to: ref(to) };
    this.wires.push(wire);
    this.refreshInference();
    return { ok: true, wire };
  }

  disconnect(ids) {
    const gone = new Set(ids);
    this.wires = this.wires.filter((w) => !gone.has(w.id));
    this.refreshInference();
  }

  // Todos os fios que tocam o nó.
  wiresOf(node) {
    return this.wires.filter((w) => w.from.node === node.id || w.to.node === node.id);
  }

  // Muda um campo do nó pelo inspetor. Trocar o tipo desconecta todos os fios do nó.
  setField(node, fieldId, value) {
    const field = node.fields.find((f) => f.id === fieldId);
    if (!field || node.values[fieldId] === value) return;
    node.values[fieldId] = value;
    if (field.sets === 'type') this.disconnect(this.wiresOf(node).map((w) => w.id));
    applyFields(node);
    if (field.infer) this.dropBrokenWires(node); // desligar a inferência fecha a entrada no tipo
    this.layout(node);
    this.refreshInference();
  }

  // Tira os fios do nó que deixaram de passar nas regras de ligação.
  dropBrokenWires(node) {
    const broken = new Set(this.wiresOf(node).filter((w) => {
      const { from, to } = this.ends(w);
      return !canConnect(from, to, this.language).ok;
    }));
    if (broken.size) this.wires = this.wires.filter((w) => !broken.has(w));
  }

  // Inferência de tipo (ex.: "Infer type" marcado): o campo recebe o tipo do que está ligado na
  // entrada. Se o tipo muda, saem só os fios que deixaram de servir (o que deu o tipo continua).
  refreshInference() {
    if (this.inferring) return;
    this.inferring = true;
    try {
      for (let round = 0, changed = true; changed && round < 10; round++) {
        changed = false;
        for (const node of this.elements) {
          for (const { field, from } of activeInferences(node)) {
            const pin = node.inputs.find((p) => p.id === from);
            const wire = pin && this.wiresAt(node, pin)[0];
            const type = (wire && this.ends(wire).from.pin.type) || node.fields.find((f) => f.id === field).default;
            if (node.values[field] === type) continue;
            node.values[field] = type;
            applyFields(node);
            this.layout(node);
            this.dropBrokenWires(node);
            changed = true;
          }
        }
      }
    } finally {
      this.inferring = false;
    }
  }

  // Apaga nós e fios pelos ids. Área apagada leva tudo o que está dentro. Os fios dos nós apagados
  // saem junto; um reroute apagado refaz o fio, ligando direto as pontas de antes e de depois dele.
  remove(ids) {
    const gone = new Set(ids);
    for (const id of ids) {
      const node = this.byId(id);
      if (node?.area) for (const d of this.descendants(node)) gone.add(d.id);
    }
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
    this.refreshInference();
  }

  // Leva o nó para cima de todos (desenhado por último, clicado primeiro), junto com as áreas
  // onde ele está: clicar em algo dentro de uma área traz a área inteira para a frente.
  bringToFront(node) {
    for (const el of [...this.ancestors(node).reverse(), node]) {
      const i = this.elements.indexOf(el);
      if (i >= 0 && i < this.elements.length - 1) {
        this.elements.splice(i, 1);
        this.elements.push(el);
      }
    }
  }

  inScope(scope) {
    return this.elements.filter((el) => el.scope === scope);
  }

  // Áreas onde o nó está, da mais próxima para a de fora.
  ancestors(node) {
    const out = [];
    for (let p = this.byId(node.scope); p; p = this.byId(p.scope)) out.push(p);
    return out;
  }

  // Tudo o que está dentro da área, em qualquer nível.
  descendants(area) {
    const out = [];
    for (const child of this.inScope(area.id)) {
      out.push(child);
      if (child.area) out.push(...this.descendants(child));
    }
    return out;
  }

  // Visível: nenhuma área em volta está fechada.
  isVisible(node) {
    return this.ancestors(node).every((a) => a.open);
  }

  // A área (ou a raiz, com scope 'root') aceita esta definição dentro dela?
  accepts(scope, def) {
    return accepts(scope === ROOT ? null : this.byId(scope), def);
  }

  // Abre ou fecha a área (o tamanho fechado é o do cabeçalho; aberta, o do conteúdo).
  // O cabeçalho fica parado no lugar: aberta, ele está a areaPad da borda da moldura.
  toggleArea(area) {
    area.open = !area.open;
    const shift = area.open ? -this.areaPad : this.areaPad;
    area.x += shift;
    area.y += shift;
    this.layout(area);
    this.fitAreas();
  }

  // Tamanho das áreas abertas pelo conteúdo, das de dentro para as de fora: cobre os filhos mais a
  // margem; se um filho passa da borda esquerda/de cima, a área anda até ele (o cabeçalho continua
  // no canto); o puxador (manual) só deixa maior. Fechada, o tamanho é o do cabeçalho.
  fitAreas() {
    const pad = this.areaPad;
    const depth = (n) => this.ancestors(n).length;
    const areas = this.elements.filter((n) => n.area && n.open && this.isVisible(n)).sort((a, b) => depth(b) - depth(a));
    for (const area of areas) {
      const minW = area.layout.headerW + pad * 2;
      const minH = area.layout.headerH + pad * 2;
      const box = this.bounds(this.inScope(area.id));
      if (box) {
        area.x = Math.min(area.x, box.x - pad);
        area.y = Math.min(area.y, box.y - pad);
      }
      const contentW = box ? box.x + box.w + pad - area.x : 0;
      const contentH = box ? box.y + box.h + pad - area.y : 0;
      area.w = Math.max(minW, contentW, area.manual.w);
      area.h = Math.max(minH, contentH, area.manual.h);
    }
  }

  // Antes de desenhar ou procurar algo no ponto: tamanho das áreas e lado dos reroutes.
  refreshLayout() {
    this.fitAreas();
    this.refreshReroutes();
  }

  // Ordem de procura no ponto (de cima para baixo): uma área aberta vem antes do que tem dentro
  // (o cabeçalho fica por cima), e o conteúdo antes do resto da área.
  pickOrder(scope = ROOT) {
    const out = [];
    for (const el of this.inScope(scope)) {
      if (el.area && el.open) out.push(...this.pickOrder(el.id));
      out.push(el);
    }
    return scope === ROOT ? out.reverse() : out;
  }

  // Elemento mais acima no ponto. Numa área aberta: o cabeçalho, depois o conteúdo, depois o corpo.
  hitTest(p) {
    this.refreshLayout();
    const inside = (el) => p.x >= el.x && p.x <= el.x + el.w && p.y >= el.y && p.y <= el.y + el.h;
    const visit = (scope) => {
      const kids = this.inScope(scope);
      for (let i = kids.length - 1; i >= 0; i--) {
        const el = kids[i];
        if (!inside(el)) continue;
        if (el.area && el.open) {
          if (this.areaPart(el, p) === 'header' || this.areaPart(el, p) === 'toggle') return el;
          return visit(el.id) ?? el;
        }
        return el;
      }
      return null;
    };
    return visit(ROOT);
  }

  // Parte da área no ponto: 'toggle' (⇕), 'header', 'handle' (puxador, aberta) ou 'body'.
  areaPart(area, p) {
    const l = area.layout;
    const hx = area.x + l.headerX;
    const hy = area.y + l.headerTop;
    if (p.y >= hy && p.y <= hy + l.headerH && p.x >= hx && p.x <= hx + l.headerW) {
      return p.x >= hx + l.toggleX - 6 && p.x <= hx + l.toggleX + l.toggleW + 6 ? 'toggle' : 'header';
    }
    if (!area.open) return 'header';
    const handle = this.areaPad;
    if (p.x >= area.x + area.w - handle && p.y >= area.y + area.h - handle) return 'handle';
    return 'body';
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

  // Pino perto do ponto, no nó visível mais acima: { node, pin } ou null.
  pinAt(p, radius) {
    this.refreshLayout();
    for (const node of this.pickOrder()) {
      const pin = pinAt(node, p, radius);
      if (pin) return { node, pin };
    }
    return null;
  }

  // Fio visível perto do ponto (dentro da tolerância), o mais recente primeiro.
  wireAt(p, tolerance) {
    this.refreshLayout();
    for (let i = this.wires.length - 1; i >= 0; i--) {
      const { from, to } = this.ends(this.wires[i]);
      if (!this.isVisible(from.node) || !this.isVisible(to.node)) continue;
      const a = pinAnchor(from.node, from.pin);
      const b = pinAnchor(to.node, to.pin);
      if (distanceToCurve(p, a, b, pinDirection(from.node, from.pin), pinDirection(to.node, to.pin)) <= tolerance) return this.wires[i];
    }
    return null;
  }

  // Põe um reroute no fio, centrado no ponto: origem → reroute → destino.
  addReroute(wire, point) {
    const { from, to } = this.ends(wire);
    const node = this.addNode(rerouteDef(from.pin, to.pin), { x: point.x, y: point.y, scope: pinScope(from.node) });
    node.x = point.x - node.w / 2;
    node.y = point.y - node.h / 2;
    this.disconnect([wire.id]);
    this.connect(from, { node, pin: node.inputs[0] });
    this.connect({ node, pin: node.outputs[0] }, to);
    return node;
  }

  // Escopo do ponto: a área aberta mais de dentro cujo corpo contém o ponto, ou a raiz.
  // É onde uma seleção por retângulo começa e onde o menu cria o nó.
  scopeAt(p) {
    if (!p) return ROOT;
    this.refreshLayout();
    const inside = (el) => p.x >= el.x && p.x <= el.x + el.w && p.y >= el.y && p.y <= el.y + el.h;
    let scope = ROOT;
    for (let found = true; found;) {
      found = false;
      const kids = this.inScope(scope);
      for (let i = kids.length - 1; i >= 0; i--) {
        const el = kids[i];
        if (el.area && el.open && inside(el)) {
          scope = el.id;
          found = true;
          break;
        }
      }
    }
    return scope;
  }

  // Retângulo que cobre os elementos (padrão: os da raiz; as áreas já cobrem o que têm dentro).
  bounds(elements = this.inScope(ROOT)) {
    if (!elements.length) return null;
    const x = Math.min(...elements.map((el) => el.x));
    const y = Math.min(...elements.map((el) => el.y));
    const right = Math.max(...elements.map((el) => el.x + el.w));
    const bottom = Math.max(...elements.map((el) => el.y + el.h));
    return { x, y, w: right - x, h: bottom - y };
  }
}
