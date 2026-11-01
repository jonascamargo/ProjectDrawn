import { t } from '../../../i18n/i18n.js';

// Adicionar/remover a etiqueta do fio (menu).
const hasLabel = (c) => Boolean(c.graph.graph(c.fileId).wires.find((w) => w.id === c.hit.wireId)?.label);

export default {
  id: 'wire.label',
  area: ['wire', 'label'],
  menu: {
    group: 'main',
    order: 20,
    label: (c) => t(hasLabel(c) ? 'graph.menu.removeLabel' : 'graph.menu.addLabel'),
    run(c) {
      if (hasLabel(c)) c.graph.setWireLabel(c.fileId, c.hit.wireId, null);
      else c.graph.addWireLabel(c.fileId, c.hit.wireId, c.world);
    },
  },
};
