import { currentCatalogs, currentProfile } from './profileLoader.js';

// Definições de nós disponíveis para o projeto aberto:
//   - nós do perfil de linguagem (profile.nodes)
//   - nós gerados dos catálogos de engine (métodos, propriedades, sinais, funções globais, construtores)
//   - nós do próprio app (reroute)
// Também resolve tipos: cor, família, herança e compatibilidade entre pinos.

const FLOW_IN = { id: 'in', kind: 'flow', label: '' };
const FLOW_OUT = { id: 'out', kind: 'flow', label: '' };

const CORE_NODES = [
  {
    id: 'core.reroute',
    title: '',
    category: '',
    template: 'reroute',
    inputs: [{ id: 'in', kind: 'data', type: '$T', label: '' }],
    outputs: [{ id: 'out', kind: 'data', type: '$T', label: '' }],
    generics: { T: ['*'] },
  },
];

// Um cache por perfil de linguagem (cada arquivo usa o perfil dele; ver profileLoader).
// Perfil com "catalogs": false (ex.: JSON) não usa os catálogos de engine.
let caches = new Map();
let cachedCatalogs = null;

function ensureCache() {
  const profile = currentProfile();
  const all = currentCatalogs();
  if (cachedCatalogs !== all) {
    caches = new Map();
    cachedCatalogs = all;
  }
  if (caches.has(profile)) return caches.get(profile);
  const catalogs = profile?.catalogs === false ? [] : all;
  const defs = new Map();
  for (const def of CORE_NODES) defs.set(def.id, def);
  for (const def of profile?.nodes ?? []) defs.set(def.id, def);
  const classes = new Map();
  const builtins = new Map();
  for (const catalog of catalogs) {
    for (const cls of catalog.classes ?? []) classes.set(cls.name, cls);
    for (const b of catalog.builtinTypes ?? []) builtins.set(b.name, b);
  }
  const cache = { profile, catalogs, defs, classes, builtins, search: null };
  caches.set(profile, cache);
  return cache;
}

// ---------- definições ----------

export function getDef(id) {
  if (typeof id !== 'string') return null;
  const c = ensureCache();
  if (c.defs.has(id)) return c.defs.get(id);
  const def = generateCatalogDef(id, c);
  if (def) c.defs.set(id, def);
  return def;
}

function args(list = []) {
  return list.map((a) => ({ id: `arg:${a.name}`, kind: 'data', type: a.type ?? 'Variant', label: a.name, ...(a.default !== undefined ? { default: a.default } : {}) }));
}

function argCode(list = []) {
  return list.map((a) => `{arg:${a.name}}`).join(', ');
}

