import { distanceToCurve } from './canvas/curve.js';
import { rootContains } from './concepts/index.js';
import {
  activeInferences, applyFields, canSplit, containsDef, createNode, partsOf, pinAnchor, pinAt, pinDirection, pinScope,
  recombinePin, setRerouteFlipped, splitPin,
} from './node.js';
import { t } from './i18n.js';
import { Languages } from './languages.js';
import { createPin } from './pin.js';
import { coerceValue, defaultValue, editorOf } from './values.js';
import { canConnect, rerouteDef } from './wires.js';

// Elementos do canvas: nós e fios. Cada nó pertence a um escopo: 'root' ou o id da área onde está.
// Áreas (pasta, arquivo, classe, função) contêm nós e outras áreas; fechada, o conteúdo some.
// Fio: { id, from: { node, pin }, to: { node, pin } } com ids (from = lado da saída).
// Nós e fios usam a mesma numeração de id, então a seleção guarda os dois sem confusão.
export const ROOT = 'root';

export class Scene {
  // layout(node): calcula tamanho e posição dos pinos (quem sabe medir texto é o desenho).
  // languages: as linguagens registradas (tipos de dado, nós e regras de cada uma; ver languages.js).
  // areaPad: margem entre a borda da área aberta e o conteúdo (e o cabeçalho).
  constructor({ layout = () => {}, languages = new Languages(), areaPad = 14 } = {}) {
    this.elements = [];
    this.wires = [];
    this.nextId = 1;
    this.layout = layout;
    this.languages = languages;
    this.areaPad = areaPad;
    this.fitExclude = new Set(); // nós ignorados no tamanho das áreas (saindo com Ctrl durante o arraste)
  }

