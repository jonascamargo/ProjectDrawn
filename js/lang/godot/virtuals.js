// Métodos virtuais (que uma Function sobrescreve pelo nome) de uma classe da Godot e das pais dela,
// da mais próxima para a mais de fora, sem repetir nome. Da API gerada (api/virtuals.js).
import { virtuals as table } from './api/virtuals.js';
import { types } from './types.js';

export function virtuals(base) {
  const out = [];
  const seen = new Set();
  for (let c = base; c; c = types[c]?.inherits) {
    for (const [name, args, returns] of table[c] ?? []) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, params: args.map(([n, type]) => ({ name: n, type })), returns: returns ?? null });
    }
  }
  return out;
}
