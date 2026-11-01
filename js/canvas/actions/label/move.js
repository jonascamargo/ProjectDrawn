import { graphSnapshot } from '../../../core/graphOps.js';
import { t } from '../../../i18n/i18n.js';
import { nearestAlong } from '../../wireGeometry.js';

const DRAG_THRESHOLD = 4;

// Clicar na etiqueta seleciona o fio; arrastar desliza a etiqueta ao longo dele.
export default {
  id: 'label.move',
  area: 'label',
  press: {
    run(c) {
      const { editor, graph: gc, fileId } = c;
      const wireId = c.hit.wireId;
      gc.select(fileId, { wire: wireId });
      const before = structuredClone(editor.project.get(fileId).graph);
      const startScreen = c.screen;
      let dragging = false;
      return {
        move(m) {
          if (!dragging && Math.hypot(m.screen.x - startScreen.x, m.screen.y - startScreen.y) < DRAG_THRESHOLD) return;
          dragging = true;
          const placed = editor.layout?.entries.get(fileId)?.graph?.wires.find((w) => w.wire.id === wireId);
          const wire = editor.project.get(fileId).graph.wires.find((w) => w.id === wireId);
          if (placed && wire?.label) {
            wire.label.at = Math.round(nearestAlong(placed.points, m.world) * 1000) / 1000;
            editor.refresh();
          }
        },
        up() {
          if (!dragging) return;
          const after = structuredClone(editor.project.get(fileId).graph);
          editor.history.execute(graphSnapshot(editor.project, fileId, before, after, t('graph.history.label')));
        },
      };
    },
  },
  hover: {
    run: () => 'grab',
  },
  menu: {
    prepare: (c) => c.graph.select(c.fileId, { wire: c.hit.wireId }),
  },
};
