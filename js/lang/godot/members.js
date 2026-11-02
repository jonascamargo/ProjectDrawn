// Nós de método, de propriedade e de constante da Godot, montados da API (api/members.js e
// api/extras.js) só quando pedidos, e guardados (cada um é montado uma vez). Ids:
//   'm:Classe.método', 'p:Classe.propriedade.get' / '.set' — classes (target: o objeto; sem fio, o script);
//   'b:Tipo.método' — tipos básicos (target: o valor, ex.: o Vector2; sem fio, o digitado);
//   'c:Dono.NOME' — constantes e valores de enum (dono '@GlobalScope' = globais).
// Singletons (ex.: Input) são objetos globais: os métodos deles não têm target.
import { members as table } from './api/members.js';
import { builtinMethods, constants, singletons } from './api/extras.js';
import { types } from './types.js';

const cache = new Map(); // dono → nós dele
let everything = null;
const RESERVED = new Set(['run', 'target']);
const SINGLETONS = new Set(singletons);

// Método: const (só lê) é cálculo, sem fluxo; os outros têm fluxo. static (e de singleton) não tem target.
function methodDef(prefix, owner, [name, args, returns, flags], target) {
  const pure = !!(flags & 2);
  return {
    id: `${prefix}:${owner}.${name}`,
    concept: 'method',
    title: name,
    category: owner,
    inputs: [
      ...(pure ? [] : [{ id: 'run', kind: 'flow' }]),
      ...(flags & 1 || !target ? [] : [target]),
      ...args.map(([arg, type]) => ({ id: RESERVED.has(arg) ? `${arg}_` : arg, label: arg, kind: 'data', type })),
    ],
    outputs: [
      ...(pure ? [] : [{ id: 'next', kind: 'flow' }]),
      ...(returns ? [{ id: 'result', label: 'result', kind: 'data', type: returns }] : []),
    ],
  };
}

// Objeto de uma classe: sem fio, o próprio script (self).
const objectPin = (cls) => ({ id: 'target', label: 'target', kind: 'data', type: cls, self: true });
// Valor de um tipo básico: sem fio, o valor digitado no pino.
const valuePin = (type) => ({ id: 'target', label: 'value', kind: 'data', type });

// Propriedade: get é cálculo (lê do target); set tem fluxo (só se a propriedade é gravável).
function propertyDefs(cls, [name, type, writable], target) {
  const get = {
    id: `p:${cls}.${name}.get`, concept: 'property', title: name, category: cls, tag: type,
    inputs: target ? [target] : [],
    outputs: [{ id: 'value', label: 'value', kind: 'data', type }],
  };
  if (!writable) return [get];
  const set = {
    id: `p:${cls}.${name}.set`, concept: 'property', title: `set ${name}`, category: cls, tag: type,
    inputs: [{ id: 'run', kind: 'flow' }, ...(target ? [target] : []), { id: 'value', label: 'value', kind: 'data', type }],
    outputs: [{ id: 'next', kind: 'flow' }],
  };
  return [get, set];
}

// Constante (ou valor de enum): nó de uma linha com a saída do tipo dela.
function constantDef(owner, [name, type]) {
  return {
    id: `c:${owner}.${name}`, concept: 'constant', title: name, category: owner === '@GlobalScope' ? 'Global' : owner,
    tag: type, compact: true,
    outputs: [{ id: 'value', kind: 'data', type }],
  };
}

// Nós do dono (classe ou tipo básico), sem os das pais: métodos, propriedades e constantes.
function ownDefs(owner) {
  if (!cache.has(owner)) {
    const consts = (constants[owner] ?? []).map((c) => constantDef(owner, c));
    const entry = table[owner];
    if (entry) {
      const target = SINGLETONS.has(owner) ? null : objectPin(owner);
      cache.set(owner, [...entry.m.map((m) => methodDef('m', owner, m, target)), ...entry.p.flatMap((p) => propertyDefs(owner, p, target)), ...consts]);
    } else {
      cache.set(owner, [...(builtinMethods[owner] ?? []).map((m) => methodDef('b', owner, m, valuePin(owner))), ...consts]);
    }
  }
  return cache.get(owner);
}

// Métodos e propriedades do tipo e das pais dela (ex.: CharacterBody2D → … → Object; Vector2: os
// dele). As constantes ficam só na busca geral.
export function chainDefs(base) {
  const out = [];
  for (let c = base; c; c = types[c]?.inherits) out.push(...ownDefs(c).filter((d) => d.concept !== 'constant'));
  return out;
}

// Tudo (para a busca geral): classes, tipos básicos e constantes, inclusive as globais.
export function allDefs() {
  everything ??= [...new Set([...Object.keys(table), ...Object.keys(builtinMethods), ...Object.keys(constants)])].flatMap((o) => ownDefs(o));
  return everything;
}

// Nó pelo id (ao abrir um projeto salvo), ou null.
export function resolve(id) {
  const match = /^[mpbc]:([^.]+)\./.exec(id);
  return match ? ownDefs(match[1]).find((d) => d.id === id) ?? null : null;
}
