import { bus } from './core/events.js';
import { CommandStack } from './core/commands.js';
import { loadLocale, t, translateDom } from './i18n/i18n.js';
import { loadTheme } from './theme/themeLoader.js';
import { initToasts, toast } from './ui/toast.js';
import { initModals, isModalOpen } from './ui/modal.js';
import { showContextMenu } from './ui/contextMenu.js';
import { Camera } from './canvas/camera.js';
import { Renderer } from './canvas/renderer.js';
import { createGridLayer } from './canvas/gridLayer.js';
import { ViewportController, isTyping } from './canvas/viewportController.js';
import { createItemLayer } from './canvas/itemLayer.js';
import { createOverlayLayer, createWireLayer } from './canvas/wireLayer.js';
import { ItemTool } from './canvas/itemTool.js';
import { Editor } from './editor/editor.js';
import { ProjectSession } from './editor/session.js';
import { Breadcrumbs } from './ui/breadcrumbs.js';
import { Launcher, storageMessage } from './ui/launcher.js';
import { IndexedDBAdapter } from './storage/indexedDBAdapter.js';
import { ProjectStore } from './storage/projectStore.js';
import { fileLinkSupported, filePermission } from './storage/fileLink.js';
import { findActiveByName } from './storage/projectService.js';
import { loadSettings } from './core/settings.js';
import { openAppSettings } from './ui/appSettings.js';
import { LibraryEditor } from './ui/libraryEditor.js';
import { ProjectOutline } from './ui/projectOutline.js';
import { Inspector } from './ui/inspector.js';
import { LibraryStore, setLibraryStore } from './storage/libraryStore.js';
import { findLibraryByName } from './storage/libraryService.js';

const $ = (id) => document.getElementById(id);
const PROJECT_ROUTE = /^#\/projeto\/(.+)$/;

async function boot() {
  initToasts($('toast-root'));
  initModals($('modal-root'));
  loadSettings();

  await loadLocale('pt-BR');
  translateDom();

  try {
    await loadTheme('default');
  } catch {
    document.body.classList.add('theme-ready');
    toast.error(t('errors.themeLoad'));
  }

  // Pede ao navegador para não apagar os dados do IndexedDB quando faltar espaço.
  navigator.storage?.persist?.().catch(() => {});

  const adapter = new IndexedDBAdapter();
  const store = new ProjectStore(adapter);
  setLibraryStore(new LibraryStore(adapter));
  const camera = new Camera();
  const renderer = new Renderer($('stage'), camera);
  const viewport = new ViewportController($('stage'), camera, renderer);
  const history = new CommandStack();
  const breadcrumbs = new Breadcrumbs($('breadcrumbs'), { onNavigate: (id) => editor.navigateTo(id) });
  const editor = new Editor({ project: null, history, camera, renderer, breadcrumbs });
  const itemTool = new ItemTool($('stage'), editor, camera, viewport);
  const session = new ProjectSession({ store, editor, camera, renderer, history, canvas: $('stage') });
  const launcher = new Launcher($('launcher'), {
    store,
    onOpen: (record) => openFromLauncher(store, record),
    onOpenLibrary: (record) => (location.hash = libraryHash(record.name)),
    onViewChange: (view) => window.history.replaceState(null, '', LAUNCHER_HASHES[view]),
  });
  const libraryEditor = new LibraryEditor($('library-editor'), {
    onBack: () => (location.hash = '#/bibliotecas'),
    onOpen: (record) => (location.hash = libraryHash(record.name)),
    onRenamed: (record) => window.history.replaceState(null, '', libraryHash(record.name)),
    errorMessage: storageMessage,
  });

  renderer.addLayer(createGridLayer());
  renderer.addLayer(createItemLayer(editor));
  renderer.addLayer(createWireLayer(editor));
  renderer.addLayer(createOverlayLayer(editor));

  bindHistory(history);
  bindStatusBar(camera);
  bindSession(session);
  bindShortcuts({ history, camera, renderer, session });

  const outline = new ProjectOutline($('tab-project'), editor);
  const inspector = new Inspector($('tab-properties'), editor);
  // Aberta pelo editor quando uma ação precisa das Propriedades (ex.: nova etiqueta de fio).
  editor.showSidebarTab = bindSidebarTabs({ project: () => outline.render(), properties: () => inspector.refresh() });
  bindPanel('sidebar', 'btn-sidebar', () => outline.render());

  $('btn-back').addEventListener('click', () => (location.hash = '#/'));
  $('btn-settings').addEventListener('click', () => openAppSettings());
  window.addEventListener('beforeunload', (event) => {
    libraryEditor.flush();
    if (session.saveState === 'pending' || session.saveState === 'saving') {
      session.save();
      event.preventDefault();
      event.returnValue = '';
    }
  });

  // Rotas: '#/' = launcher, '#/projeto/<id>' = editor. Trocas são serializadas.
  let routing = Promise.resolve();
  const route = () => (routing = routing.then(() => applyRoute({ session, launcher, libraryEditor, renderer, store })).catch((e) => bus.emit('error', e)));
  window.addEventListener('hashchange', route);
  await route();

  return { bus, camera, renderer, viewport, history, editor, itemTool, session, store, launcher, libraryEditor };
}