  addNode(def, { x, y, scope = ROOT, id = this.nextId++, values, open, ref, refKey, inputValues }) {
    this.nextId = Math.max(this.nextId, id + 1);
    const node = createNode(def, { id, x, y, scope, values, open, ref, refKey, inputValues });
    if (node.concept === 'file') this.applyFileFields(node, values);
    if (node.concept === 'function') this.applyNative(node);
    this.layout(node);
    this.elements.push(node);
    if (node.concept === 'return') this.syncReturn(node);
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

  // Os dois pinos podem ligar? Os tipos de dado seguem a linguagem dos nós (os dois estão na mesma
  // área); uma classe do projeto liga numa entrada de uma classe pai dela.
  canConnect(a, b) {
    const lang = this.languages.of(a.node);
    const assign = lang.canAssign ?? ((x, y) => x === y);
    return canConnect(a, b, { ...lang, canAssign: (from, to) => assign(from, to) || this.classAssign(lang, from, to) });
  }

  // Classe do projeto (pelo nome) numa entrada de uma classe pai dela: do projeto ou da linguagem.
  classAssign(lang, from, to) {
    const type = this.projectTypes(lang.id)[from];
    if (!type) return false;
    const cls = this.byId(type.project);
    if ([cls, ...this.superclasses(cls)].some((c) => this.className(c) === to)) return true;
    const base = this.engineBase(cls);
    return !!base && (base === to || !!lang.canAssign?.(base, to));
  }

  // Liga dois pinos (em qualquer ordem). Pino no limite: o fio mais antigo sai para o novo entrar.
  connect(a, b) {
    const check = this.canConnect(a, b);
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
    // Método nativo: nome e retorno vêm da linguagem; nos parâmetros, só os extras mudam.
    const native = this.nativeOf(node);
    if (native && ['name', 'returns'].includes(fieldId)) return;
    if (native && fieldId === 'params') value = this.withNative(native, value, node);
    node.values[fieldId] = value;
    if (fieldId === 'name') this.applyNative(node);
    if (fieldId === 'name' && node.concept === 'file') this.applyFileFields(node);
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
    this.refreshNatives(); // o extends (ou o nome) mudou quais funções são nativas
    this.syncReferences();
  }

  // Campos do arquivo: os do núcleo e os que a linguagem dele pede (ex.: GDScript: class_name e
  // extends). Mudam com a extensão; os valores que já havia ficam (initial: os salvos).
  applyFileFields(file, initial = {}) {
    const extra = this.languages.forFile(file)?.fileFields ?? [];
    file.fields = [...this.languages.def('file', null).fields, ...extra];
    for (const f of extra) {
      if (!(f.id in file.values)) file.values[f.id] = initial && f.id in initial ? initial[f.id] : structuredClone(f.default);
    }
  }

  // ---------------------------------------------------------------- valores digitados nos pinos

  // Tipo pelo id, na linguagem do nó (ou uma classe do projeto, ex.: class_name Player).
  typeOf(node, id) {
    const lang = this.languages.of(node);
    return lang.types?.[id] ?? (id ? this.projectTypes(lang.id)[id] : undefined);
  }

  // Tipo de dado do pino.
  typeDef(node, pin) {
    return this.typeOf(node, pin.type);
  }

  // Todos os tipos que valem para o nó: os da linguagem e as classes do projeto.
  typesFor(node) {
    const lang = this.languages.of(node);
    return { ...lang.types, ...this.projectTypes(lang.id) };
  }

  // Classes do projeto como tipos: as que têm nome (class_name do arquivo, nome da classe interna).
  projectTypes(lang) {
    const out = {};
    const color = this.languages.get(lang).projectClassColor;
    for (const n of this.elements) {
      const name = this.isClass(n) && this.classLang(n) === lang ? this.className(n) : null;
      if (name) out[name] = { label: name, tag: 'obj', color, group: 'Project classes', project: n.id };
    }
    return out;
  }

  // Valor do pino de entrada (o digitado, ou o padrão do tipo). Componente de pino aberto: a parte
  // dele no valor do pino de origem.
  inputValue(node, pin) {
    if (pin.parent != null) {
      const parent = node.inputs.find((p) => p.id === pin.parent);
      return this.inputValue(node, parent)[pin.index];
    }
    return node.inputValues[pin.id] ?? defaultValue(this.typeDef(node, pin));
  }

  // Valor digitado (pelo inspetor): convertido para o tipo do pino (int só inteiro, etc.).
  // Componente de pino aberto muda só a parte dele no valor do pino de origem.
  setInputValue(node, pinId, raw) {
    const pin = node.inputs.find((p) => p.id === pinId);
    if (!pin || !editorOf(this.typeDef(node, pin))) return;
    if (pin.parent != null) {
      const parent = node.inputs.find((p) => p.id === pin.parent);
      const whole = [...this.inputValue(node, parent)];
      whole[pin.index] = coerceValue(this.typeDef(node, pin), raw);
      node.inputValues[parent.id] = coerceValue(this.typeDef(node, parent), whole);
    } else {
      node.inputValues[pinId] = coerceValue(this.typeDef(node, pin), raw);
    }
    this.layout(node);
  }

  // ---------------------------------------------------------------- pinos abertos (componentes)

  canSplit(node, pin) {
    return canSplit(pin, this.typeDef(node, pin));
  }

  // Abre o pino (ex.: Vector3 → x, y, z). Os fios do pino inteiro saem.
  splitPin(node, pin) {
    if (!this.canSplit(node, pin)) return;
    this.disconnect(this.wiresAt(node, pin).map((w) => w.id));
    splitPin(node, pin, this.typeDef(node, pin));
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
      const type = this.typeDef(node, pin);
      if (type?.components?.length !== partsOf(node, pin).length) this.recombinePin(node, pin);
    }
  }

  // Depois de mudar o tipo dos pinos: valores convertidos para o tipo novo (sem editor, somem).
  normalizeValues(node) {
    for (const pin of node.inputs) {
      if (!(pin.id in node.inputValues)) continue;
      const type = this.typeDef(node, pin);
      if (editorOf(type)) node.inputValues[pin.id] = coerceValue(type, node.inputValues[pin.id]);
      else delete node.inputValues[pin.id];
    }
  }

  // Fio que chega no pino de entrada (o valor vem dele), ou null.
  incoming(node, pin) {
    const wire = this.wiresAt(node, pin)[0];
    return wire ? { wire, ...this.ends(wire).from } : null;
  }

