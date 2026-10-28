import { t } from '../i18n/i18n.js';
import { graphSnapshot } from '../core/graphOps.js';
import { currentProfile } from '../lang/profileLoader.js';
import { buildGraph } from '../import/graphBuilder.js';
import { closeTopModal, openModal } from './modal.js';
import { toast } from './toast.js';

// Importar GDScript para um script do projeto: colar o código, gerar os nós (substitui o
// conteúdo; Ctrl+Z desfaz) e listar o que não foi reconhecido.
export async function openCodeImport(editor, fileId) {
  const item = editor.project?.get(fileId);
  if (!item) return;
  const content = document.createElement('div');
  const area = document.createElement('textarea');
  area.className = 'field__input code-import__text';
  area.spellcheck = false;
  area.placeholder = 'extends Node\n\nfunc _ready():\n\tprint("olá")';
  // Tab insere tabulação (indentação do GDScript) em vez de mudar o foco.
  area.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    area.setRangeText('\t', area.selectionStart, area.selectionEnd, 'end');
  });
  const hint = document.createElement('p');
  hint.className = 'side-panel__hint';
  hint.textContent = t('import.hint');
  content.append(area, hint);

  const result = await openModal({ title: t('import.title', { name: item.name }), content, width: '720px' });
  const source = area.value;
  if (!result || !source.trim()) return;

  const { graph, warnings } = buildGraph(source, { resolvePath: (path) => itemByPath(editor.project, path) });
  const before = structuredClone(item.graph ?? null);
  editor.history.execute(graphSnapshot(editor.project, fileId, before, graph, t('import.history')));
  editor.revealGraph(fileId, {});
  toast.success(t('import.done', { nodes: graph.nodes.length, warnings: warnings.length }));
  if (warnings.length) showImportWarnings(editor, fileId, warnings);
}

// Item do projeto pelo caminho res:// (para preload virar const (arquivo)).
export function itemByPath(project, path) {
  const root = currentProfile()?.rootLabel ?? '';
  for (const item of project.items.values()) if (project.path(item.id, root) === path) return item.id;
  return null;
}

export function showImportWarnings(editor, fileId, warnings) {
  const list = document.createElement('div');
  list.className = 'code-view__warnings';
  for (const w of warnings) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'code-view__warning';
    row.textContent = t(w.message, w.params ?? {});
    if (w.nodeId) {
      row.title = t('export.goToNode');
      row.addEventListener('click', () => {
        closeTopModal();
        editor.revealGraph(fileId, { nodeId: w.nodeId });
      });
    }
    list.append(row);
  }
  openModal({
    title: t('import.warningsTitle', { count: warnings.length }),
    message: t('import.warningsHint'),
    content: list,
    width: '640px',
    actions: [{ id: 'ok', label: t('modal.close'), variant: 'primary', submit: true }],
  });
}
