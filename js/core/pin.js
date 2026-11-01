import { t } from './i18n.js';
import { getWireKind, wireKindLabel } from './wireKinds.js';

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

// Texto da dica do pino (no idioma de ajuda): "dados · number · entrada · até 1 fio".
export function describePin(pin, typeLabel) {
  const parts = [wireKindLabel(pin.kind)];
  if (pin.type) parts.push(typeLabel ?? pin.type);
  parts.push(t(pin.direction === 'in' ? 'pin.in' : 'pin.out'));
  if (pin.max == null) parts.push(t('pin.unlimited'));
  else parts.push(pin.max === 1 ? t('pin.maxOne') : t('pin.maxMany', { n: pin.max }));
  return parts.join(' · ');
}
