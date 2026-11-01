import { shortcuts } from './config/shortcuts.js';
import { Camera } from './core/canvas/camera.js';
import { CanvasInput } from './core/canvas/input.js';
import { NodeMenu } from './core/canvas/nodeMenu.js';
import { Renderer } from './core/canvas/renderer.js';
import { Selection } from './core/canvas/selection.js';
import { createNode, layoutNode } from './core/node.js';
import { Scene } from './core/scene.js';
import { firstCompatiblePin } from './core/wires.js';
import { language } from './lang/teste/index.js';
import { theme } from './theme/default.js';

const canvas = document.getElementById('board');
const camera = new Camera();
const selection = new Selection();
const scene = new Scene({ language, layout: (node) => layoutNode(node, theme, (text, font) => renderer.measure(text, font)) });
const renderer = new Renderer(canvas, { camera, scene, selection, theme, language });
const menu = new NodeMenu(document.body, {
  language,
  onPick: (def, world, origin) => {
    const node = scene.addNode(def, world);
    // Veio de um fio solto no vazio: o pino compatível fica no ponto e já nasce ligado.
    const pin = origin && firstCompatiblePin(node, origin, language);
    if (pin) {
      node.x = world.x - pin.cx;
      node.y = world.y - pin.cy;
      scene.connect(origin, { node, pin });
    }
    selection.set([node.id]);
    renderer.requestRender();
  },
});
new CanvasInput(canvas, {
  camera, scene, selection, renderer, theme, shortcuts,
  onNodeMenu: (screen, world, origin) => menu.open(screen, world, origin ? {
    context: origin,
    filter: (def) => !!firstCompatiblePin(createNode(def, { id: -1, x: 0, y: 0 }), origin, language),
  } : {}),
}).attach();

// Um nó de cada, para experimentar.
[['start', 60, 60], ['print', 280, 60], ['if', 520, 60], ['add', 60, 240], ['variable', 280, 240], ['to_text', 520, 240]]
  .forEach(([id, x, y]) => scene.addNode(language.node(id), { x, y }));

// Dica de atalhos, montada a partir de js/config/shortcuts.js.
const NAMES = { Space: 'Espaço', left: 'Botão esquerdo', middle: 'Botão do meio', right: 'Botão direito' };
const name = (k) => NAMES[k] ?? k;
const hint = document.querySelector('.hint');
const mouseLines = Object.values(shortcuts.mouse).map((m) => [name(m.key ?? m.button ?? m.modifier), m.label]);
const keyLines = Object.values(shortcuts.keys).map((k) => [k.combos.map(name).join(' / '), k.label]);
hint.replaceChildren(...[['Roda', 'zoom'], ...mouseLines, ...keyLines].map(([key, label]) => {
  const line = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = key;
  line.append(b, `: ${label}`);
  return line;
}));

new ResizeObserver(() => renderer.resize(canvas.clientWidth, canvas.clientHeight)).observe(canvas);

// Para depuração no console e para os testes.
export const app = { camera, scene, selection, renderer, menu };
