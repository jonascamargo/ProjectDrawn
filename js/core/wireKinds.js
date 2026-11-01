// Tipos de fio. O núcleo traz os quatro básicos; outros podem ser registrados.
// maxIn / maxOut: limite padrão de fios num pino de entrada / saída desse tipo (null = sem limite).
const kinds = new Map();

export function registerWireKind({ id, label, maxIn = null, maxOut = null }) {
  kinds.set(id, { id, label, maxIn, maxOut });
}

export function getWireKind(id) {
  const kind = kinds.get(id);
  if (!kind) throw new Error(`Tipo de fio desconhecido: ${id}`);
  return kind;
}

export function wireKinds() {
  return [...kinds.values()];
}

registerWireKind({ id: 'flow', label: 'fluxo', maxIn: null, maxOut: 1 });
registerWireKind({ id: 'data', label: 'dados', maxIn: 1, maxOut: null });
registerWireKind({ id: 'condition', label: 'condicional', maxIn: null, maxOut: 1 });
registerWireKind({ id: 'config', label: 'configuração', maxIn: null, maxOut: 1 });