// ids: cat.call:Classe.metodo · cat.get:Classe.prop · cat.set:Classe.prop · cat.emit:Classe.sinal
//      cat.util:nome · cat.ctor:Tipo#indice · cat.const:Tipo.NOME · cat.cget:Tipo.NOME (pelo valor) · cat.enum:Dono.Enum (Dono = classe, tipo ou @GlobalScope)
function generateCatalogDef(id, c) {
  const match = id.match(/^cat\.(\w+):(.+)$/);
  if (!match) return null;
  const [, kind, ref] = match;
  const dot = ref.lastIndexOf('.');
  const owner = ref.slice(0, dot);
  const member = ref.slice(dot + 1);
  const cls = c.classes.get(owner);
  // Alvo sem fio = self (o método é do próprio objeto do script).
  const target = { id: 'target', kind: 'data', type: owner, label: 'alvo', ...(cls ? { default: 'self' } : {}) };
  const category = `Catálogo/${owner}`;

  if (kind === 'call') {
    const m = cls?.methods?.find((x) => x.name === member) ?? c.builtins.get(owner)?.methods?.find((x) => x.name === member);
    if (!m) return null;
    const pure = Boolean(m.const) || (!cls && Boolean(m.static));
    const inputs = [...(pure ? [] : [FLOW_IN]), ...(m.static ? [] : [target]), ...args(m.args)];
    const outputs = [...(pure ? [] : [FLOW_OUT]), ...(m.returns && m.returns !== 'void' ? [{ id: 'result', kind: 'data', type: m.returns, label: '' }] : [])];
    const def = {
      id, title: `${member}()`, subtitle: owner, category, template: 'full', keywords: [owner, member],
      inputs, outputs, code: `${m.static ? owner : '{target}'}.${member}(${argCode(m.args)})`,
    };
    if (m.vararg) Object.assign(def, { dynamicInputs: { min: 0, pins: ['arg:...'] }, inputs: [...inputs, { id: 'arg:...', kind: 'data', type: 'Variant', label: '...' }] });
    return def;
  }
  if (kind === 'get' || kind === 'set') {
    const p = cls?.properties?.find((x) => x.name === member) ?? c.builtins.get(owner)?.members?.find((x) => x.name === member);
    if (!p) return null;
    if (kind === 'get') {
      return {
        id, title: member, subtitle: owner, category, template: 'compact', keywords: [owner, member, 'get'],
        inputs: [target], outputs: [{ id: 'value', kind: 'data', type: p.type, label: '' }], code: `{target}.${member}`,
      };
    }
    return {
      id, title: `${member} =`, subtitle: owner, category, template: 'full', keywords: [owner, member, 'set'],
      inputs: [FLOW_IN, target, { id: 'value', kind: 'data', type: p.type, label: member }], outputs: [FLOW_OUT],
      code: `{target}.${member} = {value}`,
    };
  }
  if (kind === 'emit') {
    const s = cls?.signals?.find((x) => x.name === member);
    if (!s) return null;
    return {
      id, title: `${member}.emit`, subtitle: owner, category, template: 'full', keywords: [owner, member, 'emit', 'sinal'],
      inputs: [FLOW_IN, target, ...args(s.args)], outputs: [FLOW_OUT], code: `{target}.${member}.emit(${argCode(s.args)})`,
    };
  }
  if (kind === 'util') {
    const f = c.catalogs.flatMap((cat) => cat.utilityFunctions ?? []).find((x) => x.name === ref);
    if (!f) return null;
    const pure = f.returns && f.returns !== 'void';
    const def = {
      id, title: `${f.name}()`, category: `Catálogo/@GlobalScope/${f.category ?? ''}`.replace(/\/$/, ''), template: 'full', keywords: [f.name, f.category ?? ''],
      inputs: [...(pure ? [] : [FLOW_IN]), ...args(f.args)],
      outputs: [...(pure ? [] : [FLOW_OUT]), ...(pure ? [{ id: 'result', kind: 'data', type: f.returns, label: '' }] : [])],
      code: `${f.name}(${argCode(f.args)})`,
    };
    if (f.vararg) {
      def.inputs.push({ id: 'arg:...', kind: 'data', type: 'Variant', label: '...' });
      def.dynamicInputs = { min: 1, pins: ['arg:...'] };
    }
    return def;
  }
  if (kind === 'ctor') {
    const [typeName, index] = ref.split('#');
    const k = c.builtins.get(typeName)?.constructors?.[Number(index)];
    if (!k) return null;
    return {
      id, title: `${typeName}(${(k.args ?? []).map((a) => a.name).join(', ')})`, category: `Catálogo/${typeName}`, template: 'compact',
      keywords: [typeName, 'construtor', 'novo'], inputs: args(k.args), outputs: [{ id: 'out', kind: 'data', type: typeName, label: '' }],
      code: `${typeName}(${argCode(k.args)})`,
    };
  }
  if (kind === 'const') {
    const k = cls?.constants?.find((x) => x.name === member) ?? c.builtins.get(owner)?.constants?.find((x) => x.name === member);
    if (!k) return null;
    return {
      id, title: `${owner}.${member}`, category, template: 'compact', keywords: [owner, member, 'constante'],
      description: `Constante ${owner}.${member} = ${k.value}`,
      inputs: [], outputs: [{ id: 'value', kind: 'data', type: k.type ?? 'int', label: '' }], code: `${owner}.${member}`,
    };
  }
  // Constante lida pelo valor (pos.UP): entrada do tipo, saída da constante.
  if (kind === 'cget') {
    const k = c.builtins.get(owner)?.constants?.find((x) => x.name === member);
    if (!k) return null;
    return {
      id, title: member, subtitle: owner, category, template: 'compact', keywords: [owner, member, 'constante'],
      description: `Constante ${owner}.${member} = ${k.value}`,
      inputs: [target], outputs: [{ id: 'value', kind: 'data', type: k.type ?? owner, label: '' }], code: `{target}.${member}`,
    };
  }
  // Enum: um nó com seletor de valor (Node.PROCESS_MODE_ALWAYS, KEY_SPACE…). O nome do enum
  // pode ter ponto (Variant.Type), então o dono é o que vem antes do primeiro ponto.
  if (kind === 'enum') {
    const cut = ref.indexOf('.');
    const enumOwner = ref.slice(0, cut);
    const enumName = ref.slice(cut + 1);
    const e = enumList(c, enumOwner).find((x) => x.name === enumName);
    if (!e?.values?.length) return null;
    const global = enumOwner === '@GlobalScope';
    return {
      id, title: enumName, subtitle: enumOwner, category: `Catálogo/${enumOwner}`, template: 'compact', keywords: [enumOwner, enumName, 'enum'], enumOf: true,
      fields: [{ id: 'item', label: 'Valor', type: 'select', default: e.values[0].name, options: e.values.map((v) => ({ value: v.name, label: `${v.name} (${v.value})` })) }],
      inputs: [], outputs: [{ id: 'value', kind: 'data', type: 'int', label: '' }], code: global ? '{item}' : `${enumOwner}.{item}`,
    };
  }
  return null;
}

