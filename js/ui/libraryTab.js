import { locale, t } from '../i18n/i18n.js';
import { libraryStore } from '../storage/libraryStore.js';
import { pickFiles } from '../storage/importExport.js';
import {
  createLibrary,
  deleteLibrary,
  duplicateLibrary,
  exportLibrary,
  importGodotApi,
  importLibraryPayload,
  libraryUsage,
  parseLibraryText,
  saveLibrary,
  uniqueLibraryName,
} from '../storage/libraryService.js';
import { confirmDialog, openModal } from './modal.js';
import { showContextMenu } from './contextMenu.js';
import { toast } from './toast.js';

// Aba "Bibliotecas" do launcher: perfis de linguagem e catálogos de engine.
export class LibraryTab {
  #records = [];
  #usage = new Map();

  constructor({ projectStore, onOpen, onChanged, errorMessage }) {
    this.projectStore = projectStore;
    this.onOpen = onOpen;
    this.onChanged = onChanged;
    this.errorMessage = errorMessage;
  }

  async load() {
    this.#records = await libraryStore().list();
    this.#usage = await libraryUsage(this.projectStore);
  }

  get count() {
    return this.#records.length;
  }

  renderActions(container) {
    container.append(
      button(t('libraries.new'), 'primary', () => this.#create()),
      button(t('libraries.import'), 'default', () => this.#import()),
    );
  }

  renderGrid(grid, { query, sort }) {
    const q = query.trim().toLowerCase();
    const records = this.#records
      .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q))
      .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, locale()) : b.updatedAt - a.updatedAt));
    grid.replaceChildren();
    if (!records.length) {
      grid.append(el('p', 'launcher__empty', q ? t('launcher.noResults') : t('libraries.empty')));
      return;
    }
    for (const record of records) grid.append(this.#card(record));
  }

  #card(record) {
    const card = el('article', 'project-card library-card');
    card.tabIndex = 0;

    const thumb = el('div', 'project-card__thumb library-card__thumb');
    thumb.append(el('span', 'library-card__icon', record.kind === 'catalog' ? '📚' : '🧩'));
    card.append(thumb);

    const menu = el('button', 'btn btn--icon project-card__menu', '⋯');
    menu.type = 'button';
    menu.title = t('launcher.actions');
    menu.addEventListener('click', (event) => {
      event.stopPropagation();
      const rect = menu.getBoundingClientRect();
      showContextMenu(rect.left, rect.bottom + 4, this.#menu(record));
    });
    card.append(menu);

    const body = el('div', 'project-card__body');
    body.append(el('h3', 'project-card__name', record.name));
    if (record.description) body.append(el('p', 'project-card__desc', record.description));
    body.append(el('div', 'project-card__meta', `${t(`libraries.kind.${record.kind}`)} · v${record.version} · ${summary(record)}`));

    const badges = el('div', 'project-card__badges');
    if (record.builtin) badges.append(el('span', 'badge', t('libraries.builtin')));
    const users = this.#usage.get(record.id) ?? [];
    if (users.length) badges.append(el('span', 'badge badge--link', t('libraries.usedBy', { count: users.length })));
    body.append(badges);
    card.append(body);

    card.addEventListener('click', () => this.onOpen(record));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.onOpen(record);
    });
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, this.#menu(record));
    });
    return card;
  }

  #menu(record) {
    return [
      { label: t('launcher.open'), action: () => this.onOpen(record) },
      { label: t('launcher.rename'), disabled: record.builtin, action: () => this.#rename(record) },
      { label: t('launcher.duplicate'), action: () => this.#duplicate(record) },
      { label: t('libraries.export'), action: () => exportLibrary(record) },
      'separator',
      { label: t('libraries.delete'), danger: true, disabled: record.builtin, action: () => this.#delete(record) },
    ];
  }

  async #run(fn, success) {
    try {
      const result = await fn();
      if (success) toast.success(success);
      return result;
    } catch (error) {
      toast.error(this.errorMessage(error));
      return null;
    } finally {
      await this.onChanged();
    }
  }

  #nameError(name, exceptId = null) {
    const trimmed = name.trim();
    if (!trimmed) return t('modal.required');
    const lower = trimmed.toLowerCase();
    return this.#records.some((r) => r.id !== exceptId && r.name.trim().toLowerCase() === lower) ? t('libraries.nameTaken') : null;
  }

  async #create() {
    const result = await openModal({
      title: t('libraries.new'),
      width: '460px',
      fields: [
        {
          name: 'kind',
          label: t('libraries.kindLabel'),
          type: 'select',
          value: 'language',
          options: [
            { value: 'language', label: t('libraries.kind.language') },
            { value: 'catalog', label: t('libraries.kind.catalog') },
          ],
        },
        { name: 'name', label: t('libraries.name'), required: true, hint: t('libraries.nameHint') },
        { name: 'version', label: t('libraries.version'), value: '1' },
        { name: 'description', label: t('items.description'), type: 'textarea', rows: 2 },
        {
          name: 'baseId',
          label: t('libraries.base'),
          type: 'select',
          value: '',
          hint: t('libraries.baseHint'),
          options: [
            { value: '', label: t('libraries.baseEmpty') },
            ...this.#records.map((r) => ({ value: r.id, label: `${r.name} (${t(`libraries.kind.${r.kind}`)})` })),
          ],
        },
      ],
      actions: [
        { id: 'cancel', label: t('modal.cancel'), variant: 'ghost' },
        { id: 'ok', label: t('launcher.create'), variant: 'primary', submit: true },
      ],
      validate: ({ name }) => ({ name: this.#nameError(name) }),
    });
    if (!result) return;
    const record = await this.#run(() => createLibrary({ ...result.values, name: result.values.name.trim() }));
    if (record) this.onOpen(record);
  }

  async #rename(record) {
    const result = await openModal({
      title: t('launcher.rename'),
      fields: [{ name: 'name', label: t('libraries.name'), value: record.name, required: true }],
      validate: ({ name }) => ({ name: this.#nameError(name, record.id) }),
    });
    if (!result) return;
    record.name = result.values.name.trim();
    await this.#run(() => saveLibrary(record));
  }

  async #duplicate(record) {
    await this.#run(() => duplicateLibrary(record, t('launcher.copyName', { name: record.name })), t('libraries.duplicated'));
  }

  async #delete(record) {
    const users = this.#usage.get(record.id) ?? [];
    const message = users.length
      ? t('libraries.confirmDeleteUsed', { name: record.name, projects: users.join(', ') })
      : t('libraries.confirmDelete', { name: record.name });
    if (!(await confirmDialog(message, { danger: true, confirmLabel: t('libraries.delete') }))) return;
    await this.#run(() => deleteLibrary(record));
  }

  async #import() {
    const files = await pickFiles({ multiple: true });
    for (const file of files) {
      try {
        const parsed = parseLibraryText(await file.text());
        if (parsed.kind === 'godot') await this.#importGodot(parsed.json);
        else {
          const record = await importLibraryPayload(parsed.payload, (existing) => this.#askConflict(existing));
          if (record) toast.success(t('libraries.imported', { name: record.name }));
        }
      } catch (error) {
        toast.error(`${file.name}: ${this.errorMessage(error)}`);
      }
    }
    await this.onChanged();
  }

  async #importGodot(json) {
    const h = json.header;
    const version = `${h.version_major}.${h.version_minor}${h.version_patch ? `.${h.version_patch}` : ''}`;
    const result = await openModal({
      title: t('libraries.godotTitle'),
      message: t('libraries.godotMessage', { version, count: json.classes.filter((c) => c.api_type !== 'editor').length }),
      fields: [{ name: 'name', label: t('libraries.name'), value: await uniqueLibraryName(`Godot ${version}`), required: true }],
      validate: ({ name }) => ({ name: this.#nameError(name) }),
      actions: [
        { id: 'cancel', label: t('modal.cancel'), variant: 'ghost' },
        { id: 'ok', label: t('libraries.importAction'), variant: 'primary', submit: true },
      ],
    });
    if (!result) return;
    const record = await importGodotApi(json, { name: result.values.name.trim() });
    toast.success(t('libraries.godotImported', { name: record.name, count: record.data.classes.length }));
  }

  async #askConflict(existing) {
    const result = await openModal({
      title: t('libraries.conflictTitle'),
      message: t('libraries.conflictMessage', { name: existing.name }),
      actions: [
        { id: 'skip', label: t('launcher.skip'), variant: 'ghost' },
        { id: 'copy', label: t('launcher.importAsCopy'), variant: 'default' },
        { id: 'replace', label: t('launcher.replace'), variant: 'danger', submit: true },
      ],
    });
    return result?.action ?? 'skip';
  }
}

function summary(record) {
  const d = record.data ?? {};
  if (record.kind === 'catalog') return t('libraries.summaryCatalog', { classes: d.classes?.length ?? 0 });
  return t('libraries.summaryLanguage', { nodes: d.nodes?.length ?? 0, types: d.types?.length ?? 0 });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, variant, onClick) {
  const btn = el('button', `btn btn--${variant}`, label);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}
