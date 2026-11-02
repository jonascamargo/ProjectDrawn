import { shortcuts } from './config/shortcuts.js';
import { Camera } from './core/canvas/camera.js';
import { loadIcons } from './core/canvas/icons.js';
import { ContextMenu } from './core/canvas/contextMenu.js';
import { CanvasInput } from './core/canvas/input.js';
import { NodeMenu } from './core/canvas/nodeMenu.js';
import { Renderer } from './core/canvas/renderer.js';
import { Selection } from './core/canvas/selection.js';
import { t } from './core/i18n.js';
import { createNode, layoutNode, pinScope } from './core/node.js';
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
const scene = new Scene({
  language,
  areaPad: theme.area.pad,
  layout: (node) => layoutNode(node, theme, (text, font) => renderer.measure(text, font), language),
});
const renderer = new Renderer(canvas, { camera, scene, selection, theme, language });
const store = createIdbStore();
const autosave = createAutosave(store, () => serialize(scene, camera));
const inspector = new Inspector(document.body, {
  scene, selection, language, defaultColor: theme.area.defaultColor,
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
  onPick: (def, world, context) => {
    const { origin = null, scope } = context ?? {};
    const node = scene.addNode(def, { ...world, scope });
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
// Clique direito num pino: abrir (Split) ou fechar (Recombine) os componentes.
const contextMenu = new ContextMenu(document.body);
function pinMenu(screen, { node, pin }) {
  const parent = pin.parent != null ? node[pin.direction === 'in' ? 'inputs' : 'outputs'].find((p) => p.id === pin.parent) : null;
  const items = [];
  if (scene.canSplit(node, pin)) items.push({ label: 'Split', run: () => scene.splitPin(node, pin) });
  if (parent) items.push({ label: 'Recombine', run: () => scene.recombinePin(node, parent) });
  if (!items.length) return;
  contextMenu.open(pagePoint(screen), items.map((item) => ({ ...item, run: () => { item.run(); renderer.requestRender(); } })));
}

new CanvasInput(canvas, {
  camera, scene, selection, renderer, theme, shortcuts,
  // O menu fica na página: soma a posição do canvas (o inspetor fica à esquerda dele).
  // O nó nasce na área do ponto (ou na do fio solto) e o menu só mostra o que essa área aceita.
  onNodeMenu: (screen, world, origin) => {
    const scope = origin ? pinScope(origin.node) : scene.scopeAt(world);
    const fits = (def) => scene.accepts(scope, def);
    const linkable = (def) => !!firstCompatiblePin(createNode(def, { id: -1, x: 0, y: 0, scope }), origin, language);
    menu.open(pagePoint(screen), world, {
      context: { origin, scope },
      filter: origin ? (def) => fits(def) && linkable(def) : fits,
    });
  },
  onToggleInspector: () => inspector.toggle(),
  onPinMenu: pinMenu,
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
await loadIcons(theme.area.toggleIcons);

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
  // Exemplo: res / (assets, player.gd com _ready → Print, enemy.gd, data.json).
  const add = (id, x, y, scope, name) => scene.addNode(language.node(id), { x, y, scope, values: name ? { name } : undefined });
  const res = add('folder', 60, 60, undefined, 'res');
  add('folder', 80, 120, res.id, 'assets');
  const player = add('file', 80, 200, res.id, 'player.gd');
  const ready = add('function', 100, 260, player.id, '_ready');
  const print = add('print', 120, 320, ready.id);
  scene.connect({ node: ready, pin: ready.outputs[0] }, { node: print, pin: print.inputs[0] });
  add('file', 520, 120, res.id, 'enemy.gd');
  add('file', 520, 260, res.id, 'data.json');
}
ready = true;
window.addEventListener('pagehide', () => autosave.flush());

new ResizeObserver(() => renderer.resize(canvas.clientWidth, canvas.clientHeight)).observe(canvas);
renderer.requestRender();

// Para depuração no console e para os testes.
export const app = { camera, scene, selection, renderer, menu, contextMenu, inspector, store, autosave };
