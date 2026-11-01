import { t } from '../../../i18n/i18n.js';
import { toast } from '../../../ui/toast.js';
import { SYMBOL_DRAG_TYPE } from '../../../ui/projectOutline.js';

export const NODE_DRAG_TYPE = 'application/x-projectdrawn-node';

// Soltar vindo do painel lateral: definição de nó ou símbolo da aba Projeto.
export default {
  id: 'script.dropFromPanel',
  area: '*',
  drop: {
    accepts: (data) => {
      const types = data?.types ?? [];
      return types.includes(NODE_DRAG_TYPE) || types.includes(SYMBOL_DRAG_TYPE);
    },
    run(c) {
      const data = c.event.dataTransfer;
      const defId = data.getData(NODE_DRAG_TYPE);
      const symbol = data.getData(SYMBOL_DRAG_TYPE);
      if (!c.fileId) {
        toast.info(t('graph.dropInsideScript'));
        return;
      }
      if (symbol) c.graph.dropSymbol(c.fileId, JSON.parse(symbol), c.world, c.mods.alt);
      else if (defId) c.graph.addNode(c.fileId, defId, c.world);
    },
  },
};