  // ---------------------------------------------------------------- referências (get/set)

  // Cria uma referência ('get' ou 'set') ao nó, ao lado dele e na mesma área: o nó da linguagem dele
  // que veste o conceito pedido em `references` (ex.: get da variável, chamada da função).
  addReference(target, kind) {
    const def = target.references && this.languages.byConcept(target.lang, target.references[kind]);
    if (!def) return null;
    const node = this.addNode(def, { x: target.x + target.w + 30, y: target.y, scope: target.scope, ref: target.id });
    this.syncReference(node);
    return node;
  }

  // Parâmetros da função (lista { id, name, type }).
  paramsOf(fn) {
    return fn?.values.params ?? [];
  }

  // Métodos nativos que valem no escopo: os virtuais da cadeia da classe em volta (se a linguagem os
  // calcula, como a GDScript) ou a lista fixa da linguagem.
  nativesIn(lang, scope) {
    const language = this.languages.get(lang);
    if (!language.virtuals) return language.natives ?? [];
    const cls = this.classAround(scope);
    return language.virtuals(cls ? this.engineBase(cls) : language.defaultBase);
  }

  // Método nativo que a função sobrescreve (pelo nome, na classe em volta), ou null.
  nativeOf(fn) {
    if (fn?.concept !== 'function') return null;
    return this.nativesIn(fn.lang, fn.scope).find((n) => n.name === fn.values.name) ?? null;
  }

  // Depois de mudar um extends (ou mover funções): quem passou a sobrescrever um nativo trava; quem
  // deixou de sobrescrever destrava (os parâmetros ficam, sem a marca de nativo).
  refreshNatives() {
    for (const fn of this.elements) {
      if (fn.concept !== 'function') continue;
      if (this.nativeOf(fn)) this.applyNative(fn);
      else if ((fn.values.params ?? []).some((p) => p.native)) fn.values.params = fn.values.params.map(({ native, ...p }) => p);
    }
  }

  // Função com o nome de um método nativo (uma personalizada renomeada vira o nativo): nome, retorno e
  // parâmetros dele vêm da linguagem, travados.
  applyNative(fn) {
    const native = this.nativeOf(fn);
    if (!native) return;
    fn.values.params = this.withNative(native, fn.values.params ?? [], fn);
    fn.values.returns = native.returns ?? null;
  }

  // Parâmetros de um método nativo: os dele primeiro (id = nome, native: true) e depois os extras,
  // cada um com valor padrão (como a Godot exige para parâmetros a mais num método sobrescrito).
  withNative(native, params, fn) {
    const own = native.params.map((p) => ({ id: p.name, name: p.name, type: p.type, native: true }));
    const types = this.typesFor(fn);
    const extras = params
      .filter((p) => !p.native && !own.some((o) => o.id === p.id))
      .map((p) => ({ ...p, default: coerceValue(types[p.type], p.default ?? defaultValue(types[p.type])) }));
    return [...own, ...extras];
  }

  // Definição para criar a função de um método nativo: a Function da linguagem com o nome dele.
  nativeDef(lang, native) {
    const fn = this.languages.byConcept(lang, 'function');
    if (!fn) return null;
    const fields = (fn.fields ?? []).map((f) => (f.id === 'name' ? { ...f, default: native.name } : f));
    return { ...fn, title: native.name, category: 'Native methods', fields };
  }

  nativeDefs(lang, scope) {
    return this.nativesIn(lang, scope).map((n) => this.nativeDef(lang, n)).filter(Boolean);
  }

  // Cria a função de um método nativo no ponto (arrastado da aba de métodos nativos), se cabe ali e
  // se a classe em volta tem esse método.
  addNative(lang, name, point, scope) {
    const native = this.nativesIn(lang, scope).find((n) => n.name === name);
    const def = native && this.nativeDef(lang, native);
    if (!def || !this.accepts(scope, def)) return null;
    return this.addNode(def, { x: point.x, y: point.y, scope });
  }

