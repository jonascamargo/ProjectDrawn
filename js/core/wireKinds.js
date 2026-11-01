// Tipos de fio. O núcleo traz os quatro básicos; outros podem ser registrados.
// maxIn / maxOut: limite padrão de fios num pino de entrada / saída desse tipo (null = sem limite).
// connectsTo: tipos de pino de entrada em que uma saída deste tipo pode ligar.
const kinds = new Map();

export function registerWireKind({ id, label, maxIn = null, maxOut = null, connectsTo = [id] }) {
  kinds.set(id, { id, label, maxIn, maxOut, connectsTo });
}

export function getWireKind(id) {
  const kind = kinds.get(id);
  if (!kind) throw new Error(`Tipo de fio desconhecido: ${id}`);
  return kind;
}

export function wireKinds() {
  return [...kinds.values()];
}

// Uma saída do tipo outKind pode ligar numa entrada do tipo inKind?
export function kindsConnect(outKind, inKind) {
  return getWireKind(outKind).connectsTo.includes(inKind);
}

registerWireKind({ id: 'flow', label: 'fluxo', maxIn: null, maxOut: 1 });
registerWireKind({ id: 'data', label: 'dados', maxIn: 1, maxOut: null });
// Condicional: valor lógico (resultado de comparação, "e", "ou"…) que alimenta uma condição.
registerWireKind({ id: 'condition', label: 'condicional', maxIn: 1, maxOut: null });
registerWireKind({ id: 'config', label: 'configuração', maxIn: null, maxOut: 1 });
