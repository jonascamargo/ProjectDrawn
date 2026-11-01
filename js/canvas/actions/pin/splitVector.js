import { t } from '../../../i18n/i18n.js';
import { findPin, pinType, resolveTypes, vectorAxes } from '../../../core/graph.js';

// Pino de entrada de vetor (Vector3, vec2…): "Separar eixos" (um pino por eixo, aceita float)
// e "Juntar eixos" no pino separado.
const info = (c) => {
  const node = c.node;
  if (!node || c.hit.kind !== 'gpin' || c.hit.side !== 'in') return null;
  const graph = c.graph.graph(c.fileId);
  const pin = findPin(node, c.hit.pinId, 'in', graph);
  if (pin?.splitOf) return { join: pin.splitOf };
  const type = pin && pin.kind === 'data' ? pinType(node, pin, resolveTypes(graph)) : null;
  const resolved = !type || type === '$T' || type === 'Variant' ? node.fields?.type : type;
  return vectorAxes(resolved) ? { split: pin.id, type: resolved } : null;
};

export default {
  id: 'pin.splitVector',
  area: 'pin',
  menu: {
    group: 'main',
    order: 30,
    when: (c) => Boolean(info(c)),
    label: (c) => t(info(c).join ? 'graph.menu.joinAxes' : 'graph.menu.splitAxes'),
    run(c) {
      const i = info(c);
      if (i.join) c.graph.setSplit(c.fileId, c.node.id, i.join, null);
      else c.graph.setSplit(c.fileId, c.node.id, i.split, i.type);
    },
  },
};
