import { locale, t } from '../i18n/i18n.js';
import { fileLinkSupported } from '../storage/fileLink.js';
import { pickFiles } from '../storage/importExport.js';
import {
  createProject,
  duplicateProject,
  exportRecords,
  fetchLanguageIndex,
  fetchLanguageProfile,
  importTexts,
  linkRecordToFile,
  moveToTrash,
  openFromDisk,
  purgeExpiredTrash,
  renameProject,
  restoreFromTrash,
  restoreSnapshot,
  unlinkRecord,
} from '../storage/projectService.js';
import { settings } from '../core/settings.js';
import { confirmDialog, openModal } from './modal.js';
import { showContextMenu } from './contextMenu.js';
import { toast } from './toast.js';
import { openAppSettings } from './appSettings.js';

const DAY = 24 * 60 * 60 * 1000;

// Tela inicial: lista de projetos em cards, lixeira, criar/abrir/importar/exportar.
export class Launcher {
  #records = [];
  #thumbnails = new Map();
  #languages = [];
  #view = 'projects';
  #query = '';
  #sort = 'updated';
  #selected = new Set();
  #persisted = true;

  constructor(root, { store, onOpen }) {
    this.root = root;
    this.store = store;
    this.onOpen = onOpen;
  }

  async refresh() {
    this.#languages = this.#languages.length ? this.#languages : await fetchLanguageIndex().catch(() => []);
    this.#persisted = (await navigator.storage?.persisted?.()) ?? true;
    const purged = await purgeExpiredTrash(this.store, settings().trashRetentionDays).catch(() => 0);
    if (purged) toast.info(t('launcher.trashPurged', { count: purged }));
    this.#records = await this.store.list();
    this.#thumbnails.clear();
    for (const record of this.#records) {
      const thumb = await this.store.thumbnail(record.id);
      if (thumb) this.#thumbnails.set(record.id, thumb);
    }
    const ids = new Set(this.#records.map((r) => r.id));
    for (const id of [...this.#selected]) if (!ids.has(id)) this.#selected.delete(id);
    this.render();
  }

  // ---------- renderização ----------

  #visibleRecords() {
    const inTrash = this.#view === 'trash';
    const query = this.#query.trim().toLowerCase();
    return this.#records
      .filter((r) => Boolean(r.deletedAt) === inTrash)
      .filter((r) => !query || r.name.toLowerCase().includes(query) || (r.description ?? '').toLowerCase().includes(query))
      .sort((a, b) => (this.#sort === 'name' ? a.name.localeCompare(b.name, locale()) : b.updatedAt - a.updatedAt));
  }

  render() {
    const inTrash = this.#view === 'trash';
    const records = this.#visibleRecords();
    const activeCount = this.#records.filter((r) => !r.deletedAt).length;
    const trashCount = this.#records.length - activeCount;
    const selectedVisible = records.filter((r) => this.#selected.has(r.id));

    this.root.replaceChildren();
    const page = el('div', 'launcher__page');

    const header = el('header', 'launcher__header');
    header.append(el('h1', 'launcher__title', t('app.name')));
    const tabs = el('nav', 'launcher__tabs');
    tabs.append(
      this.#tab('projects', t('launcher.projects', { count: activeCount })),
      this.#tab('trash', t('launcher.trash', { count: trashCount })),
    );
    header.append(tabs);

    const tools = el('div', 'launcher__tools');
    const search = el('input', 'field__input launcher__search');
    search.type = 'search';
    search.placeholder = t('launcher.search');
    search.value = this.#query;
    search.addEventListener('input', () => {
      this.#query = search.value;
      this.#renderGrid();
    });
    const sort = el('select', 'field__input launcher__sort');
    for (const [value, label] of [['updated', t('launcher.sortUpdated')], ['name', t('launcher.sortName')]]) {
      const opt = el('option', null, label);
      opt.value = value;
      sort.append(opt);
    }
    sort.value = this.#sort;
    sort.addEventListener('change', () => {
      this.#sort = sort.value;
      this.#renderGrid();
    });
    const gear = el('button', 'btn btn--icon', '⚙');
    gear.type = 'button';
    gear.title = t('settings.title');
    gear.addEventListener('click', () => openAppSettings());
    tools.append(search, sort, gear);
    header.append(tools);
    page.append(header);

    const actions = el('div', 'launcher__actions');
    const count = selectedVisible.length;
    if (inTrash) {
      actions.append(
        button(t('launcher.restoreSelected', { count }), 'default', () => this.#restoreSelected(selectedVisible), !count),
        button(t('launcher.deleteSelected', { count }), 'danger', () => this.#deleteForever(selectedVisible), !count),
        button(t('launcher.emptyTrash'), 'ghost', () => this.#emptyTrash(), !trashCount),
      );
    } else {
      actions.append(
        button(t('launcher.newProject'), 'primary', () => this.#create()),
        button(fileLinkSupported ? t('launcher.openFile') : t('launcher.openFileFallback'), 'default', () => this.#openFile()),
        button(t('launcher.import'), 'default', () => this.#import()),
        button(t('launcher.exportSelected', { count }), 'default', () => this.#exportSelected(), !count),
        button(t('launcher.trashSelected', { count }), 'danger', () => this.#trashSelected(selectedVisible), !count),
      );
    }
    if (records.length) {
      const all = records.every((r) => this.#selected.has(r.id));
      actions.append(
        button(all ? t('launcher.selectNone') : t('launcher.selectAll'), 'ghost', () => {
          for (const r of records) all ? this.#selected.delete(r.id) : this.#selected.add(r.id);
          this.render();
        }),
      );
    }
    page.append(actions);

    if (!this.#persisted && !inTrash) page.append(el('p', 'launcher__notice', t('launcher.notPersisted')));

    this.grid = el('div', 'launcher__grid');
    page.append(this.grid);
    this.root.append(page);
    this.#renderGrid();
  }

  #renderGrid() {
    const records = this.#visibleRecords();
    this.grid.replaceChildren();
    if (!records.length) {
      const empty = this.#view === 'trash' ? t('launcher.trashEmpty') : this.#query ? t('launcher.noResults') : t('launcher.empty');
      this.grid.append(el('p', 'launcher__empty', empty));
      return;
    }
    for (const record of records) this.grid.append(this.#card(record));
  }

  #tab(view, label) {
    const btn = el('button', 'launcher__tab', label);
    btn.type = 'button';
    if (this.#view === view) btn.classList.add('launcher__tab--active');
    btn.addEventListener('click', () => {
      this.#view = view;
      this.#selected.clear();
      this.render();
    });
    return btn;
  }

  #card(record) {
    const inTrash = Boolean(record.deletedAt);
    const card = el('article', 'project-card');
    card.tabIndex = 0;
    if (this.#selected.has(record.id)) card.classList.add('project-card--selected');

    const thumb = el('div', 'project-card__thumb');
    const src = this.#thumbnails.get(record.id);
    if (src) {
      const img = el('img');
      img.src = src;
      img.alt = '';
      thumb.append(img);
    } else {
      thumb.append(el('span', 'project-card__placeholder', record.name.slice(0, 1).toUpperCase()));
    }
    card.append(thumb);

    const check = el('input', 'project-card__check');
    check.type = 'checkbox';
    check.checked = this.#selected.has(record.id);
    check.title = t('launcher.select');
    check.addEventListener('click', (event) => event.stopPropagation());
    check.addEventListener('change', () => {
      if (check.checked) this.#selected.add(record.id);
      else this.#selected.delete(record.id);
      this.render();
    });
    card.append(check);

    const menu = el('button', 'btn btn--icon project-card__menu', '⋯');
    menu.type = 'button';
    menu.title = t('launcher.actions');
    menu.addEventListener('click', (event) => {
      event.stopPropagation();
      const rect = menu.getBoundingClientRect();
      showContextMenu(rect.left, rect.bottom + 4, inTrash ? this.#trashMenu(record) : this.#projectMenu(record));
    });
    card.append(menu);

    const body = el('div', 'project-card__body');
    body.append(el('h3', 'project-card__name', record.name || t('project.untitled')));
    if (record.description) body.append(el('p', 'project-card__desc', record.description));
    const language = this.#languages.find((l) => l.id === record.languageProfile)?.name ?? record.languageProfile;
    const date = new Intl.DateTimeFormat(locale(), { dateStyle: 'short', timeStyle: 'short' }).format(record.updatedAt);
    body.append(el('div', 'project-card__meta', `${language} · ${t('launcher.items', { count: record.itemCount })} · ${date}`));

    const badges = el('div', 'project-card__badges');
    if (record.link) badges.append(el('span', 'badge badge--link', `🔗 ${record.link.fileName}`));
    else if (!record.lastExportedAt) badges.append(el('span', 'badge badge--warning', t('launcher.browserOnly')));
    if (inTrash) {
      const days = settings().trashRetentionDays;
      const left = days ? Math.max(0, Math.ceil((record.deletedAt + days * DAY - Date.now()) / DAY)) : null;
      badges.append(el('span', 'badge', left === null ? t('launcher.inTrash') : t('launcher.inTrashDays', { days: left })));
    }
    body.append(badges);
    card.append(body);

    if (!inTrash) {
      card.addEventListener('click', () => this.onOpen(record));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') this.onOpen(record);
      });
    }
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, inTrash ? this.#trashMenu(record) : this.#projectMenu(record));
    });
    return card;
  }

  #projectMenu(record) {
    const entries = [
      { label: t('launcher.open'), action: () => this.onOpen(record) },
      { label: t('launcher.rename'), action: () => this.#rename(record) },
      { label: t('launcher.duplicate'), action: () => this.#duplicate(record) },
      { label: t('launcher.export'), action: () => this.#run(() => exportRecords(this.store, [record])) },
      { label: t('launcher.versions'), action: () => this.#versions(record) },
      'separator',
    ];
    if (record.link) {
      entries.push({ label: t('launcher.unlink'), action: () => this.#run(() => unlinkRecord(this.store, record)) });
    } else {
      entries.push({
        label: t('launcher.linkFile'),
        disabled: !fileLinkSupported,
        action: () => this.#run(() => linkRecordToFile(this.store, record)),
      });
    }
    entries.push('separator', { label: t('launcher.moveToTrash'), danger: true, action: () => this.#run(() => moveToTrash(this.store, record)) });
    return entries;
  }

  #trashMenu(record) {
    return [
      { label: t('launcher.restore'), action: () => this.#run(() => restoreFromTrash(this.store, record)) },
      'separator',
      { label: t('launcher.deleteForever'), danger: true, action: () => this.#deleteForever([record]) },
    ];
  }

  // ---------- ações ----------

  async #run(fn, successMessage) {
    try {
      await fn();
      if (successMessage) toast.success(successMessage);
    } catch (error) {
      toast.error(storageMessage(error));
    }
    await this.refresh();
  }

  async #create() {
    const languages = this.#languages.length ? this.#languages : [{ id: 'gdscript', name: 'GDScript' }];
    const profile = await fetchLanguageProfile(languages[0].id).catch(() => null);
    const templates = profile?.templates ?? [];
    const result = await openModal({
      title: t('launcher.newProject'),
      width: '460px',
      fields: [
        { name: 'name', label: t('launcher.projectName'), value: '', required: true, hint: t('launcher.nameUrlHint') },
        { name: 'description', label: t('items.description'), type: 'textarea', rows: 3 },
        {
          name: 'languageProfile',
          label: t('launcher.language'),
          type: 'select',
          value: languages[0].id,
          options: languages.map((l) => ({ value: l.id, label: l.name })),
        },
        {
          name: 'templateId',
          label: t('launcher.template'),
          type: 'select',
          value: '',
          options: [{ value: '', label: t('launcher.templateEmpty') }, ...templates.map((tpl) => ({ value: tpl.id, label: tpl.label }))],
        },
      ],
      actions: [
        { id: 'cancel', label: t('modal.cancel'), variant: 'ghost' },
        { id: 'ok', label: t('launcher.create'), variant: 'primary', submit: true },
      ],
      validate: ({ name }) => ({ name: this.#nameError(name) }),
    });
    if (!result) return;
    try {
      const record = await createProject(this.store, { ...result.values, name: result.values.name.trim() });
      this.onOpen(record);
    } catch (error) {
      toast.error(storageMessage(error));
    }
  }

  // Nomes são únicos (incluindo a lixeira) porque identificam o projeto na URL.
  #nameError(name, exceptId = null) {
    const trimmed = name.trim();
    if (!trimmed) return t('modal.required');
    const lower = trimmed.toLowerCase();
    if (this.#records.some((r) => r.id !== exceptId && r.name.trim().toLowerCase() === lower)) return t('launcher.nameTaken');
    return null;
  }

  async #rename(record) {
    const result = await openModal({
      title: t('launcher.rename'),
      fields: [{ name: 'name', label: t('launcher.projectName'), value: record.name, required: true }],
      validate: ({ name }) => ({ name: this.#nameError(name, record.id) }),
    });
    if (!result || result.values.name.trim() === record.name) return;
    await this.#run(() => renameProject(this.store, record, result.values.name.trim()));
  }

  async #trashSelected(records) {
    await this.#run(async () => {
      for (const record of records) await moveToTrash(this.store, record);
    }, t('launcher.trashedMany', { count: records.length }));
    for (const record of records) this.#selected.delete(record.id);
    this.render();
  }

  async #restoreSelected(records) {
    await this.#run(async () => {
      for (const record of records) await restoreFromTrash(this.store, record);
    }, t('launcher.restoredMany', { count: records.length }));
  }

  async #duplicate(record) {
    await this.#run(
      () => duplicateProject(this.store, record, t('launcher.copyName', { name: record.name })),
      t('launcher.duplicated'),
    );
  }

  async #openFile() {
    if (!fileLinkSupported) {
      await this.#import();
      return;
    }
    try {
      const record = await openFromDisk(this.store, (existing) => this.#askImportConflict(existing));
      if (record) this.onOpen(record);
    } catch (error) {
      toast.error(storageMessage(error));
    }
  }

  async #import() {
    const files = await pickFiles({ multiple: true });
    if (!files.length) return;
    try {
      const texts = await Promise.all(files.map((f) => f.text()));
      const imported = await importTexts(this.store, texts, (existing) => this.#askImportConflict(existing));
      toast.success(t('launcher.imported', { count: imported.length }));
    } catch (error) {
      toast.error(storageMessage(error));
    }
    await this.refresh();
  }

  async #askImportConflict(existing) {
    const result = await openModal({
      title: t('launcher.importConflictTitle'),
      message: t('launcher.importConflictMessage', { name: existing.name }),
      actions: [
        { id: 'skip', label: t('launcher.skip'), variant: 'ghost' },
        { id: 'copy', label: t('launcher.importAsCopy'), variant: 'default' },
        { id: 'replace', label: t('launcher.replace'), variant: 'danger', submit: true },
      ],
    });
    return result?.action ?? 'skip';
  }

  async #exportSelected() {
    const records = this.#visibleRecords().filter((r) => this.#selected.has(r.id));
    await this.#run(() => exportRecords(this.store, records));
  }

  async #versions(record) {
    const snapshots = await this.store.snapshots(record.id);
    if (!snapshots.length) {
      toast.info(t('launcher.noVersions'));
      return;
    }
    const format = new Intl.DateTimeFormat(locale(), { dateStyle: 'short', timeStyle: 'medium' });
    const result = await openModal({
      title: t('launcher.versions'),
      message: t('launcher.versionsHint'),
      fields: [
        {
          name: 'key',
          label: t('launcher.version'),
          type: 'select',
          value: String(snapshots[0].key),
          options: snapshots.map((s) => ({
            value: String(s.key),
            label: `${format.format(s.createdAt)} — ${t(`launcher.snapshotReason.${s.reason}`)} (${t('launcher.items', { count: s.data.items.length })})`,
          })),
        },
      ],
      actions: [
        { id: 'cancel', label: t('modal.cancel'), variant: 'ghost' },
        { id: 'ok', label: t('launcher.restoreVersion'), variant: 'primary', submit: true },
      ],
    });
    if (!result) return;
    const snapshot = snapshots.find((s) => String(s.key) === result.values.key);
    await this.#run(() => restoreSnapshot(this.store, record, snapshot), t('launcher.versionRestored'));
  }

  async #deleteForever(records) {
    const ok = await confirmDialog(
      records.length === 1
        ? t('launcher.confirmDeleteForever', { name: records[0].name })
        : t('launcher.confirmEmptyTrash', { count: records.length }),
      { danger: true, confirmLabel: t('launcher.deleteForever') },
    );
    if (!ok) return;
    await this.#run(async () => {
      for (const record of records) await this.store.remove(record.id);
    });
  }

  #emptyTrash() {
    const records = this.#records.filter((r) => r.deletedAt);
    if (records.length) this.#deleteForever(records);
  }
}

export function storageMessage(error) {
  if (error?.code) return t(`storage.errors.${error.code}`);
  return t('errors.unexpected', { message: error?.message ?? String(error) });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, variant, onClick, disabled = false) {
  const btn = el('button', `btn btn--${variant}`, label);
  btn.type = 'button';
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}
