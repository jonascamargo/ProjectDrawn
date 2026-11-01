import { t } from '../../../i18n/i18n.js';
import { getDef } from '../../../lang/nodeRegistry.js';

// Pinos dinâmicos: botão "+" no nó e entradas do menu (adicionar/remover entrada/saída).
export default {
  id: 'node.dynamicPins',
  area: ['node', 'pin'],
  press: {
    when: (c) => c.hit.kind === 'gadd',
    run: (c) => c.graph.addDynamicPin(c.fileId, c.hit.nodeId, c.hit.side),
  },
  hover: {
    when: (c) => c.hit.kind === 'gadd',
    run: () => 'pointer',
  },
  menu: {
    group: 'create',
    order: 10,
    when: (c) => {
      const def = getDef(c.node?.type);
      return Boolean(def?.dynamicInputs || def?.dynamicOutputs);
    },
    items(c) {
      const { graph: gc, fileId, node } = c;
      const def = getDef(node.type);
      const out = [];
      if (def.dynamicInputs) {
        out.push(
          { label: t('graph.menu.addInput'), action: () => gc.addDynamicPin(fileId, node.id, 'in') },
          { label: t('graph.menu.removeInput'), action: () => gc.removeDynamicPin(fileId, node.id, 'in') },
        );
      }
      if (def.dynamicOutputs) {
        out.push(
          { label: t('graph.menu.addOutput'), action: () => gc.addDynamicPin(fileId, node.id, 'out') },
          { label: t('graph.menu.removeOutput'), action: () => gc.removeDynamicPin(fileId, node.id, 'out') },
        );
      }
      return out;
    },
  },
};
