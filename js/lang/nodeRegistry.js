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

let cache = { profile: null, catalogs: null, defs: new Map(), classes: new Map(), builtins: new Map(), search: null };

function ensureCache() {
  const profile = currentProfile();
  const catalogs = currentCatalogs();
  if (cache.profile === profile && cache.catalogs === catalogs) return cache;
  const defs = new Map();
  for (const def of CORE_NODES) defs.set(def.id, def);
  for (const def of profile?.nodes ?? []) defs.set(def.id, def);
  const classes = new Map();
  const builtins = new Map();
  for (const catalog of catalogs) {
    for (const cls of catalog.classes ?? []) classes.set(cls.name, cls);
    for (const b of catalog.builtinTypes ?? []) builtins.set(b.name, b);
  }
  cache = { profile, catalogs, defs, classes, builtins, search: null };
  return cache;
}

// ---------- definições ----------

export function getDef(id) {
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
//      cat.util:nome · cat.ctor:Tipo#indice
function generateCatalogDef(id, c) {
  const match = id.match(/^cat\.(\w+):(.+)$/);
  if (!match) return null;
  const [, kind, ref] = match;
  const dot = ref.lastIndexOf('.');
  const owner = ref.slice(0, dot);
  const member = ref.slice(dot + 1);
  const cls = c.classes.get(owner);
  // Alvo sem fio = self (o método é do próprio objeto do script).
  const target = { id: 'target', kind: 'data', type: owner, label: 'alvo', default: 'self' };
  const category = `Catálogo/${owner}`;

  if (kind === 'call') {
    const m = cls?.methods?.find((x) => x.name === member) ?? c.builtins.get(owner)?.methods?.find((x) => x.name === member);
    if (!m) return null;
    const pure = Boolean(m.const);
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
  return null;
}

// Entradas para a busca de nós: [{ id, title, subtitle, category, keywords, pins: { in: [{kind,type}], out: [...] } }]
export function searchEntries() {
  const c = ensureCache();
  if (c.search) return c.search;
  const entries = [];
  const pinSummary = (def) => ({
    in: (def.inputs ?? []).map((p) => ({ kind: p.kind, type: p.type })),
    out: (def.outputs ?? []).map((p) => ({ kind: p.kind, type: p.type })),
  });
  for (const def of c.profile?.nodes ?? []) {
    entries.push({ id: def.id, title: def.title, category: def.category, keywords: def.keywords ?? [], pins: pinSummary(def), template: def.template });
  }
  const lazy = (id, title, subtitle, category, keywords, pins) => entries.push({ id, title, subtitle, category, keywords, pins, catalog: true });
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
  if (type === 'Array' || elementType(type)) return 'grid';
  if (type === 'Dictionary') return 'braces';
  return 'circle';
}

// Compatibilidade estrita: mesmo tipo, Variant/genérico aberto, Array[X] → Array, subclasse → base.
export function typesCompatible(outType, inType) {
  if (!outType || !inType) return true;
  if (outType === '$T' || inType === '$T' || outType === 'Variant' || inType === 'Variant') return true;
  if (outType === inType) return true;
  if (inType === 'Array' && elementType(outType)) return true;
  const outEl = elementType(outType);
  const inEl = elementType(inType);
  if (outEl && inEl) return typesCompatible(outEl, inEl);
  return isSubclass(outType, inType);
}
