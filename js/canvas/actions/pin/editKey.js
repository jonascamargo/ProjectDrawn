import { openInlineEditor } from '../../../ui/inlineEditor.js';

// Chave de objeto (JSON): clicar no nome da linha edita a chave; no menu do pino, remover.
const keyIdOf = (c) => c.hit.keyId ?? (c.hit.pinId?.startsWith('k:') ? c.hit.pinId.slice(2) : null);

export default {
  id: 'pin.editKey',
  area: 'pin',
  press: {
    when: (c) => c.hit.kind === 'gkey',
    run(c) {
      editKey(c);
    },
  },
  hover: {
    when: (c) => c.hit.kind === 'gkey',
    run: () => 'text',
  },
  menu: {
    group: 'main',
    order: 20,
    when: (c) => Boolean(keyIdOf(c)),
    label: 'graph.menu.removeKey',
    run: (c) => c.graph.setKey(c.fileId, c.hit.nodeId, keyIdOf(c), null),
  },
};

async function editKey({ editor, camera, canvas, graph: gc, fileId, hit, node }) {
  const key = node?.keys?.find((k) => k.id === hit.keyId);
  if (!key) return;
  const topLeft = camera.worldToScreen(hit.box.x, hit.box.y);
  const text = await openInlineEditor({
    container: canvas.parentElement,
    rect: { x: topLeft.x, y: topLeft.y - 2, w: hit.box.w * camera.zoom + 60, h: hit.box.h * camera.zoom + 4 },
    value: key.name,
  });
  if (text === null || text === key.name) return;
  gc.setKey(fileId, node.id, key.id, text);
  editor.renderer.invalidate();
}
