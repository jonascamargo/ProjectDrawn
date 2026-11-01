import { t } from '../../../i18n/i18n.js';

// Destaque do pino sob o mouse e dica com os problemas do nó. Vale para qualquer área
// (fora do grafo limpa o destaque) e não decide o cursor.
export default {
  id: 'script.hoverInfo',
  area: '*',
  priority: 100,
  hover: {
    run(c) {
      const { graph: gc, hit } = c;
      const pin = hit?.kind === 'gpin' ? { fileId: hit.fileId, nodeId: hit.nodeId, pinId: hit.pinId, side: hit.side } : null;
      const changed = pin?.nodeId !== gc.hoverPin?.nodeId || pin?.pinId !== gc.hoverPin?.pinId || pin?.side !== gc.hoverPin?.side;
      gc.hoverPin = pin;
      if (changed) c.editor.renderer.invalidate();
      const issues = hit?.nodeId && hit.kind !== 'gpin' ? c.editor.issuesOf(hit.fileId, hit.nodeId) : null;
      c.canvas.title = issues?.length ? issues.map((i) => `⚠ ${t(i.message, i.params ?? {})}`).join('\n') : '';
      return false;
    },
  },
};
