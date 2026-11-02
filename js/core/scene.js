import { distanceToCurve } from './canvas/curve.js';
import {
  accepts, activeInferences, applyFields, canSplit, containsDef, createNode, partsOf, pinAnchor, pinAt, pinDirection, pinScope,
  recombinePin, setRerouteFlipped, splitPin,
} from './node.js';
import { t } from './i18n.js';
import { coerceValue, defaultValue, editorOf } from './values.js';
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
    this.fitExclude = new Set(); // nós ignorados no tamanho das áreas (saindo com Ctrl durante o arraste)
  }

  addNode(def, { x, y, scope = ROOT, id = this.nextId++, values, open, ref, inputValues }) {
    this.nextId = Math.max(this.nextId, id + 1);
    const node = createNode(def, { id, x, y, scope, values, open, ref, inputValues });
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
    // Pinos opcionais deste campo (when) que somem levam os fios junto.
    if (!value) {
      const hidden = [...node.inputs, ...node.outputs].filter((p) => p.when === fieldId);
      this.disconnect(hidden.flatMap((p) => this.wiresAt(node, p)).map((w) => w.id));
    }
    applyFields(node);
    if (field.infer) this.dropBrokenWires(node); // desligar a inferência fecha a entrada no tipo
    this.fixSplits(node);
    this.normalizeValues(node);
    this.layout(node);
    this.refreshInference();
    this.syncReferences();
  }

  // ---------------------------------------------------------------- valores digitados nos pinos

  typeDef(pin) {
    return this.language.types?.[pin.type];
  }

  // Valor do pino de entrada (o digitado, ou o padrão do tipo). Componente de pino aberto: a parte
  // dele no valor do pino de origem.
  inputValue(node, pin) {
    if (pin.parent != null) {
      const parent = node.inputs.find((p) => p.id === pin.parent);
      return this.inputValue(node, parent)[pin.index];
    }
    return node.inputValues[pin.id] ?? defaultValue(this.typeDef(pin));
  }

  // Valor digitado (pelo inspetor): convertido para o tipo do pino (int só inteiro, etc.).
  // Componente de pino aberto muda só a parte dele no valor do pino de origem.
  setInputValue(node, pinId, raw) {
    const pin = node.inputs.find((p) => p.id === pinId);
    if (!pin || !editorOf(this.typeDef(pin))) return;
    if (pin.parent != null) {
      const parent = node.inputs.find((p) => p.id === pin.parent);
      const whole = [...this.inputValue(node, parent)];
      whole[pin.index] = coerceValue(this.typeDef(pin), raw);
      node.inputValues[parent.id] = coerceValue(this.typeDef(parent), whole);
    } else {
      node.inputValues[pinId] = coerceValue(this.typeDef(pin), raw);
    }
    this.layout(node);
  }

  // ---------------------------------------------------------------- pinos abertos (componentes)

  canSplit(node, pin) {
    return canSplit(pin, this.typeDef(pin));
  }

  // Abre o pino (ex.: Vector3 → x, y, z). Os fios do pino inteiro saem.
  splitPin(node, pin) {
    if (!this.canSplit(node, pin)) return;
    this.disconnect(this.wiresAt(node, pin).map((w) => w.id));
    splitPin(node, pin, this.typeDef(pin));
    this.layout(node);
  }

  // Fecha o pino aberto. Os fios dos componentes saem; os valores digitados já estão no pino inteiro.
  recombinePin(node, pin) {
    if (!pin.split) return;
    this.disconnect(partsOf(node, pin).flatMap((p) => this.wiresAt(node, p)).map((w) => w.id));
    recombinePin(node, pin);
    this.layout(node);
  }

  // Depois de mudar o tipo: pino aberto cujo tipo não tem mais esses componentes é fechado.
  fixSplits(node) {
    for (const pin of [...node.inputs, ...node.outputs]) {
      if (!pin.split) continue;
      const type = this.typeDef(pin);
      if (type?.components?.length !== partsOf(node, pin).length) this.recombinePin(node, pin);
    }
  }

  // Depois de mudar o tipo dos pinos: valores convertidos para o tipo novo (sem editor, somem).
  normalizeValues(node) {
    for (const pin of node.inputs) {
      if (!(pin.id in node.inputValues)) continue;
      if (editorOf(this.typeDef(pin))) node.inputValues[pin.id] = coerceValue(this.typeDef(pin), node.inputValues[pin.id]);
      else delete node.inputValues[pin.id];
    }
  }

  // Fio que chega no pino de entrada (o valor vem dele), ou null.
  incoming(node, pin) {
    const wire = this.wiresAt(node, pin)[0];
    return wire ? { wire, ...this.ends(wire).from } : null;
  }

  // ---------------------------------------------------------------- referências (get/set)

  // Cria uma referência ('get' ou 'set') ao nó, ao lado dele e na mesma área.
  addReference(target, kind) {
    const def = target.references && this.language.node?.(target.references[kind]);
    if (!def) return null;
    const node = this.addNode(def, { x: target.x + target.w + 30, y: target.y, scope: target.scope, ref: target.id });
    this.syncReference(node);
    return node;
  }

  // Referências que apontam para o nó.
  referencesTo(target) {
    return this.elements.filter((n) => n.ref === target.id);
  }

  // A referência copia o nome e o tipo do alvo. Sem alvo (apagado), fica quebrada; fora do alcance
  // do alvo (pela posição atual dos dois, não por onde foram criados), fica marcada também.
  syncReference(node) {
    const target = this.byId(node.ref);
    node.broken = !target;
    node.outOfReach = !!target && !this.inReach(target, node.scope);
    if (target) {
      const type = target.outputs.find((p) => p.id === target.references?.pin)?.type ?? null;
      node.title = node.reference === 'set' ? `set ${target.title}` : target.title;
      for (const pin of [...node.inputs, ...node.outputs]) if (pin.kind === 'data' && pin.parent == null) pin.type = type;
      if (node.tag) node.tag = type;
    }
    this.fixSplits(node);
    this.normalizeValues(node);
    this.layout(node);
    this.dropBrokenWires(node);
  }

  syncReferences() {
    for (const node of this.elements) if (node.ref != null) this.syncReference(node);
  }

  // Liga a referência a outro alvo (ex.: depois que o alvo dela foi apagado).
  relink(node, target) {
    node.ref = target.id;
    this.syncReference(node);
  }

  // Alvos possíveis para religar a referência: nós que geram esse tipo de referência e têm o
  // lugar dela ao alcance.
  relinkCandidates(node) {
    return this.elements.filter((n) => n.references?.[node.reference] === node.type && this.inReach(n, node.scope));
  }

  // O escopo está ao alcance do alvo? (a área dele ou uma área de dentro dela)
  inReach(target, scope) {
    if (scope === target.scope) return true;
    return scope !== ROOT && this.ancestors(this.byId(scope)).some((a) => a.id === target.scope);
  }

  // Nós ligados ao selecionado por referência: a variável e todas as referências dela.
  relatedTo(node) {
    const target = node.ref != null ? this.byId(node.ref) : node.references ? node : null;
    if (!target) return [];
    return [target, ...this.referencesTo(target)].filter((n) => n !== node);
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
            this.fixSplits(node);
            this.normalizeValues(node);
            this.layout(node);
            this.dropBrokenWires(node);
            for (const ref of this.referencesTo(node)) this.syncReference(ref);
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
    this.syncReferences(); // referências a nós apagados ficam quebradas
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
  // A raiz segue language.rootContains (sem a lista, aceita tudo).
  accepts(scope, def) {
    if (scope === ROOT) return this.language.rootContains ? containsDef(this.language.rootContains, def) : true;
    return accepts(this.byId(scope), def);
  }

  // Definição de onde o nó veio (para regras de soltar).
  defOf(node) {
    if (node.reroute) return { id: 'reroute', reroute: true };
    return this.language.node?.(node.type) ?? { id: node.type, area: node.area };
  }

  // Script em volta do nó (ele mesmo, se for um): a área de script mais próxima, ou null.
  scriptOf(node) {
    for (let n = node; n; n = this.byId(n.scope)) if (n.script) return n;
    return null;
  }

  // Tipo de um script (ex.: extensão do arquivo), pela linguagem.
  scriptType(script) {
    return script ? this.language.scriptType?.(script) ?? null : null;
  }

  // Caminho de pasta/arquivo a partir da pasta mais de fora: 'res' vira 'res://'.
  pathOf(node) {
    const names = [...this.ancestors(node).reverse(), node].map((n) => n.title);
    if (names[0] === 'res') names.shift();
    return `res://${names.join('/')}`;
  }

  // Pode soltar estes nós (os de cima de cada grupo arrastado) no escopo de destino?
  // Resposta: { ok, mode: 'move' | 'path', reason }. 'path': pasta/arquivo solto num script vira
  // um nó de caminho (o original volta ao lugar). Nó de script só vai para script do mesmo tipo e
  // só existe dentro de um script.
  canDrop(items, scope) {
    const target = scope === ROOT ? null : this.byId(scope);
    const targetScript = target ? this.scriptOf(target) : null;
    const name = (n) => n?.title || n?.type;
    let mode = 'move';
    for (const item of items) {
      if (target && (target === item || this.ancestors(target).includes(item))) {
        return { ok: false, reason: t('drop.intoItself', { item: name(item) }) };
      }
      const def = this.defOf(item);
      if (def.reroute) continue; // reroute acompanha os fios que passam por ele
      const outerScript = item.scope === ROOT ? null : this.scriptOf(this.byId(item.scope));
      if (item.pathable && targetScript && !outerScript) {
        mode = 'path';
        continue;
      }
      const itemScript = item.script ? null : this.scriptOf(item);
      const scriptNode = !def.area || !!itemScript; // nó comum, ou área dentro de um script (classe, função)
      if (scriptNode && !def.reroute && !targetScript && !item.script) {
        return { ok: false, reason: t('drop.noScript', { item: name(item) }) };
      }
      if (itemScript && targetScript && this.scriptType(itemScript) !== this.scriptType(targetScript)) {
        return { ok: false, reason: t('drop.scriptType', { item: name(item), type: this.scriptType(itemScript) }) };
      }
      if (!this.accepts(scope, def)) {
        return { ok: false, reason: t('drop.notAccepted', { area: target ? name(target) : t('drop.canvas'), item: name(item) }) };
      }
    }
    if (mode === 'path' && items.length > 1) return { ok: false, reason: t('drop.pathOne') };
    return { ok: true, mode, reason: mode === 'path' ? t('drop.path', { path: this.pathOf(items[0]) }) : '' };
  }

  // Área fechada visível no ponto (a de cima), sem contar as de `exclude`: soltar nela coloca dentro.
  closedAreaAt(p, exclude = new Set()) {
    this.refreshLayout();
    const inside = (el) => p.x >= el.x && p.x <= el.x + el.w && p.y >= el.y && p.y <= el.y + el.h;
    return this.pickOrder().find((el) => el.area && !el.open && !exclude.has(el) && inside(el)) ?? null;
  }

  // Muda os nós (com o que têm dentro) para o escopo de destino. Fios que passariam a cruzar
  // áreas (de um nó que mudou para um que ficou) saem. Numa área fechada, o grupo vai para o começo
  // do conteúdo dela (logo abaixo do cabeçalho), e aparece lá quando ela abrir.
  moveInto(items, scope) {
    const target = scope === ROOT ? null : this.byId(scope);
    if (target?.area && !target.open) {
      const group = items.flatMap((item) => [item, ...(item.area ? this.descendants(item) : [])]);
      const box = this.bounds(group);
      const dx = target.x - box.x;
      const dy = target.y + target.layout.headerH + this.areaPad - box.y;
      for (const n of group) {
        n.x += dx;
        n.y += dy;
      }
    }
    for (const item of items) item.scope = scope;
    for (const item of items) {
      for (const node of [item, ...(item.area ? this.descendants(item) : [])]) this.dropBrokenWires(node);
    }
    this.syncReferences(); // alcance das referências muda com quem mudou de lugar
    this.fitAreas();
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
      const box = this.bounds(this.inScope(area.id).filter((n) => !this.fitExclude.has(n)));
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
  // É onde uma seleção por retângulo começa, onde o menu cria o nó e onde o arraste solta.
  // exclude: nós que não contam (os que estão sendo arrastados, com o que têm dentro).
  scopeAt(p, exclude = new Set()) {
    if (!p) return ROOT;
    this.refreshLayout();
    const inside = (el) => p.x >= el.x && p.x <= el.x + el.w && p.y >= el.y && p.y <= el.y + el.h;
    let scope = ROOT;
    for (let found = true; found;) {
      found = false;
      const kids = this.inScope(scope);
      for (let i = kids.length - 1; i >= 0; i--) {
        const el = kids[i];
        if (el.area && el.open && !exclude.has(el) && inside(el)) {
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
