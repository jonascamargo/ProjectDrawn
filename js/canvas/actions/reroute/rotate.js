import { graphSnapshot } from '../../../core/graphOps.js';
import { t } from '../../../i18n/i18n.js';

const STEP = 15;
const FINE_STEP = 1;
const PIXELS_PER_STEP = 50;
const COMMIT_DELAY = 400;

// Alt + girar a roda sobre o reroute: gira a direção do fio em passos de 15° (Shift + Alt:
// 1°). O ângulo fica salvo no nó (node.angle); "Direção automática" no menu volta ao padrão.
// Vários giros seguidos viram um só passo no histórico.
let pending = null;
let accumulated = 0;

export default {
  id: 'reroute.rotate',
  area: 'reroute',
  wheel: {
    when: (c) => c.mods.alt,
    run(c) {
      const event = c.event;
      // Shift pode transformar a roda em rolagem horizontal; deltaMode 1 = linhas.
      const raw = event.deltaY || event.deltaX;
      const steps = event.deltaMode === 1 ? Math.sign(raw) : takeSteps(raw);
      if (!steps) return;
      const { editor, fileId } = c;
      const nodeId = c.node.id;
      if (pending && (pending.fileId !== fileId || pending.nodeId !== nodeId)) commit(editor);
      const item = editor.project.get(fileId);
      pending ??= { fileId, nodeId, before: structuredClone(item.graph) };
      const node = item.graph.nodes.find((n) => n.id === nodeId);
      const placed = editor.layout?.entries.get(fileId)?.graph?.nodes.get(nodeId);
      const current = typeof node.angle === 'number' ? node.angle : placed?.dir ? (Math.atan2(placed.dir.y, placed.dir.x) * 180) / Math.PI : 0;
      const step = c.mods.shift ? FINE_STEP : STEP;
      const next = Math.round((current + steps * step) / step) * step;
      node.angle = ((next % 360) + 360) % 360;
      editor.refresh();
      clearTimeout(pending.timer);
      pending.timer = setTimeout(() => commit(editor), COMMIT_DELAY);
    },
  },
  menu: {
    group: 'main',
    order: 10,
    when: (c) => typeof c.node?.angle === 'number',
    label: 'graph.menu.autoDirection',
    run: (c) => c.graph.updateNode(c.fileId, c.node.id, (n) => {
      delete n.angle;
    }, t('graph.history.rerouteDirection')),
  },
};

// Cada "girada" da roda é um passo; touchpad manda muitos eventos pequenos, que somam até
// completar um passo.
function takeSteps(delta) {
  if (Math.abs(delta) >= PIXELS_PER_STEP) return Math.sign(delta);
  accumulated += delta;
  const steps = Math.trunc(accumulated / PIXELS_PER_STEP);
  accumulated -= steps * PIXELS_PER_STEP;
  return steps;
}

function commit(editor) {
  const done = pending;
  pending = null;
  accumulated = 0;
  clearTimeout(done.timer);
  const item = editor.project.get(done.fileId);
  if (!item?.graph) return;
  const after = structuredClone(item.graph);
  editor.history.execute(graphSnapshot(editor.project, done.fileId, done.before, after, t('graph.history.rerouteDirection')));
}