  // Cria o nó de um parâmetro da função no ponto (arrastado do inspetor). Só onde o nó cabe (num
  // script da linguagem dela); fora da função ele nasce, mas fica marcado.
  addParameter(fn, paramId, point, scope) {
    const def = this.languages.byConcept(fn.lang, 'parameter');
    if (!def || !this.paramsOf(fn).some((p) => p.id === paramId) || !this.accepts(scope, def)) return null;
    const node = this.addNode(def, { x: point.x, y: point.y, scope, ref: fn.id, refKey: paramId });
    this.syncReference(node);
    return node;
  }

  // O escopo está dentro da área (nela ou numa área de dentro dela)?
  insideOf(area, scope) {
    return scope === area.id || (scope !== ROOT && this.ancestors(this.byId(scope)).some((a) => a.id === area.id));
  }

  // Tipo de dado dos pinos de dado do nó (e da etiqueta), sem mexer nos componentes de pinos abertos.
  setDataType(node, type) {
    for (const pin of [...node.inputs, ...node.outputs]) if (pin.kind === 'data' && pin.parent == null) pin.type = type;
    if (node.tag) node.tag = type;
  }

  // Troca os pinos do nó pelos da lista, mantendo os que continuam (mesmo id e tipo de fio: ficam o
  // valor digitado e o pino aberto). Fios e valores de pinos que saíram também saem.
  setPins(node, inputs, outputs) {
    const rebuild = (old, defs, direction) => defs.flatMap((d) => {
      const pin = old.find((p) => p.id === d.id && p.parent == null && p.kind === d.kind);
      if (!pin) return [createPin(d, direction)];
      Object.assign(pin, { label: d.label ?? '', type: d.type ?? null });
      return [pin, ...old.filter((p) => p.parent === pin.id)];
    });
    node.inputs = rebuild(node.inputs, inputs, 'in');
    node.outputs = rebuild(node.outputs, outputs, 'out');
    const alive = (end, side) => end.node !== node.id || node[side].some((p) => p.id === end.pin);
    this.wires = this.wires.filter((w) => alive(w.from, 'outputs') && alive(w.to, 'inputs'));
    for (const id of Object.keys(node.inputValues)) if (!node.inputs.some((p) => p.id === id)) delete node.inputValues[id];
  }

  // Chamada: título da função; entradas: fluxo e um pino por parâmetro; saídas: fluxo e o retorno.
  syncCall(node, fn) {
    node.title = fn.title;
    const params = this.paramsOf(fn).map((p) => ({ id: p.id, label: p.name, kind: 'data', type: p.type }));
    const returns = fn.values.returns ? [{ id: 'value', label: 'return', kind: 'data', type: fn.values.returns }] : [];
    this.setPins(node, [{ id: 'run', kind: 'flow' }, ...params], [{ id: 'next', kind: 'flow' }, ...returns]);
  }

  // Retorno: o pino de valor segue o tipo de retorno da função em volta (sem tipo, o pino some).
  syncReturn(node) {
    const fn = this.ancestors(node).find((a) => a.concept === 'function');
    const returns = fn?.values.returns ?? null;
    node.values.returns = returns;
    const value = node.inputs.find((p) => p.when === 'returns');
    if (value) {
      if (!returns) this.disconnect(this.wiresAt(node, value).map((w) => w.id));
      value.type = returns ?? value.type;
    }
    this.fixSplits(node);
    this.normalizeValues(node);
    this.layout(node);
    this.dropBrokenWires(node);
  }

  // Referências que apontam para o nó.
  referencesTo(target) {
    return this.elements.filter((n) => n.ref === target.id);
  }

  // A referência copia o nome e o tipo do alvo (a chamada copia também os parâmetros e o retorno da
  // função). Sem alvo (apagado, ou o parâmetro saiu da função), fica quebrada; fora do alcance do alvo
  // (pela posição atual dos dois, não por onde foram criados), fica marcada também. O parâmetro só
  // vale dentro da função.
  syncReference(node) {
    const target = this.byId(node.ref);
    const param = node.concept === 'parameter' ? this.paramsOf(target).find((p) => p.id === node.refKey) : null;
    node.broken = !target || (node.concept === 'parameter' && !param);
    node.outOfReach = !node.broken && !(param ? this.insideOf(target, node.scope) : this.inReach(target, node.scope));
    if (param) {
      node.title = param.name;
      this.setDataType(node, param.type);
    } else if (target && node.concept === 'call') {
      this.syncCall(node, target);
    } else if (target) {
      node.title = node.reference === 'set' ? `set ${target.title}` : target.title;
      this.setDataType(node, target.outputs.find((p) => p.id === target.references?.pin)?.type ?? null);
    }
    this.fixSplits(node);
    this.normalizeValues(node);
    this.layout(node);
    this.dropBrokenWires(node);
  }