function enumList(c, owner) {
  if (owner === '@GlobalScope') return c.catalogs.flatMap((cat) => cat.globalEnums ?? []);
  return c.classes.get(owner)?.enums ?? c.builtins.get(owner)?.enums ?? [];
}

// Id do nó de enum que tem o valor (ex.: Node + PROCESS_MODE_ALWAYS → cat.enum:Node.ProcessMode).
export function findEnumValue(owner, value) {
  const e = enumList(ensureCache(), owner).find((x) => x.values?.some((v) => v.name === value));
  return e ? `cat.enum:${owner}.${e.name}` : null;
}

// Entradas para a busca de nós: [{ id, title, subtitle, category, keywords, pins: { in: [{kind,type}], out: [...] } }]
export function searchEntries() {
  const c = ensureCache();
  if (c.search) return c.search;
  const entries = [];
  const pinSummary = (def) => ({
    in: (def.inputs ?? []).map((p) => ({ kind: p.kind, type: p.type === '$field' ? 'Variant' : p.type, ...(p.truthy ? { truthy: true } : {}) })),
    out: (def.outputs ?? []).map((p) => ({ kind: p.kind, type: p.type === '$field' ? 'Variant' : p.type })),
  });
  for (const def of c.profile?.nodes ?? []) {
    entries.push({ id: def.id, title: def.title, category: def.category, keywords: def.keywords ?? [], pins: pinSummary(def), template: def.template });
  }
  const lazy = (id, title, subtitle, category, keywords, pins, values) => entries.push({ id, title, subtitle, category, keywords, pins, catalog: true, ...(values ? { values } : {}) });
  // Perfil com "catalogNodes": false (ex.: .tres) usa as classes, mas sem nós de métodos.
  if (c.profile?.catalogNodes === false) {
    c.search = entries;
    return entries;
  }
  for (const cls of c.classes.values()) {
    const category = `Catálogo/${cls.name}`;
    for (const m of cls.methods ?? []) {
      if (m.virtual) continue;
      const pure = Boolean(m.const);
      lazy(`cat.call:${cls.name}.${m.name}`, `${m.name}()`, cls.name, category, [cls.name, m.name], {
        in: [...(pure ? [] : [{ kind: 'flow' }]), ...(m.static ? [] : [{ kind: 'data', type: cls.name }]), ...(m.args ?? []).map((a) => ({ kind: 'data', type: a.type }))],
        out: [...(pure ? [] : [{ kind: 'flow' }]), ...(m.returns && m.returns !== 'void' ? [{ kind: 'data', type: m.returns }] : [])],
      });
    }
    for (const p of cls.properties ?? []) {
      lazy(`cat.get:${cls.name}.${p.name}`, p.name, cls.name, category, [cls.name, p.name, 'get'], { in: [{ kind: 'data', type: cls.name }], out: [{ kind: 'data', type: p.type }] });
      lazy(`cat.set:${cls.name}.${p.name}`, `${p.name} =`, cls.name, category, [cls.name, p.name, 'set'], {
        in: [{ kind: 'flow' }, { kind: 'data', type: cls.name }, { kind: 'data', type: p.type }],
        out: [{ kind: 'flow' }],
      });
    }
    for (const s of cls.signals ?? []) {
      lazy(`cat.emit:${cls.name}.${s.name}`, `${s.name}.emit`, cls.name, category, [cls.name, s.name, 'emit'], {
        in: [{ kind: 'flow' }, { kind: 'data', type: cls.name }, ...(s.args ?? []).map((a) => ({ kind: 'data', type: a.type }))],
        out: [{ kind: 'flow' }],
      });
    }
  }
  for (const catalog of c.catalogs) {
    for (const f of catalog.utilityFunctions ?? []) {
      const pure = f.returns && f.returns !== 'void';
      lazy(`cat.util:${f.name}`, `${f.name}()`, '@GlobalScope', 'Catálogo/@GlobalScope', [f.name, f.category ?? ''], {
        in: [...(pure ? [] : [{ kind: 'flow' }]), ...(f.args ?? []).map((a) => ({ kind: 'data', type: a.type }))],
        out: [...(pure ? [] : [{ kind: 'flow' }]), ...(pure ? [{ kind: 'data', type: f.returns }] : [])],
      });
    }
  }
  for (const b of c.builtins.values()) {
    (b.constructors ?? []).forEach((k, i) => {
      lazy(`cat.ctor:${b.name}#${i}`, `${b.name}(${(k.args ?? []).map((a) => a.name).join(', ')})`, b.name, `Catálogo/${b.name}`, [b.name, 'construtor'], {
        in: (k.args ?? []).map((a) => ({ kind: 'data', type: a.type })),
        out: [{ kind: 'data', type: b.name }],
      });
    });
  }
  // Constantes (Vector3.ZERO, Node.NOTIFICATION_READY…) e enums (um nó com seletor de valor;
  // os nomes dos valores entram na busca: "space" acha Key com KEY_SPACE escolhido).
  const constant = (owner, k) => lazy(`cat.const:${owner}.${k.name}`, `${owner}.${k.name}`, owner, `Catálogo/${owner}`, [owner, k.name, 'constante'], { in: [], out: [{ kind: 'data', type: k.type ?? 'int' }] });
  const enumEntry = (owner, e) => lazy(`cat.enum:${owner}.${e.name}`, e.name, owner, `Catálogo/${owner}`, [owner, e.name, 'enum'], { in: [], out: [{ kind: 'data', type: 'int' }] }, (e.values ?? []).map((v) => v.name));
  for (const cls of c.classes.values()) {
    for (const k of cls.constants ?? []) constant(cls.name, k);
    for (const e of cls.enums ?? []) enumEntry(cls.name, e);
  }
  for (const b of c.builtins.values()) {
    const category = `Catálogo/${b.name}`;
    for (const k of b.constants ?? []) {
      lazy(`cat.cget:${b.name}.${k.name}`, k.name, b.name, category, [b.name, k.name, 'constante'], { in: [{ kind: 'data', type: b.name }], out: [{ kind: 'data', type: k.type ?? b.name }] });
    }
    for (const m of b.methods ?? []) {
      const pure = Boolean(m.const) || Boolean(m.static);
      lazy(`cat.call:${b.name}.${m.name}`, `${m.name}()`, b.name, category, [b.name, m.name], {
        in: [...(pure ? [] : [{ kind: 'flow' }]), ...(m.static ? [] : [{ kind: 'data', type: b.name }]), ...(m.args ?? []).map((a) => ({ kind: 'data', type: a.type }))],
        out: [...(pure ? [] : [{ kind: 'flow' }]), ...(m.returns && m.returns !== 'void' ? [{ kind: 'data', type: m.returns }] : [])],
      });
    }
    for (const p of b.members ?? []) {
      lazy(`cat.get:${b.name}.${p.name}`, p.name, b.name, category, [b.name, p.name, 'get'], { in: [{ kind: 'data', type: b.name }], out: [{ kind: 'data', type: p.type }] });
      lazy(`cat.set:${b.name}.${p.name}`, `${p.name} =`, b.name, category, [b.name, p.name, 'set'], {
        in: [{ kind: 'flow' }, { kind: 'data', type: b.name }, { kind: 'data', type: p.type }],
        out: [{ kind: 'flow' }],
      });
    }
    for (const k of b.constants ?? []) constant(b.name, k);
    for (const e of b.enums ?? []) enumEntry(b.name, e);
  }
  for (const catalog of c.catalogs) for (const e of catalog.globalEnums ?? []) enumEntry('@GlobalScope', e);
  c.search = entries;
  return entries;
}

