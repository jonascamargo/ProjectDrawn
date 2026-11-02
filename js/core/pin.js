import { t } from './i18n.js';
import { getWireKind, wireKindLabel } from './wireKinds.js';

// Pino a partir da definição da linguagem: { id, label, kind, type, max, when }.
//   kind: tipo de fio ('flow', 'data'…); type: tipo de dado (só para fios que levam dado);
//   max: limite de fios (se omitido, vem do tipo de fio; null = sem limite);
//   when: id de um campo checkbox do nó — o pino só aparece com ele marcado (ex.: pinos de fluxo opcionais);
//   self: entrada do objeto (target) que, sem fio, é o próprio script.
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
    when: def.when ?? null,
    self: !!def.self,
  };
}

// Texto da dica do pino (no idioma de ajuda): "dados · float · entrada · até 1 fio".
export function describePin(pin, typeLabel) {
  const parts = [wireKindLabel(pin.kind)];
  if (pin.type) parts.push(typeLabel ?? pin.type);
  parts.push(t(pin.direction === 'in' ? 'pin.in' : 'pin.out'));
  if (pin.max == null) parts.push(t('pin.unlimited'));
  else parts.push(pin.max === 1 ? t('pin.maxOne') : t('pin.maxMany', { n: pin.max }));
  return parts.join(' · ');
}