  // Referências, chamadas, parâmetros e retornos seguem o que mudou (alvo, função, posição).
  syncReferences() {
    for (const node of this.elements) {
      if (node.ref != null) this.syncReference(node);
      else if (node.concept === 'return') this.syncReturn(node);
    }
  }

  // Liga a referência a outro alvo (ex.: depois que o alvo dela foi apagado).
  relink(node, target) {
    node.ref = target.id;
    this.syncReference(node);
  }

  // Alvos possíveis para religar a referência: nós da mesma linguagem que geram esse conceito de
  // referência e têm o lugar dela ao alcance. (O nó de parâmetro não religa: nasce de novo do inspetor.)
  relinkCandidates(node) {
    if (node.concept === 'parameter') return [];
    return this.elements.filter((n) => n.lang === node.lang && n.references?.[node.reference] === node.concept && this.inReach(n, node.scope));
  }

  // O escopo está ao alcance do alvo? (a área dele ou uma área de dentro dela; membro de uma classe
  // também vale dentro das classes filhas dela)
  inReach(target, scope) {
    if (scope === target.scope) return true;
    const around = scope === ROOT ? [] : [this.byId(scope), ...this.ancestors(this.byId(scope))];
    if (around.some((a) => a.id === target.scope)) return true;
    const owner = this.byId(target.scope);
    return this.isClass(owner) && around.some((a) => this.isClass(a) && this.superclasses(a).includes(owner));
  }

  // ---------------------------------------------------------------- herança (classes)

  // Classe: a área Class, ou um arquivo cuja linguagem trata o arquivo como classe (GDScript: .gd).
  isClass(node) {
    return node?.concept === 'class' || (node?.concept === 'file' && !!this.languages.forFile(node)?.classFiles);
  }

  // Linguagem da classe (a do arquivo, para o arquivo-classe).
  classLang(cls) {
    return cls.concept === 'file' ? this.languages.forFile(cls)?.id ?? null : cls.lang;
  }

  // Nome da classe como tipo: o class_name do arquivo (vazio = sem nome) ou o nome da classe interna.
  className(cls) {
    return cls.concept === 'file' ? cls.values.class_name || null : cls.title;
  }

  // Nome mostrado nas listas: "Player (player.gd)", ou só o arquivo, se ele não tem class_name.
  classLabel(cls) {
    if (cls.concept === 'file') return cls.values.class_name ? `${cls.values.class_name} (${cls.title})` : cls.title;
    return `${cls.title} (${this.scriptOf(cls)?.title ?? '—'})`;
  }

  // Classe mais próxima em volta do escopo (ele mesmo, se for uma), ou null. (Ao abrir o projeto, a
  // área pode ainda não ter sido criada: null também.)
  classAround(scope) {
    const area = scope === ROOT || scope == null ? null : this.byId(scope);
    if (!area) return null;
    return [area, ...this.ancestors(area)].find((a) => this.isClass(a)) ?? null;
  }

  // Classes pai do projeto, da mais próxima para a mais de fora (extends com o id de uma classe).
  superclasses(cls) {
    const out = [];
    for (let p = this.byId(cls.values.extends); this.isClass(p) && p !== cls && !out.includes(p); p = this.byId(p.values.extends)) {
      out.push(p);
    }
    return out;
  }

  // Classe da linguagem (ex.: da Godot) de onde a cadeia parte: o primeiro extends que não é do
  // projeto; sem nenhum, a padrão da linguagem (GDScript: RefCounted).
  engineBase(cls) {
    const last = [cls, ...this.superclasses(cls)].at(-1);
    const ext = last.values.extends;
    return typeof ext === 'string' ? ext : this.languages.get(this.classLang(cls)).defaultBase ?? null;
  }