const LAUNCHER_HASHES = { projects: '#/', libraries: '#/bibliotecas', trash: '#/lixeira' };

function libraryHash(name) {
  return `#/biblioteca/${encodeURIComponent(name)}`;
}

function projectHash(name) {
  return `#/projeto/${encodeURIComponent(name)}`;
}

// Chamado no clique do card: pede a permissão do arquivo vinculado enquanto o gesto
// do usuário ainda vale (o navegador não deixa pedir depois, sem clique).
async function openFromLauncher(store, record) {
  if (record.link) {
    const handle = await store.handle(record.id);
    if (handle) await filePermission(handle, { request: true });
  }
  location.hash = projectHash(record.name);
}

const LIBRARY_ROUTE = /^#\/biblioteca\/(.+)$/;
const LAUNCHER_VIEWS = { '#/bibliotecas': 'libraries', '#/lixeira': 'trash' };

function showView(id) {
  for (const view of ['launcher', 'app', 'library-editor']) $(view).hidden = view !== id;
}

async function applyRoute({ session, launcher, libraryEditor, renderer, store }) {
  const projectMatch = location.hash.match(PROJECT_ROUTE);
  const libraryMatch = location.hash.match(LIBRARY_ROUTE);

  if (!libraryMatch && libraryEditor.record) await libraryEditor.close();
  if (!projectMatch) await session.close();

  if (projectMatch) {
    const name = decodeURIComponent(projectMatch[1]);
    // A URL usa o nome do projeto (único); links antigos com id ainda funcionam.
    const record = (await findActiveByName(store, name)) ?? (await store.get(name));
    if (!record || record.deletedAt) {
      toast.error(t('storage.errors.notFound'));
      location.hash = '#/';
      return;
    }
    if (session.record?.id !== record.id) {
      await session.close();
      try {
        await session.open(record.id);
      } catch (error) {
        toast.error(storageMessage(error));
        location.hash = '#/';
        return;
      }
    }
    showView('app');
    document.title = `${session.record.name} — ${t('app.name')}`;
    renderer.resize();
    bus.emit('status', t('app.ready'));
    return;
  }

  if (libraryMatch) {
    const record = await findLibraryByName(decodeURIComponent(libraryMatch[1]));
    if (!record) {
      toast.error(t('libraries.notFound'));
      location.hash = '#/bibliotecas';
      return;
    }
    if (libraryEditor.record?.id !== record.id) {
      if (libraryEditor.record) await libraryEditor.close();
      libraryEditor.open(record);
    }
    showView('library-editor');
    document.title = `${record.name} — ${t('app.name')}`;
    return;
  }

  launcher.setView(LAUNCHER_VIEWS[location.hash] ?? 'projects');
  showView('launcher');
  document.title = t('app.name');
  await launcher.refresh();
}

// Abas do painel esquerdo (Projeto | Propriedades), com a última aba lembrada.
function bindSidebarTabs(onShow) {
  const key = 'projectdrawn.sidebar.tab';
  const tabs = [...document.querySelectorAll('.side-tabs__tab')];
  const show = (name) => {
    for (const tab of tabs) {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('side-tabs__tab--active', active);
      $(`tab-${tab.dataset.tab}`).hidden = !active;
    }
    try {
      localStorage.setItem(key, name);
    } catch {
      // ignora
    }
    onShow[name]?.();
  };
  for (const tab of tabs) tab.addEventListener('click', () => show(tab.dataset.tab));
  let initial = 'project';
  try {
    initial = localStorage.getItem(key) ?? 'project';
  } catch {
    // ignora
  }
  show(onShow[initial] ? initial : 'project');
  return show;
}

// Painéis laterais com visibilidade lembrada neste navegador.
function bindPanel(panelId, buttonId, onShow) {
  const key = `projectdrawn.panel.${panelId}`;
  const panel = $(panelId);
  let visible = true;
  try {
    visible = localStorage.getItem(key) !== 'hidden';
  } catch {
    // sem armazenamento local: painel visível
  }
  const apply = () => {
    panel.hidden = !visible;
    $(buttonId).classList.toggle('btn--active', visible);
    if (visible) onShow();
  };
  $(buttonId).addEventListener('click', () => {
    visible = !visible;
    try {
      localStorage.setItem(key, visible ? 'shown' : 'hidden');
    } catch {
      // ignora
    }
    apply();
  });
  apply();
}

