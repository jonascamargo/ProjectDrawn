import { bus } from '../../../core/events.js';
import { t } from '../../../i18n/i18n.js';
import { triggers } from '../registry.js';
import { inComment } from '../../commentText.js';

const DRAG_THRESHOLD = 4;

// Clicar seleciona (Ctrl/Shift alterna); arrastar move (Alt desliga o snap; Ctrl solta fora
// da área do pai). Arquivo solto dentro da área de outro consulta as ações "itemDrop".
export default {
  id: 'item.move',
  area: ['folder', 'file', 'note'],
  press: {
    when: (c) => c.part === 'card' || c.part === 'header' || (c.part === 'body' && c.item.kind !== 'folder'),
    run(c) {
      const { editor, item } = c;
      const additive = c.mods.ctrl || c.mods.shift;
      // Com modificador, item já selecionado só é desmarcado ao soltar sem arrastar,
      // para que Ctrl/Shift pressionados antes do clique não impeçam o arraste.
      let deselectOnClick = false;
      if (additive && editor.selection.has(item.id)) {
        deselectOnClick = true;
        editor.setFocus(item.id);
      } else if (additive) {
        editor.toggleSelect(item.id);
      } else if (!editor.selection.has(item.id)) {
        editor.select([item.id]);
      } else {
        editor.setFocus(item.id);
      }
      editor.raise([...editor.selection]);
      const starts = new Map(editor.selectedItems().map((i) => [i.id, { x: i.x, y: i.y, parentId: i.parentId, z: i.z }]));
      for (const note of editor.selectedItems()) {
        if (note.kind !== 'comment' || note.group === false) continue;
        const box = editor.layout?.entries.get(note.id)?.rect;
        for (const other of box ? editor.project.children(note.parentId) : []) {
          const r = editor.layout.entries.get(other.id)?.rect;
          if (starts.has(other.id) || other.kind === 'comment' || !r) continue;
          if (inComment(r, box)) starts.set(other.id, { x: other.x, y: other.y, parentId: other.parentId, z: other.z });
        }
      }
      return new MoveSession(c, { starts, clickedId: item.id, additive, deselectOnClick, dragByBody: c.part === 'body' });
    },
  },
  hover: {
    when: (c) => c.part !== 'body',
    run: () => 'move',
  },
};

class MoveSession {
  constructor(c, data) {
    Object.assign(this, data);
    this.editor = c.editor;
    this.canvas = c.canvas;
    this.startScreen = c.screen;
    this.startWorld = c.world;
    this.dragging = false;
    this.last = null;
  }

  move(c) {
    const editor = this.editor;
    if (!this.dragging) {
      if (this.dragByBody) return;
      if (Math.hypot(c.screen.x - this.startScreen.x, c.screen.y - this.startScreen.y) < DRAG_THRESHOLD) return;
      this.dragging = true;
      const subtree = new Set();
      for (const id of this.starts.keys()) {
        subtree.add(id);
        for (const d of editor.project.descendants(id)) subtree.add(d.id);
      }
      editor.dragSubtree = subtree;
      editor.dragLayout = editor.layout;
      this.canvas.style.cursor = 'grabbing';
    }
    this.last = { world: c.world, client: c.client };
    this.#apply({ alt: c.mods.alt, ctrl: c.mods.ctrl });
  }

  modifiers(event) {
    if (!this.dragging || !this.last) return;
    if (!['Control', 'Meta', 'Alt'].includes(event.key)) return;
    event.preventDefault();
    this.#apply({ alt: event.altKey, ctrl: event.ctrlKey || event.metaKey });
  }

  // Com Ctrl, os itens arrastados ficam "destacados": a área do pai para de acompanhá-los.
  #apply({ alt, ctrl }) {
    const editor = this.editor;
    const { world, client } = this.last;
    const dx = world.x - this.startWorld.x;
    const dy = world.y - this.startWorld.y;
    for (const [id, start] of this.starts) {
      const item = editor.project.get(id);
      item.x = editor.snap(start.x + dx, alt);
      item.y = editor.snap(start.y + dy, alt);
    }
    editor.detached = ctrl ? new Set(this.starts.keys()) : null;
    editor.refresh();
    this.#updateDrop(world, client, ctrl);
  }

  #updateDrop(world, client, leave) {
    const editor = this.editor;
    const drop = editor.resolveDrop(world, client, { leave });
    editor.dropTarget = drop && drop.mode !== 'blocked' && !drop.viaBreadcrumb ? drop.parentId : null;
    editor.breadcrumbs.highlight(drop?.viaBreadcrumb ? drop.parentId : undefined);
    let message = '';
    if (drop?.mode === 'blocked') message = t('items.holdCtrlToLeave');
    else if (drop) {
      const name = drop.parentId ? editor.project.get(drop.parentId).name : editor.rootLabel();
      message = t('items.dropInto', { name });
    }
    bus.emit('status', message);
  }

  up(c) {
    const editor = this.editor;
    if (!this.dragging) {
      if (this.deselectOnClick) editor.toggleSelect(this.clickedId);
      // Clique simples num item já selecionado (sem modificador) deixa só ele selecionado.
      else if (!this.additive && editor.selection.size > 1) editor.select([this.clickedId]);
      return;
    }
    // Um só arquivo solto dentro da área de outro arquivo expandido: as ações "itemDrop"
    // decidem o que acontece (o arquivo não se move).
    const ids = [...this.starts.keys()];
    const file = ids.length === 1 ? editor.project.get(ids[0]) : null;
    const target = file?.kind === 'file' ? editor.graphAreaAt(c.world, new Set(ids)) : null;
    if (target) {
      const ctx = { ...c, item: file, area: 'file', target };
      const found = triggers('itemDrop', 'file').find(({ trigger }) => !trigger.when || trigger.when(ctx));
      if (found) {
        this.#endVisuals();
        editor.cancelDrag(this.starts);
        found.trigger.run(ctx);
        return;
      }
    }
    const drop = editor.resolveDrop(c.world, c.client, { leave: c.mods.ctrl });
    this.#endVisuals();
    // Soltar dentro de um comentário: o que encosta no texto dele desce.
    editor.history.transaction(t('history.move', { count: this.starts.size }), () => {
      editor.commitDrag(this.starts, drop);
      editor.settleCanvasComments([...new Set([...this.starts.keys()].map((id) => editor.project.get(id)?.parentId ?? null))]);
    });
  }

  cancel() {
    if (this.dragging) {
      this.#endVisuals();
      this.editor.commitDrag(this.starts, null);
    }
    this.editor.renderer.invalidate();
  }

  #endVisuals() {
    const editor = this.editor;
    editor.dragSubtree = null;
    editor.dropTarget = null;
    editor.dragLayout = null;
    editor.detached = null;
    editor.breadcrumbs.highlight(undefined);
    this.canvas.style.cursor = '';
    bus.emit('status', '');
  }
}