  // Classe pai do projeto apagada (o extends aponta para quem não existe mais).
  missingSuperclass(cls) {
    return typeof cls.values.extends === 'number' && !this.isClass(this.byId(cls.values.extends));
  }

  // Classes do projeto que podem ser a pai: da mesma linguagem, sem ela mesma e sem as que já herdam dela.
  superclassCandidates(cls) {
    return this.elements.filter((n) => this.isClass(n) && n !== cls && this.classLang(n) === this.classLang(cls) && !this.superclasses(n).includes(cls));
  }

  // Membros herdados que valem no escopo: variáveis e funções das classes pai das classes em volta.
  inherited(scope) {
    const around = scope === ROOT ? [] : [this.byId(scope), ...this.ancestors(this.byId(scope))];
    const parents = [...new Set(around.filter((a) => this.isClass(a)).flatMap((c) => this.superclasses(c)))];
    return parents.flatMap((p) => this.inScope(p.id).filter((n) => n.references && ['variable', 'function'].includes(n.concept)));
  }

  // Itens do menu para os membros herdados: get/set da variável, chamada da função.
  inheritedDefs(scope) {
    return this.inherited(scope).flatMap((member) => Object.keys(member.references).filter((k) => k !== 'pin').map((kind) => {
      const def = this.languages.byConcept(member.lang, member.references[kind]);
      if (!def) return null;
      const title = member.concept === 'function' ? `${member.title}()` : `${kind} ${member.title}`;
      return { ...def, title, category: 'Inherited', hidden: false, inherit: { target: member.id, kind } };
    })).filter(Boolean);
  }