function bindHistory(history) {
  const undoBtn = $('btn-undo');
  const redoBtn = $('btn-redo');
  undoBtn.addEventListener('click', () => undo(history));
  redoBtn.addEventListener('click', () => redo(history));
  bus.on('history:changed', () => {
    undoBtn.disabled = !history.canUndo;
    redoBtn.disabled = !history.canRedo;
  });
}

function undo(history) {
  const command = history.undo();
  bus.emit('status', command ? t('history.undone', { label: command.label }) : t('history.nothingToUndo'));
}

function redo(history) {
  const command = history.redo();
  bus.emit('status', command ? t('history.redone', { label: command.label }) : t('history.nothingToRedo'));
}

function bindStatusBar(camera) {
  const zoomEl = $('status-zoom');
  const coordsEl = $('status-coords');
  bus.on('status', (message) => {
    $('status-message').textContent = message;
  });
  bus.on('camera:changed', () => {
    zoomEl.textContent = t('canvas.zoom', { value: Math.round(camera.zoom * 100) });
  });
  bus.on('pointer:move', ({ world }) => {
    coordsEl.textContent = t('canvas.coords', { x: Math.round(world.x), y: Math.round(world.y) });
  });
}

// Indicador de salvamento e botão do arquivo vinculado.
function bindSession(session) {
  const saveEl = $('status-save');
  const linkBtn = $('btn-link');

  bus.on('session:changed', () => {
    saveEl.textContent = session.project ? t(`storage.${session.saveState}`) : '';
    saveEl.classList.toggle('statusbar__save--error', session.saveState === 'error');

    const file = session.record?.link?.fileName ?? '';
    linkBtn.classList.remove('topbar__link--connected', 'topbar__link--disconnected');
    if (session.linkState === 'connected') {
      linkBtn.textContent = t('storage.linkConnected', { file });
      linkBtn.classList.add('topbar__link--connected');
    } else if (session.linkState === 'disconnected') {
      linkBtn.textContent = t('storage.linkDisconnected', { file });
      linkBtn.classList.add('topbar__link--disconnected');
    } else {
      linkBtn.textContent = t('storage.linkNone');
    }
    linkBtn.title = file;
    if (session.record) {
      document.title = `${session.record.name} — ${t('app.name')}`;
      // Mantém a URL igual ao nome atual (ex.: nome mudou ao recarregar do arquivo).
      const hash = projectHash(session.record.name);
      if (location.hash.match(PROJECT_ROUTE) && location.hash !== hash) history.replaceState(null, '', hash);
    }
  });

  linkBtn.addEventListener('click', () => {
    if (session.linkState === 'disconnected') {
      session.reconnect().catch((e) => toast.error(storageMessage(e)));
      return;
    }
    if (session.linkState === 'connected') {
      const rect = linkBtn.getBoundingClientRect();
      showContextMenu(rect.left, rect.bottom + 4, [
        { header: t('storage.fileMenu', { file: session.record.link.fileName }) },
        { label: t('storage.saveNow'), shortcut: 'Ctrl+S', action: () => session.save({ force: true }) },
        { label: t('launcher.unlink'), danger: true, action: () => session.unlink() },
      ]);
      return;
    }
    if (!fileLinkSupported) {
      toast.warning(t('storage.unsupported'));
      return;
    }
    session.linkToFile().catch((e) => toast.error(storageMessage(e)));
  });
}

function bindShortcuts({ history, camera, renderer, session }) {
  window.addEventListener('keydown', (event) => {
    if (!session.project) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = (event.key ?? '').toLowerCase();

    if (mod && key === 's') {
      event.preventDefault();
      session.save({ force: true });
      return;
    }
    if (isModalOpen() || isTyping(event.target)) return;

    if (mod && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo(history);
    } else if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
      event.preventDefault();
      redo(history);
    } else if (event.key === 'Home') {
      event.preventDefault();
      camera.zoom = 1;
      camera.centerOn(0, 0, renderer.width, renderer.height);
      renderer.invalidate();
      bus.emit('camera:changed', camera);
    }
  });
}

bus.on('error', (error) => {
  toast.error(t('errors.unexpected', { message: error?.message ?? String(error) }));
});
window.addEventListener('error', (event) => bus.emit('error', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => bus.emit('error', event.reason));

// Exposto para inspeção durante o desenvolvimento.
window.projectdrawn = await boot();
