import { getWireKind } from './wireKinds.js';

// Pino a partir da definição da linguagem: { id, label, kind, type, max }.
//   kind: tipo de fio ('flow', 'data'…); type: tipo de dado (só para fios que levam dado);
//   max: limite de fios (se omitido, vem do tipo de fio; null = sem limite).
export function createPin(def, direction) {
  const kind = getWireKind(def.kind);
  const fallback = direction === 'in' ? kind.maxIn : kind.maxOut;
  return {
    id: def.id,
    label: def.label ?? '',
    kind: kind.id,
    type: def.type ?? null,
    direction,
    max: def.max === undefined ? fallback : def.max,
  };
}

// Texto da dica do pino: "dados · número · entrada · até 1 fio".
export function describePin(pin, typeLabel) {
  const parts = [getWireKind(pin.kind).label];
  if (pin.type) parts.push(typeLabel ?? pin.type);
  parts.push(pin.direction === 'in' ? 'entrada' : 'saída');
  parts.push(pin.max == null ? 'fios sem limite' : `até ${pin.max} ${pin.max === 1 ? 'fio' : 'fios'}`);
  return parts.join(' · ');
}
