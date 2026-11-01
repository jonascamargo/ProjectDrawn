import { shortcuts } from './config/shortcuts.js';
import { Camera } from './core/canvas/camera.js';
import { loadIcons } from './core/canvas/icons.js';
import { CanvasInput } from './core/canvas/input.js';
import { NodeMenu } from './core/canvas/nodeMenu.js';
import { Renderer } from './core/canvas/renderer.js';
import { Selection } from './core/canvas/selection.js';
import { t } from './core/i18n.js';
import { createNode, layoutNode } from './core/node.js';
import { Scene } from './core/scene.js';
import { createAutosave, createIdbStore, deserialize, serialize } from './core/storage.js';
import { firstCompatiblePin } from './core/wires.js';
import { language } from './lang/teste/index.js';
import { theme } from './theme/default.js';
import { Inspector } from './ui/inspector.js';

// Interface em HTML segue o tema: cada valor de theme.ui vira a variável CSS --ui-<nome>.
for (const [name, value] of Object.entries(theme.ui)) document.documentElement.style.setProperty(`--ui-${name}`, value);

// Sem o menu do navegador no clique direito (o do app abre no lugar); nos campos de texto ele fica.
document.addEventListener('contextmenu', (e) => {
  if (!e.target?.closest?.('input, textarea')) e.preventDefault();
});

const canvas = document.getElementById('board');
const camera = new Camera();
const selection = new Selection();
const scene = new Scene({ language, layout: (node) => layoutNode(node, theme, (text, font) => renderer.measure(text, font), language) });
const renderer = new Renderer(canvas, { camera, scene, selection, theme, language });
const store = createIdbStore();
const autosave = createAutosave(store, () => serialize(scene, camera));
const inspector = new Inspector(document.body, {
  scene, selection, language,
  onChange: () => renderer.requestRender(),
});

// Toda mudança passa por um redesenho: aproveita para atualizar o inspetor e agendar o salvamento
// (só depois de abrir o projeto, para não salvar a cena vazia por cima do que estava salvo).
let ready = false;
const draw = renderer.requestRender.bind(renderer);
renderer.requestRender = () => {
  draw();
  inspector.refresh();
  if (ready) autosave.schedule();
};

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
  // O menu fica na página: soma a posição do canvas (o inspetor fica à esquerda dele).
  onNodeMenu: (screen, world, origin) => menu.open(pagePoint(screen), world, origin ? {
    context: origin,
    filter: (def) => !!firstCompatiblePin(createNode(def, { id: -1, x: 0, y: 0 }), origin, language),
  } : {}),
  onToggleInspector: () => inspector.toggle(),
}).attach();

function pagePoint(screen) {
  const r = canvas.getBoundingClientRect();
  return { x: screen.x + r.left, y: screen.y + r.top };
}

// Dica de atalhos: teclas de js/config/shortcuts.js, textos do idioma.
const keyName = (k) => {
  const text = t(`key.${k}`);
  return text === `key.${k}` ? k : text;
};
const hint = document.querySelector('.hint');
const mouseLines = Object.entries(shortcuts.mouse).map(([action, m]) => [keyName(m.key ?? m.button ?? m.modifier), t(`shortcut.${action}`)]);
const keyLines = Object.entries(shortcuts.keys).map(([action, k]) => [k.combos.map(keyName).join(' / '), t(`shortcut.${action}`)]);
hint.replaceChildren(...[[keyName('wheel'), t('shortcut.zoom')], ...mouseLines, ...keyLines].map(([key, label]) => {
  const line = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = key;
  line.append(b, `: ${label}`);
  return line;
}));

// A fonte e os ícones precisam estar carregados antes de medir os nós (senão o tamanho sai errado).
try {
  await Promise.all(theme.fonts.map((font) => document.fonts?.load(font)));
} catch {
  // sem a fonte, segue com a reserva (monospace)
}
await loadIcons(language.icons);

// Abre o projeto salvo; na primeira vez, um nó de cada para experimentar.
let saved = null;
try {
  saved = await store.load();
} catch (error) {
  console.error(error);
}
if (saved) {
  deserialize(saved, { scene, camera, language });
} else {
  [
    ['start', 60, 60], ['call', 300, 60], ['repeat', 560, 60], ['print', 860, 60],
    ['if', 60, 260], ['greater', 300, 260], ['and', 560, 260], ['add', 860, 260],
    ['variable', 60, 460], ['to_text', 360, 460], ['number', 620, 460], ['text', 860, 460],
  ].forEach(([id, x, y]) => scene.addNode(language.node(id), { x, y }));
}
ready = true;
window.addEventListener('pagehide', () => autosave.flush());

new ResizeObserver(() => renderer.resize(canvas.clientWidth, canvas.clientHeight)).observe(canvas);
renderer.requestRender();

// Para depuração no console e para os testes.
export const app = { camera, scene, selection, renderer, menu, inspector, store, autosave };
