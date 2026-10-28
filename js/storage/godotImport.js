import { StorageError } from './migrations.js';

// Converte o extension_api.json da Godot (gerado com `godot --dump-extension-api`)
// num catálogo compacto. Classes de editor (api_type 'editor') ficam de fora.

// Cores por família: a classe herda a cor da família mais próxima na herança.
const DEFAULT_FAMILIES = [
  { name: 'Object', color: '#3498db' },
  { name: 'Node', color: '#4f8cff' },
  { name: 'Node2D', color: '#5fa8ff' },
  { name: 'Node3D', color: '#ff7a59' },
  { name: 'Control', color: '#3fb97a' },
  { name: 'Resource', color: '#e0a43a' },
  { name: 'RefCounted', color: '#9b6dff' },
];

// 'typedarray::Node' → Array[Node]; 'enum::Node.ProcessMode' → int (enum Node.ProcessMode)
export function normalizeType(raw) {
  if (!raw) return { type: 'void' };
  if (raw.startsWith('typedarray::')) return { type: `Array[${raw.slice(12)}]` };
  if (raw.startsWith('enum::')) return { type: 'int', enum: raw.slice(6) };
  if (raw.startsWith('bitfield::')) return { type: 'int', bitfield: raw.slice(10) };
  if (raw === 'Nil') return { type: 'Variant' };
  // Propriedades com várias classes possíveis: "Texture2D,CanvasTexture" → primeira.
  if (raw.includes(',')) return { type: raw.split(',')[0], alternatives: raw.split(',') };
  return { type: raw };
}

function arg(a) {
  const out = { name: a.name, ...normalizeType(a.type) };
  if (a.default_value !== undefined) out.default = a.default_value;
  return out;
}

function method(m) {
  const out = {
    name: m.name,
    args: (m.arguments ?? []).map(arg),
    returns: normalizeType(m.return_value?.type ?? m.return_type).type,
  };
  if (m.is_const) out.const = true;
  if (m.is_static) out.static = true;
  if (m.is_virtual) out.virtual = true;
  if (m.is_vararg) out.vararg = true;
  return out;
}

function enums(list) {
  return (list ?? []).map((e) => ({
    name: e.name,
    ...(e.is_bitfield ? { bitfield: true } : {}),
    values: (e.values ?? []).map((v) => ({ name: v.name, value: v.value })),
  }));
}

export function looksLikeGodotApi(json) {
  return Boolean(json?.header?.version_major && Array.isArray(json.classes));
}

export function convertGodotApi(json) {
  if (!looksLikeGodotApi(json)) throw new StorageError('notGodotApi');
  const h = json.header;
  const engineVersion = `${h.version_major}.${h.version_minor}${h.version_patch ? `.${h.version_patch}` : ''}`;

  const classes = json.classes
    .filter((c) => c.api_type !== 'editor')
    .map((c) => {
      const out = { name: c.name };
      if (c.inherits) out.inherits = c.inherits;
      if (c.is_instantiable === false) out.abstract = true;
      if (c.is_refcounted) out.refcounted = true;
      const properties = (c.properties ?? []).map((p) => ({ name: p.name, ...normalizeType(p.type) }));
      const methods = (c.methods ?? []).map(method);
      const signals = (c.signals ?? []).map((s) => ({ name: s.name, args: (s.arguments ?? []).map(arg) }));
      const classEnums = enums(c.enums);
      const constants = (c.constants ?? []).map((k) => ({ name: k.name, value: k.value }));
      if (properties.length) out.properties = properties;
      if (methods.length) out.methods = methods;
      if (signals.length) out.signals = signals;
      if (classEnums.length) out.enums = classEnums;
      if (constants.length) out.constants = constants;
      return out;
    });

  // Classes de editor removidas podem ser base de outras: sobe até uma base existente.
  const names = new Set(classes.map((c) => c.name));
  const allByName = new Map(json.classes.map((c) => [c.name, c]));
  for (const cls of classes) {
    let base = cls.inherits;
    while (base && !names.has(base)) base = allByName.get(base)?.inherits;
    if (base) cls.inherits = base;
    else delete cls.inherits;
  }

  const builtinTypes = (json.builtin_classes ?? []).map((b) => {
    const out = { name: b.name };
    const members = (b.members ?? []).map((m) => ({ name: m.name, ...normalizeType(m.type) }));
    const constructors = (b.constructors ?? []).map((k) => ({ args: (k.arguments ?? []).map(arg) }));
    const methods = (b.methods ?? []).map(method);
    const constants = (b.constants ?? []).map((k) => ({ name: k.name, type: k.type, value: k.value }));
    if (members.length) out.members = members;
    if (constructors.length) out.constructors = constructors;
    if (methods.length) out.methods = methods;
    if (constants.length) out.constants = constants;
    if (b.enums?.length) out.enums = enums(b.enums);
    return out;
  });

  return {
    engine: 'godot',
    engineVersion,
    families: DEFAULT_FAMILIES.filter((f) => names.has(f.name)),
    classes,
    builtinTypes,
    utilityFunctions: (json.utility_functions ?? []).map((f) => ({ ...method(f), category: f.category })),
    singletons: (json.singletons ?? []).map((s) => ({ name: s.name, type: s.type })),
    globalEnums: enums(json.global_enums),
  };
}
