import { t } from '../i18n/i18n.js';
import { currentProfile } from '../lang/profileLoader.js';
import { closeTopModal, openModal } from './modal.js';

// Lista de problemas do projeto inteiro (aberta pelo contador da barra de status),
// agrupada por arquivo; cada linha leva ao nó no canvas.
export function openIssuesList(editor) {
  const project = editor.project;
  if (!project || !editor.issues?.size) return;
  const root = currentProfile()?.rootLabel ?? '';
  const content = document.createElement('div');
  let total = 0;
  for (const [fileId, { list }] of editor.issues) {
    total += list.length;
    const title = document.createElement('h4');
    title.className = 'inspector__section';
    title.textContent = `${project.path(fileId, root)} (${list.length})`;
    const rows = document.createElement('div');
    rows.className = 'code-view__warnings';
    for (const issue of list) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'code-view__warning';
      row.textContent = t(issue.message, issue.params ?? {});
      row.addEventListener('click', () => {
        closeTopModal();
        editor.revealGraph(fileId, { nodeId: issue.nodeId });
      });
      rows.append(row);
    }
    content.append(title, rows);
  }
  openModal({
    title: t('validation.listTitle', { count: total }),
    message: t('validation.listHint'),
    content,
    width: '680px',
    actions: [{ id: 'ok', label: t('modal.close'), variant: 'primary', submit: true }],
  });
}