// ---------- tipos ----------

export function typeInfo(type) {
  return currentProfile()?.types?.find((t) => t.id === type) ?? null;
}

export function isClass(type) {
  return ensureCache().classes.has(type);
}

export function isSubclass(type, base) {
  const { classes } = ensureCache();
  let current = classes.get(type);
  const seen = new Set();
  while (current && !seen.has(current.name)) {
    if (current.name === base) return true;
    seen.add(current.name);
    current = current.inherits ? classes.get(current.inherits) : null;
  }
  return false;
}

// Cor da família mais próxima na herança (definida no catálogo).
function familyColor(type) {
  const c = ensureCache();
  const families = new Map(c.catalogs.flatMap((cat) => cat.families ?? []).map((f) => [f.name, f.color]));
  let current = c.classes.get(type);
  const seen = new Set();
  while (current && !seen.has(current.name)) {
    if (families.has(current.name)) return families.get(current.name);
    seen.add(current.name);
    current = current.inherits ? c.classes.get(current.inherits) : null;
  }
  return null;
}

export function elementType(type) {
  const m = /^Array\[(.+)\]$/.exec(type ?? '');
  return m ? m[1] : null;
}

export function typeColor(type, fallback = '#9aa0ad') {
  if (!type || type === '$T') return typeInfo('Variant')?.color ?? fallback;
  const element = elementType(type);
  if (element) return typeColor(element, fallback);
  return typeInfo(type)?.color ?? familyColor(type) ?? typeInfo('Object')?.color ?? fallback;
}

