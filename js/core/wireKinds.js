import { t } from './i18n.js';

// Tipos de fio. O núcleo traz os quatro básicos; outros podem ser registrados.
// O nome mostrado na ajuda vem do idioma ('wireKind.<id>'); label é a reserva sem tradução.
// maxIn / maxOut: limite padrão de fios num pino de entrada / saída desse tipo (null = sem limite).
// connectsTo: tipos de pino de entrada em que uma saída deste tipo pode ligar.
const kinds = new Map();

export function registerWireKind({ id, label = id, maxIn = null, maxOut = null, connectsTo = [id] }) {
  kinds.set(id, { id, label, maxIn, maxOut, connectsTo });
}

export function getWireKind(id) {
  const kind = kinds.get(id);
  if (!kind) throw new Error(`Tipo de fio desconhecido: ${id}`);
  return kind;
}

export function wireKindLabel(id) {
  const text = t(`wireKind.${id}`);
  return text === `wireKind.${id}` ? getWireKind(id).label : text;
}

// Uma saída do tipo outKind pode ligar numa entrada do tipo inKind?
export function kindsConnect(outKind, inKind) {
  return getWireKind(outKind).connectsTo.includes(inKind);
}

registerWireKind({ id: 'flow', label: 'flow', maxIn: null, maxOut: 1 });
// Dado liga também em condicional (qualquer valor vale como condição, como na GDScript: não zero,
// não vazio, não null).
registerWireKind({ id: 'data', label: 'data', maxIn: 1, maxOut: null, connectsTo: ['data', 'condition'] });
// Condicional: valor lógico (resultado de comparação, "e", "ou"…) que alimenta uma condição; liga
// também numa entrada de dado que aceita bool (ex.: var ok = a > b).
registerWireKind({ id: 'condition', label: 'condition', maxIn: 1, maxOut: null, connectsTo: ['condition', 'data'] });
registerWireKind({ id: 'config', label: 'config', maxIn: null, maxOut: 1 });