  // Cria o nó escolhido no menu: membro herdado vira a referência a ele (no ponto); o resto, o nó.
  addFromMenu(def, point, scope) {
    if (!def.inherit) return this.addNode(def, { x: point.x, y: point.y, scope });
    const target = this.byId(def.inherit.target);
    const node = this.addNode(def, { x: point.x, y: point.y, scope, ref: target.id });
    this.syncReference(node);
    return node;
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
      return !this.canConnect(from, to).ok;
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

  // A área (ou a raiz, com scope 'root') aceita esta definição dentro dela? Na raiz, só pastas e
  // arquivos; num script, só os nós da linguagem dele.
  accepts(scope, def) {
    if (scope === ROOT) return containsDef(rootContains, def);
    const area = this.byId(scope);
    if (def.lang && def.lang !== this.scriptType(this.scriptOf(area))) return false;
    if (def.inside && ![area, ...this.ancestors(area)].some((a) => a.concept === def.inside)) return false;
    return containsDef(this.containsOf(area), def);
  }

  // O que a área aceita dentro: o arquivo, o que a linguagem dele disser; as outras, a lista delas.
  containsOf(area) {
    if (area.script) return this.languages.forFile(area)?.fileContains ?? [];
    return area.contains;
  }

  // Nós que o menu oferece no escopo: os do núcleo e os da linguagem do script em volta (com os
  // métodos nativos dela e os membros herdados), só os aceitos ali (sem os escondidos, como as
  // referências). Com métodos e propriedades da linguagem: os da cadeia da classe em volta; os da
  // classe do objeto de onde veio o fio (origin); e, sem fio, os de todas as classes, só na busca
  // (searchOnly).
  menuDefs(scope, origin = null) {
    const lang = scope === ROOT ? null : this.scriptType(this.scriptOf(this.byId(scope)));
    const own = lang ? [...this.languages.get(lang).nodes, ...this.nativeDefs(lang, scope), ...this.inheritedDefs(scope)] : [];
    const defs = [...this.languages.core.nodes, ...own].filter((d) => !d.hidden && this.accepts(scope, d));
    if (!lang) return defs;
    const cls = this.classAround(scope);
    const near = [
      ...(cls ? this.languages.dynamic(lang, 'memberDefs', this.engineBase(cls)) : []),
      ...(origin ? this.languages.dynamic(lang, 'memberDefs', this.objectClass(origin)) : []),
    ];
    const all = origin ? [] : this.languages.dynamic(lang, 'allMemberDefs');
    // Todos os métodos e propriedades valem nos mesmos lugares: confere um só.
    const sample = near[0] ?? all[0];
    if (!sample || !this.accepts(scope, sample)) return defs;
    const seen = new Set();
    const unique = near.filter((d) => !seen.has(d.id) && seen.add(d.id));
    return [...defs, ...unique, ...all.filter((d) => !seen.has(d.id)).map((d) => ({ ...d, searchOnly: true }))];
  }

  // Tipo do valor num pino, para achar os métodos dele (ex.: saída Node2D → 'Node2D'; Vector2 →
  // 'Vector2'; classe do projeto → a classe da linguagem de onde ela parte), ou null.
  objectClass({ node, pin }) {
    const type = pin.type && this.typeOf(node, pin.type);
    if (type?.project) return this.engineBase(this.byId(type.project));
    return type ? pin.type : null;
  }

  // Nó de método/propriedade sem fio no target: vale o próprio script, que precisa herdar da classe
  // do método. Se não herda, o nó fica marcado.
  selfMissing(node) {
    const pin = node.inputs.find((p) => p.self);
    if (!pin || this.isConnected(node, pin)) return false;
    const cls = this.classAround(node.scope);
    const base = cls && this.engineBase(cls);
    const lang = this.languages.of(node);
    return !base || !(base === pin.type || !!lang.canAssign?.(base, pin.type));
  }

  // Definição de onde o nó veio (para regras de soltar).
  defOf(node) {
    if (node.reroute) return { id: 'reroute', reroute: true };
    return this.languages.def(node.type, node.lang) ?? { id: node.type, area: node.area };
  }

  // Script em volta do nó (ele mesmo, se for um): a área de script mais próxima, ou null.
  scriptOf(node) {
    for (let n = node; n; n = this.byId(n.scope)) if (n.script) return n;
    return null;
  }

  // Linguagem de um script (pela extensão do arquivo): o id dela, ou null.
  scriptType(script) {
    return script ? this.languages.forFile(script)?.id ?? null : null;
  }

  // Nó de linguagem que está num script de outra linguagem (ex.: o arquivo trocou de extensão).
  isForeign(node) {
    if (!node.lang || node.reroute) return false;
    const script = this.scriptOf(node);
    return !!script && this.scriptType(script) !== node.lang;
  }

  // Caminho de pasta/arquivo a partir da pasta mais de fora: 'res' vira 'res://'.
  pathOf(node) {
    const names = [...this.ancestors(node).reverse(), node].map((n) => n.title);
    if (names[0] === 'res') names.shift();
    return `res://${names.join('/')}`;
  }

  // Pode soltar estes nós (os de cima de cada grupo arrastado) no escopo de destino?
  // Resposta: { ok, mode: 'move' | 'path', reason }. 'path': pasta/arquivo solto num script vira
  // um nó de caminho (o original volta ao lugar). Nó de linguagem só existe dentro de um script e só
  // vai para script da mesma linguagem.
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
      const targetLang = this.scriptType(targetScript);
      if (targetScript && !targetLang && (item.pathable || def.lang)) {
        return { ok: false, reason: t('drop.noLanguage', { file: name(targetScript) }) };
      }
      if (item.pathable && targetScript && !outerScript) {
        if (!this.languages.byConcept(targetLang, 'path')) {
          return { ok: false, reason: t('drop.noPath', { lang: this.languages.get(targetLang).name }) };
        }
        mode = 'path';
        continue;
      }
      if (def.lang && !targetScript) return { ok: false, reason: t('drop.noScript', { item: name(item) }) };
      if (def.lang && def.lang !== targetLang) {
        return { ok: false, reason: t('drop.scriptType', { item: name(item), lang: this.languages.get(def.lang).name }) };
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
    this.refreshNatives(); // função levada para outra classe pode ter outros nativos
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
    const node = this.addNode(rerouteDef(from.pin, to.pin, from.node.lang), { x: point.x, y: point.y, scope: pinScope(from.node) });
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