// Formato do pino: flow (seta), Array (grade), Dictionary (chaves), demais (círculo).
export function pinShape(kind, type) {
  if (kind === 'flow') return 'arrow';
  if (kind === 'tree') return 'diamond';
  if (kind === 'signal') return 'square';
  if (type === 'Array' || elementType(type)) return 'grid';
  if (type === 'Dictionary') return 'braces';
  return 'circle';
}

// Compatibilidade estrita: mesmo tipo, Variant/genérico aberto, Array[X] → Array, subclasse → base.
export function typesCompatible(outType, inType) {
  if (!outType || !inType) return true;
  if (outType === '$T' || inType === '$T' || outType === 'Variant' || inType === 'Variant') return true;
  if (outType === inType) return true;
  // NodePath aceita a referência a qualquer nó (pino "nó" de um nó de cena).
  if (inType === 'NodePath' && (outType === 'Node' || isSubclass(outType, 'Node'))) return true;
  if (inType === 'Array' && elementType(outType)) return true;
  const outEl = elementType(outType);
  const inEl = elementType(inType);
  if (outEl && inEl) return typesCompatible(outEl, inEl);
  return isSubclass(outType, inType);
}

// ---------- cenas ----------

// Cadeia de herança de uma classe do catálogo, da própria classe até a base:
// [{ name, properties: [{ name, type }], signals: [{ name, args }] }].
export function classChain(className) {
  const c = ensureCache();
  const chain = [];
  const seen = new Set();
  let name = className;
  while (name && !seen.has(name)) {
    seen.add(name);
    const cls = c.classes.get(name);
    chain.push({ name, properties: cls?.properties ?? [], signals: cls?.signals ?? [] });
    name = cls?.inherits;
  }
  return chain;
}

// Tipo de uma propriedade procurando na cadeia de herança (Variant se desconhecida).
export function classPropertyType(className, prop) {
  for (const link of classChain(className)) {
    const found = link.properties.find((p) => p.name === prop);
    if (found) return found.type ?? 'Variant';
  }
  return 'Variant';
}

// Classes que podem ser nós de cena (Node e derivadas do catálogo). Sem catálogo,
// uma lista básica para não deixar a cena vazia.
const BASIC_NODE_CLASSES = ['Node', 'Node2D', 'Node3D', 'Control', 'Sprite2D', 'CharacterBody2D', 'RigidBody2D', 'StaticBody2D', 'Area2D', 'CollisionShape2D', 'Camera2D', 'AnimationPlayer', 'Timer', 'AudioStreamPlayer', 'Label', 'Button', 'Panel', 'CanvasLayer'];

// Classes de recurso do catálogo (Resource e derivadas) para criar sub-recursos.
export function resourceClasses() {
  const c = ensureCache();
  const names = [...c.classes.values()].filter((cls) => cls.name === 'Resource' || isSubclass(cls.name, 'Resource')).map((cls) => ({ name: cls.name, inherits: cls.inherits ?? '' }));
  if (names.length) return names.sort((a, b) => a.name.localeCompare(b.name));
  return ['Resource', 'Gradient', 'Curve', 'StyleBoxFlat', 'Theme'].map((name) => ({ name, inherits: '' }));
}

export function sceneNodeClasses() {
  const c = ensureCache();
  const names = [...c.classes.values()].filter((cls) => cls.name === 'Node' || isSubclass(cls.name, 'Node')).map((cls) => ({ name: cls.name, inherits: cls.inherits ?? '' }));
  if (names.length) return names.sort((a, b) => a.name.localeCompare(b.name));
  return BASIC_NODE_CLASSES.map((name) => ({ name, inherits: '' }));
}
