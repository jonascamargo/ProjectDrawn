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
import { Languages } from './core/languages.js';
import { createAutosave, createIdbStore, deserialize, serialize } from './core/storage.js';
import { firstCompatiblePin } from './core/wires.js';
import { language as gdscript } from './lang/godot/index.js';
import { language as teste2 } from './lang/teste2/index.js';
import { theme } from './theme/default.js';
import { Inspector } from './ui/inspector.js';
import { NativesPanel } from './ui/nativesPanel.js';

// Interface em HTML segue o tema: cada valor de theme.ui vira a variável CSS --ui-<nome>.
for (const [name, value] of Object.entries(theme.ui)) document.documentElement.style.setProperty(`--ui-${name}`, value);

// Sem o menu do navegador no clique direito (o do app abre no lugar); nos campos de texto ele fica.
document.addEventListener('contextmenu', (e) => {
  if (!e.target?.closest?.('input, textarea')) e.preventDefault();
});

const canvas = document.getElementById('board');
const camera = new Camera();
const selection = new Selection();
// Linguagens do app: a do arquivo vem da extensão (.gd → GDScript, .gdshader → Teste 2 até a etapa 6).
const languages = new Languages([gdscript, teste2]);
const scene = new Scene({
  languages,
  areaPad: theme.area.pad,
  layout: (node) => layoutNode(node, theme, (text, font) => renderer.measure(text, font), languages.of(node)),
});
const renderer = new Renderer(canvas, { camera, scene, selection, theme });
const store = createIdbStore();
const autosave = createAutosave(store, () => serialize(scene, camera));
// Arrastar do painel para o canvas: um parâmetro (do inspetor da função) vira o nó dele; um método
// nativo (da aba de métodos) vira a função dele. Nasce no ponto, na área do ponto, se cabe ali.
let panelDrag = null;
const startDrag = (create) => {
  panelDrag = create;
  document.body.classList.toggle('dragging-item', true);
};
const inspector = new Inspector(document.body, {
  scene, selection, defaultColor: theme.area.defaultColor,
  onChange: () => renderer.requestRender(),
  onDragParam: (fn, param) => startDrag((world, scope) => scene.addParameter(fn, param.id, world, scope)),
});
const natives = new NativesPanel({
  languages,
  typePicker: inspector.typePicker,
  onDragNative: (language, native) => startDrag((world, scope) => scene.addNative(language.id, native.name, world, scope)),
});
inspector.addTab('Native methods', natives.el);
document.addEventListener('pointerup', (e) => {
  if (!panelDrag) return;
  const create = panelDrag;
  panelDrag = null;
  document.body.classList.toggle('dragging-item', false);
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  if (x < 0 || y < 0 || x > canvas.clientWidth || y > canvas.clientHeight) return;
  const world = camera.toWorld(x, y);
  const node = create(world, scene.scopeAt(world));
  if (!node) return;
  scene.fitAreas();
  selection.set([node.id]);
  renderer.requestRender();
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
  onPick: (def, world, context) => {
    const { origin = null, scope } = context ?? {};
    const node = scene.addFromMenu(def, world, scope);
    // Veio de um fio solto no vazio: o pino compatível fica no ponto e já nasce ligado.
    const pin = origin && firstCompatiblePin(node, origin, languages.of(origin.node));
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
  // O nó nasce na área do ponto (ou na do fio solto) e o menu só mostra o que essa área aceita
  // (num script, os nós da linguagem dele).
  onNodeMenu: (screen, world, origin) => {
    const scope = origin ? pinScope(origin.node) : scene.scopeAt(world);
    const defs = scene.menuDefs(scope, origin?.pin.direction === 'out' ? origin : null);
    const linkable = (def) => !!firstCompatiblePin(createNode(def, { id: -1, x: 0, y: 0, scope }), origin, languages.of(origin.node));
    menu.open(pagePoint(screen), world, {
      context: { origin, scope },
      defs: origin ? defs.filter(linkable) : defs,
    });
  },
  onToggleInspector: () => inspector.toggle(),
  onToggleHint: () => toggleHint(),
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
// Lista de atalhos: escondida no começo; o botão (ou Alt+H) mostra e esconde.
hint.hidden = true;
const hintButton = document.createElement('button');
hintButton.type = 'button';
hintButton.className = 'hint-toggle';
hintButton.textContent = '⌨ Shortcuts';
hintButton.title = t('hint.toggle');
hintButton.addEventListener('click', () => toggleHint());
document.body.append(hintButton);
function toggleHint() {
  hint.hidden = !hint.hidden;
  hintButton.classList.toggle('active', !hint.hidden);
}
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
await loadIcons(languages.icons());
await loadIcons(theme.area.toggleIcons);

// Abre o projeto salvo; na primeira vez, um nó de cada para experimentar.
let saved = null;
try {
  saved = await store.load();
} catch (error) {
  console.error(error);
}
if (saved) {
  deserialize(saved, { scene, camera });
} else {
  // Exemplo: res / (assets, player.gd com _ready → Print, enemy.gd, data.json).
  const add = (id, x, y, scope, name) => scene.addNode(languages.def(id), { x, y, scope, values: name ? { name } : undefined });
  const res = add('folder', 60, 60, undefined, 'res');
  add('folder', 80, 120, res.id, 'assets');
  const player = add('file', 80, 200, res.id, 'player.gd');
  const ready = add('function', 100, 260, player.id, '_ready');
  const print = add('fn_print', 120, 320, ready.id);
  scene.connect({ node: ready, pin: ready.outputs[0] }, { node: print, pin: print.inputs[0] });
  add('file', 520, 120, res.id, 'enemy.gd');
  add('file', 520, 260, res.id, 'data.json');
}
ready = true;
window.addEventListener('pagehide', () => autosave.flush());

new ResizeObserver(() => renderer.resize(canvas.clientWidth, canvas.clientHeight)).observe(canvas);
renderer.requestRender();

// Para depuração no console e para os testes.
export const app = { camera, languages, scene, selection, renderer, menu, contextMenu, inspector, natives, hintButton, store, autosave };
