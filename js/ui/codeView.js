import { t } from '../i18n/i18n.js';
import { generateScript } from '../core/scriptCode.js';
import { downloadText } from '../storage/importExport.js';
import { closeTopModal, openModal } from './modal.js';
import { toast } from './toast.js';

// "Ver código": .gd montado a partir dos nós, com avisos de montagem (clique leva ao nó),
// copiar, baixar e exportar todos os scripts para uma pasta.
export async function openCodeView(editor, fileId) {
  const item = editor.project?.get(fileId);
  if (!item) return;
  const { code, warnings } = generateScript(item);

  const content = el('div', 'code-view');
  const tools = el('div', 'code-view__tools');
  tools.append(
    button(t('export.copy'), async () => {
      try {
        await navigator.clipboard.writeText(code);
        toast.success(t('export.copied'));
      } catch {
        toast.error(t('export.copyFailed'));
      }
    }),
    button(t('export.download'), () => downloadText(item.name, code, 'text/plain')),
    button(t('export.allToFolder'), () => exportAllScripts(editor)),
  );
  content.append(tools, el('pre', 'code-view__code', code));

  if (warnings.length) {
    content.append(el('h4', 'inspector__section', t('export.warnings', { count: warnings.length })));
    const list = el('div', 'code-view__warnings');
    for (const w of warnings) {
      const row = el('button', 'code-view__warning', t(w.message, w.params ?? {}));
      row.type = 'button';
      row.title = t('export.goToNode');
      row.addEventListener('click', () => {
        closeTopModal();
        editor.revealGraph(fileId, { nodeId: w.nodeId });
      });
      list.append(row);
    }
    content.append(list);
  }

  await openModal({
    title: t('export.title', { name: item.name }),
    content,
    width: '760px',
    actions: [{ id: 'ok', label: t('modal.close'), variant: 'primary', submit: true }],
  });
}

// Grava todos os scripts numa pasta escolhida, na mesma estrutura de pastas do projeto.
export async function exportAllScripts(editor) {
  const project = editor.project;
  if (!project) return;
  if (typeof window.showDirectoryPicker !== 'function') {
    toast.warning(t('export.folderUnsupported'));
    return;
  }
  let root;
  try {
    root = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    return; // cancelado
  }
  const scripts = [...project.items.values()].filter((item) => editor.graph.isScript(item));
  let warnings = 0;
  try {
    for (const item of scripts) {
      let dir = root;
      for (const folder of [...project.ancestors(item.id)].reverse()) dir = await dir.getDirectoryHandle(folder.name, { create: true });
      const result = generateScript(item);
      warnings += result.warnings.length;
      const handle = await dir.getFileHandle(item.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(result.code);
      await writable.close();
    }
  } catch {
    toast.error(t('export.folderFailed'));
    return;
  }
  toast.success(t('export.folderDone', { count: scripts.length, warnings }));
}

function button(text, onClick) {
  const b = el('button', 'btn', text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
