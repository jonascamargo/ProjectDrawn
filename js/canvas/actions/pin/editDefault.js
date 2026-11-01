import { findPin, readGraph } from '../../../core/graph.js';
import { t } from '../../../i18n/i18n.js';
import { openInlineEditor } from '../../../ui/inlineEditor.js';

// Clique no valor de um pino sem fio: bool alterna; os outros abrem um campo sobre o canvas.
export default {
  id: 'pin.editDefault',
  area: 'pin',
  press: {
    when: (c) => c.hit.kind === 'gdefault',
    run: (c) => {
      editDefault(c);
    },
  },
  hover: {
    when: (c) => c.hit.kind === 'gdefault',
    run: () => 'text',
  },
};

async function editDefault({ editor, camera, canvas, fileId, hit }) {
  const graph = readGraph(editor.project.get(fileId));
  const node = graph.nodes.find((n) => n.id === hit.nodeId);
  const pin = node && findPin(node, hit.pinId, 'in', graph);
  if (!pin) return;
  const current = node.defaults?.[pin.id] ?? pin.default;

  if (pin.type === 'bool') {
    editor.graph.updateNode(fileId, node.id, (n) => {
      n.defaults = { ...n.defaults, [pin.id]: !current };
    }, t('graph.history.default'));
    return;
  }
  const topLeft = camera.worldToScreen(hit.box.x, hit.box.y);
  const text = await openInlineEditor({
    container: canvas.parentElement,
    rect: { x: topLeft.x, y: topLeft.y - 2, w: hit.box.w * camera.zoom + 40, h: hit.box.h * camera.zoom + 4 },
    value: current === undefined || current === null ? '' : typeof current === 'string' ? current : JSON.stringify(current),
  });
  if (text === null) return;
  editor.graph.updateNode(fileId, node.id, (n) => {
    n.defaults = { ...n.defaults };
    const value = parseDefault(text, pin.type);
    if (value === undefined) delete n.defaults[pin.id];
    else n.defaults[pin.id] = value;
  }, t('graph.history.default'));
}

function parseDefault(text, type) {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (type === 'int') return Number.isNaN(parseInt(trimmed, 10)) ? trimmed : parseInt(trimmed, 10);
  if (type === 'float') return Number.isNaN(parseFloat(trimmed)) ? trimmed : parseFloat(trimmed);
  return trimmed;
}
