import { bus } from '../core/events.js';
import { uid } from '../core/ids.js';
import { createItem } from '../core/project.js';
import { addItems, moveItems, removeItems, updateItem } from '../core/projectOps.js';
import { t } from '../i18n/i18n.js';
import { theme } from '../theme/themeLoader.js';
import { allFileTypes, fileTypeOfItem, loadedProfiles, profileIdFor, withItemProfile } from '../lang/profileLoader.js';
import { computeLayout, containerAt, contentOrigin, hitTest, intersects } from '../canvas/itemLayout.js';
import { confirmDialog, openModal, promptDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { GraphController } from './graphController.js';
import { validateItem } from '../core/validation.js';
import { isReal } from '../core/realItems.js';
import { adapterFor } from '../lang/adapters.js';
import { autoloads, pascalCase } from '../ui/projectSettings.js';
import { readGraph } from '../core/graph.js';

const INVALID_NAME = /[\\/:*?"<>|]/;
const AUTO_GAP = 20;

// Estado e ações do editor de itens (pastas/arquivos) e relações.
export class Editor {
  constructor({ project, history, camera, renderer, breadcrumbs }) {
    this.project = project;
    this.history = history;
    this.camera = camera;
    this.renderer = renderer;
    this.breadcrumbs = breadcrumbs;

    this.layout = null;
    this.selection = new Set();
    this.focusId = null;
    this.clipboard = null;
    // Tamanho ajustado das áreas pela alça (só na memória, não vai para o projeto).
    this.areaSizes = new Map();
    // Ligações entre arquivos destacadas no canvas: sob o mouse e fixadas (caixa nas Propriedades).
    this.linkHover = null;
    this.linkPinned = new Map();
    this.pointerWorld = { x: 0, y: 0 };

    // Estado transitório de interação (lido pelas camadas de desenho).
    this.dragSubtree = null;
    this.dragLayout = null;
    this.detached = null;
    this.dropTarget = null;
    this.hoverPin = null;
    this.wireDrag = null;
    this.lasso = null;

    bus.on('project:changed', () => this.relayout());
    bus.on('theme:changed', () => this.relayout());
    bus.on('pointer:move', ({ world, screen }) => {
      this.pointerWorld = world;
      this.pointerScreen = screen;
    });
    this.graph = new GraphController(this);

    this.relayout();
  }

  // ---------- layout e consultas ----------

  // Troca o projeto do editor (null = nenhum aberto, ex.: launcher visível).
  setProject(project) {
    this.project = project;
    this.graph.clear();
    this.selection.clear();
    this.focusId = null;
    this.dragSubtree = null;
    this.dragLayout = null;
    this.detached = null;
    this.dropTarget = null;
    this.hoverPin = null;
    this.wireDrag = null;
    this.lasso = null;
    this.linkHover = null;
    this.linkPinned = new Map();
    // Relações desenhadas à mão foram substituídas pelas ligações calculadas (Propriedades).
    if (project?.relations.size) {
      project.relations.clear();
      project.invalidate();
    }
    this.relayout();
  }

  // Validação visual: problemas de cada script/cena, por nó (marca ⚠ no canvas, lista nas
  // Propriedades e contador na barra de status).
  #computeIssues() {
    const strict = this.graph.strict();
    const all = new Map();
    let total = 0;
    for (const item of this.project.items.values()) {
      if (!item.graph || !this.graph.supportsGraph(item)) continue;
      const list = withItemProfile(item, () => validateItem(item, { script: Boolean(adapterFor(item)), strict }));
      if (!list.length) continue;
      const byNode = new Map();
      for (const issue of list) {
        if (!byNode.has(issue.nodeId)) byNode.set(issue.nodeId, []);
        byNode.get(issue.nodeId).push(issue);
      }
      all.set(item.id, { list, byNode });
      total += list.length;
    }
    this.issues = all;
    bus.emit('issues:changed', total);
  }

  issuesOf(fileId, nodeId) {
    return this.issues?.get(fileId)?.byNode.get(nodeId) ?? null;
  }

  relayout() {
    if (!theme()) return;
    if (!this.project) {
      this.layout = null;
      this.issues = new Map();
      bus.emit('issues:changed', 0);
      this.renderer.invalidate();
      return;
    }
    this.graph.relinkPaths();
    this.layout = computeLayout(this.project, theme(), { graphFor: (item) => this.graph.layoutFor(item), sizes: this.areaSizes });
    this.graph.prune();
    this.#computeIssues();
    for (const id of [...this.selection]) if (!this.project.get(id)) this.selection.delete(id);
    if (this.focusId && !this.project.get(this.focusId)) this.focusId = null;
    this.updateBreadcrumbs();
    this.renderer.invalidate();
  }

  // Recalcula só a geometria durante arrastes (sem eventos de projeto).
  refresh() {
    if (!this.project) return;
    this.layout = computeLayout(this.project, theme(), { detached: this.detached, graphFor: (item) => this.graph.layoutFor(item), sizes: this.areaSizes });
    this.renderer.invalidate();
  }

  // { kind: 'item', entry, part } | null
  // Dentro da área de um script: { kind: 'g…', fileId, ... } (ver GraphController.hit).
  hitAt(p) {
    if (!this.layout) return null;
    const hit = hitTest(this.layout, p);
    if (hit?.part === 'body' && hit.entry.expanded) {
      const graphHit = this.graph.hit(hit.entry, p);
      if (graphHit) return graphHit;
    }
    return hit ? { kind: 'item', entry: hit.entry, part: hit.part } : null;
  }

  setLinkHover(link) {
    if ((this.linkHover?.key ?? null) === (link?.key ?? null)) return;
    this.linkHover = link;
    this.renderer.invalidate();
  }

  setLinkPinned(link, pinned) {
    if (pinned) this.linkPinned.set(link.key, link);
    else this.linkPinned.delete(link.key);
    this.renderer.invalidate();
  }

  canExpand(item) {
    return item.kind === 'folder' || Boolean(fileTypeOfItem(item).graph);
  }

  snap(value, disabled = false) {
    if (disabled || !this.project.settings.snap) return value;
    const grid = this.project.settings.gridSize;
    return Math.round(value / grid) * grid;
  }

  rootLabel() {
    return this.project?.name || t('project.untitled');
  }

  // ---------- seleção e foco ----------

  graphStateFor(fileId) {
    return this.graph.stateFor(fileId);
  }

  select(ids, { additive = false } = {}) {
    if (ids.length) this.graph.clear();
    if (!additive) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    if (ids.length) this.setFocus(ids[ids.length - 1]);
    this.renderer.invalidate();
    bus.emit('selection:changed', this.selection);
  }

  toggleSelect(id) {
    const item = this.project.get(id);
    const sameLevel = [...this.selection].every((sid) => this.project.get(sid)?.parentId === item.parentId);
    if (!sameLevel) return this.select([id]);
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.setFocus(id);
    this.renderer.invalidate();
    bus.emit('selection:changed', this.selection);
  }

  clearSelection({ keepGraph = false } = {}) {
    if (!keepGraph) this.graph.clear();
    this.selection.clear();
    this.renderer.invalidate();
    bus.emit('selection:changed', this.selection);
  }

  setFocus(id) {
    this.focusId = id;
    this.updateBreadcrumbs();
  }

  selectedItems() {
    return [...this.selection].map((id) => this.project.get(id)).filter(Boolean);
  }

  // Traz os itens para cima entre os irmãos (não entra no histórico).
  raise(ids) {
    let changed = false;
    for (const id of ids) {
      const item = this.project.get(id);
      const siblings = this.project.children(item.parentId);
      if (siblings[siblings.length - 1] === item) continue;
      item.z = this.project.nextZ(item.parentId);
      this.project.invalidate();
      changed = true;
    }
    if (changed) this.refresh();
  }

  levelOfSelection() {
    const first = this.selectedItems()[0] ?? (this.focusId ? this.project.get(this.focusId) : null);
    return first ? first.parentId : null;
  }

  selectAll() {
    const level = this.levelOfSelection();
    if (level !== null && !this.project.get(level)?.expanded) return;
    this.select(this.project.children(level).map((c) => c.id));
  }

  itemsInRect(rect, level) {
    const out = [];
    for (const entry of this.layout.entries.values()) {
      if (entry.item.parentId === level && intersects(entry.rect, rect)) out.push(entry.item.id);
    }
    return out;
  }

  // ---------- breadcrumbs ----------

  updateBreadcrumbs() {
    const segments = [{ id: null, label: this.rootLabel(), container: true }];
    const focus = this.focusId ? this.project.get(this.focusId) : null;
    if (focus) {
      for (const a of this.project.ancestors(focus.id).reverse()) segments.push({ id: a.id, label: a.name, container: true });
      segments.push({ id: focus.id, label: focus.name, container: focus.kind === 'folder' });
    }
    this.breadcrumbs.render(segments);
  }

  // Mostra um nó ou sub-área de um script: expande o arquivo (e as pastas acima),
  // seleciona e enquadra.
  revealGraph(fileId, { nodeId, scopeId }) {
    const item = this.project?.get(fileId);
    if (!item) return;
    let changed = !item.expanded;
    item.expanded = true;
    for (const ancestor of this.project.ancestors(fileId)) {
      if (!ancestor.expanded) changed = true;
      ancestor.expanded = true;
    }
    if (changed) bus.emit('project:changed', this.project);
    const graphLayout = this.layout?.entries.get(fileId)?.graph;
    if (nodeId) {
      const node = readGraph(item).nodes.find((n) => n.id === nodeId);
      // Nó dentro de sub-área recolhida: revela a sub-área.
      if (node?.scopeId && !graphLayout?.nodes.has(nodeId)) return this.revealGraph(fileId, { scopeId: node.scopeId });
      this.graph.select(fileId, { nodes: [nodeId] });
      this.fitRect(graphLayout?.nodes.get(nodeId)?.rect);
    } else if (scopeId) {
      this.graph.select(fileId, { scopes: [scopeId] });
      this.fitRect(graphLayout?.scopes.get(scopeId)?.rect);
    }
  }

  navigateTo(id) {
    if (id === null) {
      this.focusId = null;
      this.clearSelection();
      this.updateBreadcrumbs();
      this.fitAll();
      return;
    }
    this.select([id]);
    this.fitRect(this.layout.entries.get(id)?.rect);
  }

  // ---------- câmera ----------

  fitRect(rect) {
    if (!rect) return;
    this.camera.fit({ x: rect.x, y: rect.y, width: rect.w, height: rect.h }, this.renderer.width, this.renderer.height, 60);
    this.camera.zoom = Math.min(this.camera.zoom, 1.5);
    this.camera.centerOn(rect.x + rect.w / 2, rect.y + rect.h / 2, this.renderer.width, this.renderer.height);
    this.renderer.invalidate();
    bus.emit('camera:changed', this.camera);
  }

  boundsOf(ids) {
    let rect = null;
    for (const id of ids) {
      const r = this.layout.entries.get(id)?.rect;
      if (!r) continue;
      if (!rect) rect = { ...r };
      else {
        const x2 = Math.max(rect.x + rect.w, r.x + r.w);
        const y2 = Math.max(rect.y + rect.h, r.y + r.h);
        rect.x = Math.min(rect.x, r.x);
        rect.y = Math.min(rect.y, r.y);
        rect.w = x2 - rect.x;
        rect.h = y2 - rect.y;
      }
    }
    return rect;
  }

  fitAll() {
    this.fitRect(this.boundsOf(this.project.children(null).map((c) => c.id)));
  }

  // F com nós/sub-áreas selecionados: enquadra só eles.
  fitGraphSelection() {
    const g = this.layout?.entries.get(this.graph.fileId)?.graph;
    if (!g) return;
    const rects = [...[...this.graph.nodes].map((id) => g.nodes.get(id)?.rect), ...[...this.graph.scopes].map((id) => g.scopes.get(id)?.rect)].filter(Boolean);
    if (!rects.length) return;
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    this.fitRect({ x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y });
  }

  fitSelection() {
    const ids = this.selection.size ? [...this.selection] : this.project.children(null).map((c) => c.id);
    this.fitRect(this.boundsOf(ids));
  }

  // ---------- expandir/recolher ----------

  toggleExpand(id) {
    const item = this.project.get(id);
    if (!item || !this.canExpand(item)) return;
    item.expanded = !item.expanded;
    // Recolher/expandir descarta o tamanho ajustado: a área volta ao tamanho do conteúdo.
    this.areaSizes.delete(id);
    this.raise([id]);
    bus.emit('project:changed', this.project);
  }

  // ---------- criar / editar / excluir ----------

  validateName(parentId, name, exceptId = null) {
    const trimmed = name.trim();
    if (!trimmed) return t('modal.required');
    if (INVALID_NAME.test(trimmed)) return t('items.invalidName');
    if (this.project.nameTaken(parentId, trimmed, exceptId)) return t('items.nameTaken');
    return null;
  }

  // Posição livre abaixo dos filhos existentes (coordenadas locais do pai).
  autoPosition(parentId, excludeIds = new Set()) {
    const cfg = theme().canvas.item;
    const children = this.project.children(parentId).filter((c) => !excludeIds.has(c.id));
    if (!children.length) return { x: 0, y: 0 };
    const origin = contentOrigin(this.layout, parentId);
    let minX = Infinity;
    let bottom = -Infinity;
    for (const child of children) {
      const rect = this.layout.entries.get(child.id)?.rect;
      minX = Math.min(minX, child.x);
      bottom = Math.max(bottom, rect ? rect.y + rect.h - origin.y : child.y + cfg.cardHeight);
    }
    return { x: this.snap(minX), y: this.snap(bottom + AUTO_GAP) };
  }

  // world: ponto onde criar (ou null para posicionar automaticamente dentro de parentId).
  async createItem({ kind, parentId, world, fileType }) {
    const isFolder = kind === 'folder';
    const defaultName = isFolder ? t('items.defaultFolderName') : fileType?.defaultName ?? '';
    const title = isFolder
      ? t('items.newFolder')
      : fileType
        ? fileType.newLabel ?? t('items.newOfType', { type: fileType.label })
        : t('items.newFile');
    const extensions = allFileTypes().flatMap((ft) => ft.extensions.map((e) => `.${e}`));

    const result = await openModal({
      title,
      fields: [
        {
          name: 'name',
          label: t('items.name'),
          value: this.project.uniqueName(parentId, defaultName || 'arquivo'),
          required: true,
          hint: isFolder || fileType ? undefined : t('items.extensionHint', { list: extensions.join(' ') }),
        },
      ],
      validate: ({ name }) => ({ name: this.validateName(parentId, name) }),
    });
    if (!result) return;

    let pos;
    if (world) {
      const origin = contentOrigin(this.layout, parentId);
      pos = { x: this.snap(world.x - origin.x), y: this.snap(world.y - origin.y) };
    } else {
      pos = this.autoPosition(parentId);
    }
    const item = createItem({
      kind,
      name: result.values.name.trim(),
      parentId,
      x: pos.x,
      y: pos.y,
      z: this.project.nextZ(parentId),
    });
    this.history.execute(addItems(this.project, [item], [], t('history.create', { name: item.name })));
    this.select([item.id]);
  }

  // Item do diretório real: o app não renomeia, exclui nem muda de pasta.
  #locked() {
    toast.info(t('real.locked'));
  }

  async renameItem(id) {
    const item = this.project.get(id);
    if (!item) return;
    if (isReal(this.project, item)) return this.#locked();
    const result = await openModal({
      title: t('items.rename'),
      fields: [{ name: 'name', label: t('items.name'), value: item.name, required: true }],
      validate: ({ name }) => ({ name: this.validateName(item.parentId, name, item.id) }),
    });
    if (!result || result.values.name.trim() === item.name) return;
    this.history.execute(updateItem(this.project, id, { name: result.values.name.trim() }, t('history.rename')));
  }

  #validateAutoload(name, itemId) {
    const value = String(name ?? '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return t('items.autoloadInvalid');
    if (autoloads(this.project).some((a) => a.name === value && a.item.id !== itemId)) return t('items.autoloadTaken');
    return null;
  }

  async editProperties(id) {
    const item = this.project.get(id);
    if (!item) return;
    const palette = Object.keys(theme().palette ?? {});
    const current = item.color ?? '';
    const colorChoice = !current ? '' : current.startsWith('palette:') ? current : 'custom';
    const script = this.graph.isScript(item) && fileTypeOfItem(item).autoload !== false;
    const real = isReal(this.project, item);
    // Linguagem do arquivo (só quando o projeto tem mais de uma): automática = pela extensão.
    const languages = item.kind === 'file' && loadedProfiles().length > 1 ? loadedProfiles() : [];
    const autoId = profileIdFor({ ...item, profile: null });
    const autoLanguage = languages.find((p) => p.id === autoId);

    const result = await openModal({
      title: t('items.properties'),
      width: '460px',
      fields: [
        { name: 'name', label: t('items.name'), value: item.name, required: true, ...(real ? { hint: t('real.nameLocked') } : {}) },
        {
          name: 'color',
          label: t('items.color'),
          type: 'select',
          value: colorChoice,
          options: [
            { value: '', label: t('colors.none') },
            ...palette.map((key) => ({ value: `palette:${key}`, label: t(`colors.${key}`) })),
            { value: 'custom', label: t('colors.custom') },
          ],
        },
        {
          name: 'customColor',
          label: t('items.customColor'),
          type: 'color',
          value: current.startsWith('#') ? current : '#4f8cff',
          hint: t('items.customColorHint'),
        },
        ...(languages.length
          ? [{
              name: 'profile',
              label: t('items.language'),
              type: 'select',
              value: item.profile ?? '',
              options: [
                { value: '', label: t('items.languageAuto', { name: autoLanguage?.name ?? '' }) },
                ...languages.map((p) => ({ value: p.id, label: p.name })),
              ],
              hint: t('items.languageHint'),
            }]
          : []),
        { name: 'description', label: t('items.description'), type: 'textarea', value: item.description },
        { name: 'tags', label: t('items.tags'), value: item.tags.join(', '), hint: t('items.tagsHint') },
        // Script global (autoload): carregado pela engine com um nome acessível de qualquer script.
        ...(script
          ? [
              { name: 'autoload', label: t('items.autoload'), type: 'checkbox', value: Boolean(item.autoload), hint: t('items.autoloadHint') },
              { name: 'autoloadName', label: t('items.autoloadName'), value: item.autoload || pascalCase(item.name.replace(/\.[^.]+$/, '')) },
            ]
          : []),
      ],
      validate: ({ name, autoload, autoloadName }) => ({
        name: this.validateName(item.parentId, name, item.id),
        autoloadName: script && autoload ? this.#validateAutoload(autoloadName, item.id) : null,
      }),
    });
    if (!result) return;

    const { name, color, customColor, description, tags, autoload, autoloadName, profile } = result.values;
    const patch = {
      name: real ? item.name : name.trim(),
      color: color === 'custom' ? customColor : color || null,
      description,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    };
    if (script) patch.autoload = autoload ? autoloadName.trim() : null;
    if (languages.length) patch.profile = profile || null;
    this.history.execute(updateItem(this.project, id, patch, t('history.editProperties')));
  }

  async deleteSelection() {
    const all = this.selectedItems();
    const items = all.filter((i) => !isReal(this.project, i));
    if (items.length < all.length) this.#locked();
    if (!items.length) return;
    const withContent = items.filter((i) => this.project.children(i.id).length);
    if (withContent.length) {
      const ok = await confirmDialog(
        withContent.length === 1
          ? t('items.confirmDeleteFolder', { name: withContent[0].name, count: this.project.descendants(withContent[0].id).length })
          : t('items.confirmDeleteMany', { count: items.length }),
        { danger: true, confirmLabel: t('items.delete') },
      );
      if (!ok) return;
    }
    this.history.execute(removeItems(this.project, items.map((i) => i.id), t('history.delete', { count: items.length })));
  }

  // ---------- copiar / colar ----------

  copySelection() {
    const roots = this.selectedItems();
    if (!roots.length) return false;
    const all = new Map();
    for (const root of roots) {
      all.set(root.id, root);
      for (const d of this.project.descendants(root.id)) all.set(d.id, d);
    }
    const relations = [...this.project.relations.values()].filter((r) => all.has(r.from) && all.has(r.to));
    this.clipboard = {
      rootIds: roots.map((r) => r.id),
      items: structuredClone([...all.values()]),
      relations: structuredClone(relations),
    };
    bus.emit('status', t('clipboard.copied', { count: roots.length }));
    return true;
  }

  // target: { parentId, world } (posiciona no ponto) ou { parentId, local } ou { parentId } (automático)
  paste(target) {
    const clip = this.clipboard;
    if (!clip) return;
    const parentId = target.parentId;
    const idMap = new Map(clip.items.map((item) => [item.id, uid('itm')]));
    const roots = clip.items.filter((item) => clip.rootIds.includes(item.id));
    const minX = Math.min(...roots.map((r) => r.x));
    const minY = Math.min(...roots.map((r) => r.y));

    let base;
    if (target.world) {
      const origin = contentOrigin(this.layout, parentId);
      base = { x: this.snap(target.world.x - origin.x), y: this.snap(target.world.y - origin.y) };
    } else {
      base = target.local ?? this.autoPosition(parentId);
    }

    const reserved = new Set();
    let z = this.project.nextZ(parentId);
    const items = clip.items.map((source) => {
      const item = structuredClone(source);
      item.id = idMap.get(source.id);
      if (clip.rootIds.includes(source.id)) {
        item.parentId = parentId;
        item.x = base.x + (source.x - minX);
        item.y = base.y + (source.y - minY);
        item.z = z++;
        item.name = this.project.uniqueName(parentId, source.name, reserved);
        reserved.add(item.name.toLowerCase());
      } else {
        item.parentId = idMap.get(source.parentId);
      }
      return item;
    });
    const relations = clip.relations.map((r) => ({ ...r, id: uid('rel'), from: idMap.get(r.from), to: idMap.get(r.to) }));

    this.history.execute(addItems(this.project, items, relations, t('history.paste', { count: roots.length })));
    this.select(items.filter((i) => i.parentId === parentId).map((i) => i.id));
  }

  pasteAtPointer() {
    if (!this.clipboard) return;
    const container = containerAt(this.layout, this.project, this.pointerWorld);
    this.paste(container.collapsed ? { parentId: container.id } : { parentId: container.id, world: this.pointerWorld });
  }

  duplicateSelection() {
    const items = this.selectedItems();
    if (!items.length) return;
    const saved = this.clipboard;
    this.copySelection();
    const grid = this.project.settings.gridSize;
    const minX = Math.min(...items.map((i) => i.x));
    const minY = Math.min(...items.map((i) => i.y));
    this.paste({ parentId: items[0].parentId, local: { x: minX + grid * 2, y: minY + grid * 2 } });
    this.clipboard = saved;
  }

  // ---------- arrastar e soltar ----------

  // Decide o destino da soltura. Retorna { parentId, mode: 'here' | 'auto', viaBreadcrumb } ou null.
  resolveDrop(world, client, { leave = false } = {}) {
    const items = this.selectedItems();
    if (!items.length) return null;
    const currentParent = items[0].parentId;
    const dragged = new Set(items.map((i) => i.id));

    const crumb = this.breadcrumbs.dropTargetAt(client.x, client.y);
    if (crumb) {
      if (crumb.id === currentParent || dragged.has(crumb.id)) return null;
      if (crumb.id && this.project.ancestors(crumb.id).some((a) => dragged.has(a.id))) return null;
      return { parentId: crumb.id, mode: 'auto', viaBreadcrumb: true };
    }

    // Usa o layout de antes do arraste: a área do pai cresce acompanhando o item,
    // então no layout atual o ponteiro estaria sempre "dentro" dela.
    const container = containerAt(this.dragLayout ?? this.layout, this.project, world, dragged);
    if (container.id === currentParent) return null;
    if (container.collapsed) return { parentId: container.id, mode: 'auto' };
    const deeper = container.id !== null && this.project.isDescendant(container.id, currentParent);
    if (deeper || leave) return { parentId: container.id, mode: 'here' };
    return { parentId: container.id, mode: 'blocked' };
  }

  // Script/cena expandido sob o ponto (no layout de antes do arraste), ignorando os itens
  // arrastados. Só vale se for o item mais acima ali (pasta por cima bloqueia).
  // Retorna { id, entry } ou null.
  graphAreaAt(world, dragged) {
    const layout = this.dragLayout ?? this.layout;
    if (!layout) return null;
    for (let i = layout.order.length - 1; i >= 0; i--) {
      const entry = layout.entries.get(layout.order[i]);
      const item = entry.item;
      if (dragged.has(item.id) || this.project.ancestors(item.id).some((a) => dragged.has(a.id))) continue;
      if (!entry.rect || world.x < entry.rect.x || world.y < entry.rect.y || world.x > entry.rect.x + entry.rect.w || world.y > entry.rect.y + entry.rect.h) continue;
      return entry.expanded && this.graph.supportsGraph(item) ? { id: item.id, entry } : null;
    }
    return null;
  }

  // Desfaz o movimento visual de um arraste (sem entrar no histórico).
  cancelDrag(starts) {
    for (const [id, s] of starts) Object.assign(this.project.get(id), s);
    this.project.invalidate();
    bus.emit('project:changed', this.project);
  }

  // starts: Map id → { x, y, parentId, z } (estado antes do arraste)
  commitDrag(starts, drop) {
    const items = [...starts.keys()].map((id) => this.project.get(id));
    // Item do diretório real só muda de posição dentro da pasta onde está.
    if (drop && items.some((i) => isReal(this.project, i) && drop.parentId !== starts.get(i.id).parentId)) {
      this.#locked();
      drop = null;
    }
    const restore = () => {
      for (const [id, s] of starts) Object.assign(this.project.get(id), s);
      this.project.invalidate();
      bus.emit('project:changed', this.project);
    };

    if (drop && drop.mode !== 'blocked') {
      const conflict = items.find((i) => this.project.nameTaken(drop.parentId, i.name));
      if (conflict) {
        restore();
        toast.warning(t('items.moveConflict', { name: conflict.name }));
        return;
      }

      const oldOrigin = contentOrigin(this.layout, items[0].parentId);
      let positions;
      if (drop.mode === 'here') {
        const origin = contentOrigin(this.layout, drop.parentId);
        positions = items.map((i) => ({
          x: this.snap(oldOrigin.x + i.x - origin.x),
          y: this.snap(oldOrigin.y + i.y - origin.y),
        }));
      } else {
        const base = this.autoPosition(drop.parentId, new Set(starts.keys()));
        const minX = Math.min(...items.map((i) => i.x));
        const minY = Math.min(...items.map((i) => i.y));
        positions = items.map((i) => ({ x: base.x + i.x - minX, y: base.y + i.y - minY }));
      }

      let z = this.project.nextZ(drop.parentId);
      const moves = items.map((item, index) => ({
        id: item.id,
        from: { ...starts.get(item.id) },
        to: { ...positions[index], parentId: drop.parentId, z: z++ },
      }));
      const target = drop.parentId ? this.project.get(drop.parentId).name : this.rootLabel();
      this.history.execute(moveItems(this.project, moves, t('history.moveInto', { target })));
      return;
    }

    const moves = items
      .map((item) => ({ id: item.id, from: { ...starts.get(item.id) }, to: { x: item.x, y: item.y, parentId: item.parentId, z: item.z } }))
      .filter((m) => m.from.x !== m.to.x || m.from.y !== m.to.y);
    if (moves.length) this.history.execute(moveItems(this.project, moves, t('history.move', { count: moves.length })));
    else restore();
  }
}
