import { t } from '../i18n/i18n.js';
import { validateLibrary } from '../storage/libraryValidation.js';
import { duplicateLibrary, exportLibrary, findLibraryByName, saveLibrary } from '../storage/libraryService.js';
import { createField, readField, setFieldError } from './form.js';
import { createTableEditor } from './tableEditor.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';

// Editor de biblioteca em tela cheia: formulários por seção + aba JSON bruto.
// Bibliotecas embutidas abrem somente leitura (botão "Duplicar para editar").

const SAVE_DELAY = 800;
const LIST_LIMIT = 300;

const SECTIONS = {
  language: ['general', 'types', 'nodes', 'fileTypes', 'relationTypes', 'templates', 'json'],
  catalog: ['general', 'families', 'classes', 'builtinTypes', 'utilityFunctions', 'singletons', 'json'],
};

const TYPE_CATEGORIES = ['primitive', 'struct', 'object', 'container', 'any', 'void'];
const NODE_TEMPLATES = ['full', 'compact', 'event', 'literal', 'declaration', 'comment'];
const FIELD_TYPES = ['text', 'number', 'bool', 'select', 'type', 'code'];

export class LibraryEditor {
  #record = null;
  #section = 'general';
  #selected = {};
  #filter = {};
  #saveTimer = 0;
  #saving = null;
  #state = 'saved';
  #errors = [];

  // onBack(): volta ao launcher; onOpen(record): abre outra biblioteca; onRenamed(record): atualiza a URL
  constructor(root, { onBack, onOpen, onRenamed, errorMessage }) {
    this.root = root;
    this.onBack = onBack;
    this.onOpen = onOpen;
    this.onRenamed = onRenamed;
    this.errorMessage = errorMessage;
    window.addEventListener('keydown', (event) => {
      if (this.root.hidden || !this.#record) return;
      if ((event.ctrlKey || event.metaKey) && (event.key ?? '').toLowerCase() === 's') {
        event.preventDefault();
        this.save();
      }
    });
  }

  get record() {
    return this.#record;
  }

  get readOnly() {
    return Boolean(this.#record?.builtin);
  }

  open(record) {
    this.#record = record;
    this.#section = 'general';
    this.#selected = {};
    this.#filter = {};
    this.#state = 'saved';
    this.#errors = validateLibrary(record);
    this.render();
  }

  async close() {
    await this.flush();
    this.#record = null;
    this.root.replaceChildren();
  }

  // ---------- salvar ----------

  #changed() {
    if (this.readOnly) return;
    this.#state = 'pending';
    this.#updateStatus();
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.save(), SAVE_DELAY);
  }

  async flush() {
    if (this.#state === 'pending') await this.save();
    else if (this.#saving) await this.#saving;
  }

  save() {
    clearTimeout(this.#saveTimer);
    if (!this.#record || this.readOnly) return Promise.resolve();
    const record = this.#record;
    this.#saving = (async () => {
      this.#state = 'saving';
      this.#updateStatus();
      try {
        this.#errors = validateLibrary(record);
        await saveLibrary(record);
        this.#state = 'saved';
      } catch (error) {
        this.#state = 'error';
        toast.error(this.errorMessage(error));
      }
      this.#updateStatus();
    })();
    return this.#saving;
  }

  #updateStatus() {
    if (!this.statusEl) return;
    const label = t(`storage.${this.#state === 'pending' ? 'pending' : this.#state}`);
    this.statusEl.textContent = this.readOnly ? t('libraries.readOnly') : label;
    this.problemsBtn.hidden = !this.#errors.length;
    this.problemsBtn.textContent = t('libraries.problems', { count: this.#errors.length });
  }

  #showProblems() {
    const list = el('ul', 'libedit__problems');
    for (const error of this.#errors) list.append(el('li', null, t(`libraries.errors.${error.key}`, error.params)));
    openModal({ title: t('libraries.problemsTitle'), content: list, actions: [{ id: 'ok', label: t('modal.close'), variant: 'primary', submit: true }] });
  }

  // ---------- layout ----------

  render() {
    const record = this.#record;
    this.root.replaceChildren();
    const page = el('div', 'libedit');

    const header = el('header', 'libedit__header');
    header.append(button(t('libraries.back'), 'ghost', () => this.onBack()));
    header.append(el('h1', 'libedit__title', record.name));
    header.append(el('span', 'badge', t(`libraries.kind.${record.kind}`)));
    header.append(el('span', 'badge', `v${record.version}`));
    const spacer = el('div', 'libedit__spacer');
    this.statusEl = el('span', 'libedit__status');
    this.problemsBtn = button('', 'ghost', () => this.#showProblems());
    this.problemsBtn.classList.add('libedit__problems-btn');
    header.append(spacer, this.problemsBtn, this.statusEl);
    if (this.readOnly) header.append(button(t('libraries.duplicateToEdit'), 'primary', () => this.#duplicate()));
    header.append(button(t('libraries.export'), 'default', () => exportLibrary(record)));
    page.append(header);

    if (this.readOnly) page.append(el('p', 'launcher__notice libedit__notice', t('libraries.builtinNotice')));

    const body = el('div', 'libedit__body');
    const nav = el('nav', 'libedit__nav');
    for (const section of SECTIONS[record.kind] ?? ['general', 'json']) {
      const btn = button(t(`libraries.section.${section}`), 'ghost', () => {
        this.#section = section;
        this.render();
      });
      btn.classList.add('libedit__nav-item');
      if (section === this.#section) btn.classList.add('libedit__nav-item--active');
      nav.append(btn);
    }
    this.main = el('main', 'libedit__main');
    body.append(nav, this.main);
    page.append(body);
    this.root.append(page);

    this.#renderSection();
    this.#updateStatus();
  }

  #renderSection() {
    const data = this.#record.data;
    const main = this.main;
    main.replaceChildren(this.#datalists());
    const changed = () => this.#changed();
    const ro = this.readOnly;

    switch (this.#section) {
      case 'general':
        return this.#renderGeneral(main);
      case 'types':
        return main.append(section(t('libraries.section.types'), createTableEditor({
          rows: (data.types ??= []), readOnly: ro, onChange: changed,
          newRow: () => ({ id: '', label: '', color: '#9aa0ad', category: 'primitive' }),
          columns: [
            { key: 'id', label: 'id' },
            { key: 'label', label: t('libraries.col.label') },
            { key: 'color', label: t('libraries.col.color'), type: 'color', width: '70px' },
            { key: 'category', label: t('libraries.col.category'), type: 'select', options: TYPE_CATEGORIES },
            { key: 'default', label: t('libraries.col.default'), type: 'json' },
          ],
        })));
      case 'nodes':
        return this.#renderList(main, {
          key: 'nodes',
          items: (data.nodes ??= []),
          label: (n) => `${n.title || n.id}`,
          sub: (n) => n.id,
          group: (n) => n.category || '—',
          create: () => ({ id: `node.${Date.now().toString(36)}`, title: t('libraries.newNodeTitle'), category: '', template: 'full', inputs: [], outputs: [] }),
          detail: (node, container, refresh) => this.#renderNode(node, container, refresh),
        });
      case 'fileTypes':
        return main.append(section(t('libraries.section.fileTypes'), createTableEditor({
          rows: (data.fileTypes ??= []), readOnly: ro, onChange: changed,
          newRow: () => ({ category: '', label: '', extensions: [] }),
          columns: [
            { key: 'category', label: t('libraries.col.category') },
            { key: 'label', label: t('libraries.col.label') },
            { key: 'newLabel', label: t('libraries.col.newLabel') },
            { key: 'extensions', label: t('libraries.col.extensions'), type: 'list' },
            { key: 'graph', label: t('libraries.col.graph'), type: 'select', options: ['', 'script', 'scene'] },
            { key: 'quickCreate', label: t('libraries.col.quickCreate'), type: 'checkbox', width: '60px' },
            { key: 'defaultName', label: t('libraries.col.defaultName') },
          ],
        })));
      case 'relationTypes':
        return main.append(section(t('libraries.section.relationTypes'), createTableEditor({
          rows: (data.relationTypes ??= []), readOnly: ro, onChange: changed,
          newRow: () => ({ id: '', label: '', color: '#8b92a3' }),
          columns: [
            { key: 'id', label: 'id' },
            { key: 'label', label: t('libraries.col.label') },
            { key: 'color', label: t('libraries.col.color'), type: 'color', width: '70px' },
            { key: 'dash', label: t('libraries.col.dash'), type: 'numbers', placeholder: '6, 4' },
            { key: 'route', label: t('libraries.col.route'), type: 'select', options: ['', 'bezier', 'orthogonal', 'straight'] },
          ],
        })));
      case 'families':
        return main.append(section(t('libraries.section.families'), createTableEditor({
          rows: (data.families ??= []), readOnly: ro, onChange: changed,
          newRow: () => ({ name: '', color: '#3498db' }),
          columns: [
            { key: 'name', label: t('libraries.col.class'), datalist: 'libedit-classes' },
            { key: 'color', label: t('libraries.col.color'), type: 'color', width: '70px' },
          ],
        }), t('libraries.familiesHint')));
      case 'classes':
        return this.#renderList(main, {
          key: 'classes',
          items: (data.classes ??= []),
          label: (c) => c.name,
          sub: (c) => c.inherits ?? '',
          group: null,
          create: () => ({ name: t('libraries.newClassName'), inherits: 'Object' }),
          detail: (cls, container, refresh) => this.#renderClass(cls, container, refresh),
        });
      case 'utilityFunctions':
        return main.append(section(t('libraries.section.utilityFunctions'), createTableEditor({
          rows: (data.utilityFunctions ??= []), readOnly: ro, onChange: changed,
          newRow: () => ({ name: '', args: [], returns: 'void' }),
          columns: [
            { key: 'name', label: t('libraries.col.name') },
            { key: 'args', label: t('libraries.col.args'), type: 'args' },
            { key: 'returns', label: t('libraries.col.returns'), datalist: 'libedit-types' },
            { key: 'category', label: t('libraries.col.category') },
          ],
        })));
      case 'singletons':
        return main.append(section(t('libraries.section.singletons'), createTableEditor({
          rows: (data.singletons ??= []), readOnly: ro, onChange: changed,
          newRow: () => ({ name: '', type: '' }),
          columns: [
            { key: 'name', label: t('libraries.col.name') },
            { key: 'type', label: t('libraries.col.type'), datalist: 'libedit-classes' },
          ],
        })));
      case 'templates':
      case 'builtinTypes': {
        const count = (data[this.#section] ?? []).length;
        return main.append(section(t(`libraries.section.${this.#section}`), el('p', 'libedit__hint', t('libraries.jsonOnly', { count }))));
      }
      case 'json':
        return this.#renderJson(main);
    }
  }

  // Sugestões de tipos e classes para os campos de texto.
  #datalists() {
    const data = this.#record.data;
    const frag = document.createDocumentFragment();
    const make = (id, values) => {
      const list = el('datalist');
      list.id = id;
      for (const value of new Set(values)) {
        const opt = el('option');
        opt.value = value;
        list.append(opt);
      }
      frag.append(list);
    };
    const classNames = (data.classes ?? []).map((c) => c.name);
    make('libedit-types', ['$T', 'Variant', 'void', ...(data.types ?? []).map((ty) => ty.id), ...(data.builtinTypes ?? []).map((b) => b.name), ...classNames]);
    make('libedit-classes', classNames);
    return frag;
  }

  #renderGeneral(main) {
    const record = this.#record;
    const data = record.data;
    const box = el('div', 'libedit__form');
    const fields = [
      { name: 'name', label: t('libraries.name'), value: record.name, required: true, hint: t('libraries.nameHint') },
      { name: 'version', label: t('libraries.version'), value: record.version },
      { name: 'description', label: t('items.description'), type: 'textarea', rows: 3, value: record.description },
      ...(record.kind === 'language'
        ? [{ name: 'rootLabel', label: t('libraries.rootLabel'), value: data.rootLabel ?? '', hint: t('libraries.rootLabelHint') }]
        : [
            { name: 'engine', label: t('libraries.engine'), value: data.engine ?? '' },
            { name: 'engineVersion', label: t('libraries.engineVersion'), value: data.engineVersion ?? '' },
          ]),
    ];
    for (const def of fields) {
      const field = createField(def);
      field.input.disabled = this.readOnly;
      field.input.addEventListener('change', async () => {
        const value = readField(field);
        if (def.name === 'name') {
          const name = value.trim();
          const other = name ? await findLibraryByName(name) : null;
          const error = !name ? t('modal.required') : other && other.id !== record.id ? t('libraries.nameTaken') : null;
          setFieldError(field, error);
          if (error) return;
          record.name = name;
          this.onRenamed?.(record);
          this.root.querySelector('.libedit__title').textContent = name;
        } else if (def.name === 'version' || def.name === 'description') {
          record[def.name] = value;
        } else {
          data[def.name] = value;
        }
        this.#changed();
      });
      box.append(field.element);
    }
    main.append(section(t('libraries.section.general'), box));
  }

  // Lista com busca à esquerda e detalhe do item selecionado à direita.
  #renderList(main, { key, items, label, sub, group, create, detail }) {
    const ro = this.readOnly;
    const wrap = el('div', 'libedit__split');
    const side = el('div', 'libedit__list');
    const detailBox = el('div', 'libedit__detail');

    const search = el('input', 'field__input');
    search.type = 'search';
    search.placeholder = t('libraries.searchItems');
    search.value = this.#filter[key] ?? '';
    const tools = el('div', 'libedit__list-tools');
    tools.append(search);
    if (!ro) {
      tools.append(button('+', 'default', () => {
        const item = create();
        items.push(item);
        this.#selected[key] = item;
        this.#changed();
        this.#renderSection();
      }));
    }
    const listEl = el('div', 'libedit__items');
    side.append(tools, listEl);

    const renderItems = () => {
      const q = (this.#filter[key] ?? '').trim().toLowerCase();
      const filtered = items.filter((item) => !q || label(item).toLowerCase().includes(q) || String(sub(item)).toLowerCase().includes(q));
      listEl.replaceChildren();
      let lastGroup = null;
      for (const item of filtered.slice(0, LIST_LIMIT)) {
        if (group) {
          const g = group(item);
          if (g !== lastGroup) {
            listEl.append(el('div', 'libedit__group', g));
            lastGroup = g;
          }
        }
        const row = button('', 'ghost', () => {
          this.#selected[key] = item;
          renderItems();
          renderDetail();
        });
        row.classList.add('libedit__item');
        if (this.#selected[key] === item) row.classList.add('libedit__item--active');
        row.append(el('span', 'libedit__item-label', label(item)), el('span', 'libedit__item-sub', String(sub(item))));
        listEl.append(row);
      }
      if (filtered.length > LIST_LIMIT) listEl.append(el('p', 'libedit__hint', t('libraries.listLimited', { shown: LIST_LIMIT, total: filtered.length })));
      if (!filtered.length) listEl.append(el('p', 'libedit__hint', t('launcher.noResults')));
    };

    const renderDetail = () => {
      detailBox.replaceChildren();
      const item = this.#selected[key];
      if (!item || !items.includes(item)) {
        detailBox.append(el('p', 'libedit__hint', t('libraries.selectItem', { count: items.length })));
        return;
      }
      if (!ro) {
        const actions = el('div', 'libedit__detail-actions');
        actions.append(
          button(t('launcher.duplicate'), 'ghost', () => {
            const copy = structuredClone(item);
            if ('id' in copy) copy.id = `${copy.id}_copia`;
            if ('name' in copy) copy.name = `${copy.name}_copia`;
            items.splice(items.indexOf(item) + 1, 0, copy);
            this.#selected[key] = copy;
            this.#changed();
            this.#renderSection();
          }),
          button(t('items.delete'), 'danger', () => {
            items.splice(items.indexOf(item), 1);
            this.#selected[key] = null;
            this.#changed();
            this.#renderSection();
          }),
        );
        detailBox.append(actions);
      }
      detail(item, detailBox, () => renderItems());
    };

    search.addEventListener('input', () => {
      this.#filter[key] = search.value;
      renderItems();
    });

    renderItems();
    renderDetail();
    wrap.append(side, detailBox);
    main.append(wrap);
  }

  // Campos simples de um objeto (texto, select, checkbox, textarea).
  #objectForm(container, target, defs) {
    const box = el('div', 'libedit__form libedit__form--grid');
    for (const def of defs) {
      const value = def.json ? (target[def.name] === undefined ? '' : JSON.stringify(target[def.name], null, 1)) : def.list ? (target[def.name] ?? []).join(', ') : target[def.name];
      const field = createField({ ...def, value: value ?? (def.type === 'checkbox' ? false : '') });
      field.input.disabled = this.readOnly;
      if (def.datalist) field.input.setAttribute('list', def.datalist);
      field.input.addEventListener('change', () => {
        let next = readField(field);
        if (def.list) next = next.split(',').map((s) => s.trim()).filter(Boolean);
        if (def.json) {
          if (String(next).trim() === '') next = undefined;
          else {
            try {
              next = JSON.parse(next);
              setFieldError(field, null);
            } catch {
              setFieldError(field, t('libraries.invalidJson'));
              return;
            }
          }
        }
        if (next === undefined || next === '' || next === false) delete target[def.name];
        else target[def.name] = next;
        if (def.wide) field.element.classList.add('libedit__field--wide');
        this.#changed();
        def.onChange?.();
      });
      if (def.wide) field.element.classList.add('libedit__field--wide');
      box.append(field.element);
    }
    container.append(box);
  }

  #renderNode(node, container, refreshList) {
    const ro = this.readOnly;
    const changed = () => this.#changed();
    container.append(el('h3', 'libedit__detail-title', node.title || node.id));
    this.#objectForm(container, node, [
      { name: 'id', label: 'id', required: true, onChange: refreshList },
      { name: 'title', label: t('libraries.col.title'), onChange: refreshList },
      { name: 'category', label: t('libraries.col.category'), hint: t('libraries.categoryHint'), onChange: refreshList },
      { name: 'template', label: t('libraries.col.template'), type: 'select', options: NODE_TEMPLATES.map((v) => ({ value: v })) },
      { name: 'keywords', label: t('libraries.col.keywords'), list: true, wide: true },
      { name: 'code', label: t('libraries.col.code'), type: 'textarea', rows: 2, wide: true, hint: t('libraries.codeHint') },
      { name: 'generics', label: t('libraries.col.generics'), type: 'textarea', rows: 2, json: true, hint: t('libraries.genericsHint') },
      { name: 'dynamicInputs', label: t('libraries.col.dynamicInputs'), type: 'textarea', rows: 2, json: true, hint: t('libraries.dynamicHint') },
      { name: 'dynamicOutputs', label: t('libraries.col.dynamicOutputs'), type: 'textarea', rows: 2, json: true },
    ]);
    const pinColumns = [
      { key: 'id', label: 'id', width: '110px' },
      { key: 'label', label: t('libraries.col.label') },
      { key: 'kind', label: t('libraries.col.kind'), type: 'select', options: ['data', 'flow'], width: '80px' },
      { key: 'type', label: t('libraries.col.type'), datalist: 'libedit-types' },
      { key: 'default', label: t('libraries.col.default'), type: 'json' },
    ];
    container.append(
      section(t('libraries.fields'), createTableEditor({
        rows: (node.fields ??= []), readOnly: ro, onChange: changed,
        newRow: () => ({ id: '', label: '', type: 'text' }),
        columns: [
          { key: 'id', label: 'id', width: '110px' },
          { key: 'label', label: t('libraries.col.label') },
          { key: 'type', label: t('libraries.col.type'), type: 'select', options: FIELD_TYPES },
          { key: 'default', label: t('libraries.col.default'), type: 'json' },
          { key: 'options', label: t('libraries.col.options'), type: 'list' },
        ],
      }), t('libraries.fieldsHint')),
      section(t('libraries.inputs'), createTableEditor({ rows: (node.inputs ??= []), readOnly: ro, onChange: changed, newRow: () => ({ id: '', kind: 'data', type: 'Variant' }), columns: pinColumns })),
      section(t('libraries.outputs'), createTableEditor({ rows: (node.outputs ??= []), readOnly: ro, onChange: changed, newRow: () => ({ id: '', kind: 'data', type: 'Variant' }), columns: pinColumns })),
    );
  }

  #renderClass(cls, container, refreshList) {
    const ro = this.readOnly;
    const changed = () => this.#changed();
    container.append(el('h3', 'libedit__detail-title', cls.name));
    this.#objectForm(container, cls, [
      { name: 'name', label: t('libraries.col.name'), required: true, onChange: refreshList },
      { name: 'inherits', label: t('libraries.col.inherits'), datalist: 'libedit-classes', onChange: refreshList },
      { name: 'abstract', label: t('libraries.col.abstract'), type: 'checkbox' },
      { name: 'enums', label: t('libraries.col.enums'), type: 'textarea', rows: 3, json: true, wide: true, hint: t('libraries.enumsHint') },
    ]);
    container.append(
      section(t('libraries.properties'), createTableEditor({
        rows: (cls.properties ??= []), readOnly: ro, onChange: changed, newRow: () => ({ name: '', type: 'Variant' }),
        columns: [
          { key: 'name', label: t('libraries.col.name') },
          { key: 'type', label: t('libraries.col.type'), datalist: 'libedit-types' },
        ],
      })),
      section(t('libraries.methods'), createTableEditor({
        rows: (cls.methods ??= []), readOnly: ro, onChange: changed, newRow: () => ({ name: '', args: [], returns: 'void' }),
        columns: [
          { key: 'name', label: t('libraries.col.name'), width: '160px' },
          { key: 'args', label: t('libraries.col.args'), type: 'args' },
          { key: 'returns', label: t('libraries.col.returns'), datalist: 'libedit-types', width: '120px' },
          { key: 'const', label: 'const', type: 'checkbox', width: '50px' },
          { key: 'static', label: 'static', type: 'checkbox', width: '50px' },
          { key: 'virtual', label: 'virtual', type: 'checkbox', width: '50px' },
        ],
      })),
      section(t('libraries.signals'), createTableEditor({
        rows: (cls.signals ??= []), readOnly: ro, onChange: changed, newRow: () => ({ name: '', args: [] }),
        columns: [
          { key: 'name', label: t('libraries.col.name'), width: '160px' },
          { key: 'args', label: t('libraries.col.args'), type: 'args' },
        ],
      })),
      section(t('libraries.constants'), createTableEditor({
        rows: (cls.constants ??= []), readOnly: ro, onChange: changed, newRow: () => ({ name: '', value: 0 }),
        columns: [
          { key: 'name', label: t('libraries.col.name') },
          { key: 'value', label: t('libraries.col.value'), type: 'json' },
        ],
      })),
    );
  }

  #renderJson(main) {
    const textarea = el('textarea', 'field__input libedit__json');
    textarea.value = JSON.stringify(this.#record.data, null, 2);
    textarea.spellcheck = false;
    textarea.readOnly = this.readOnly;
    const errorsEl = el('ul', 'libedit__problems');
    const actions = el('div', 'libedit__detail-actions');
    if (!this.readOnly) {
      actions.append(
        button(t('libraries.applyJson'), 'primary', () => {
          let data;
          try {
            data = JSON.parse(textarea.value);
          } catch (error) {
            errorsEl.replaceChildren(el('li', null, `${t('libraries.invalidJson')}: ${error.message}`));
            return;
          }
          const errors = validateLibrary({ ...this.#record, data });
          if (errors.length) {
            errorsEl.replaceChildren(...errors.map((e) => el('li', null, t(`libraries.errors.${e.key}`, e.params))));
            return;
          }
          this.#record.data = data;
          errorsEl.replaceChildren();
          this.#changed();
          toast.success(t('libraries.jsonApplied'));
        }),
        button(t('libraries.revertJson'), 'ghost', () => {
          textarea.value = JSON.stringify(this.#record.data, null, 2);
          errorsEl.replaceChildren();
        }),
      );
    }
    main.append(section(t('libraries.section.json'), actions, t('libraries.jsonHint')));
    main.lastElementChild.append(errorsEl, textarea);
  }

  async #duplicate() {
    try {
      const copy = await duplicateLibrary(this.#record, t('launcher.copyName', { name: this.#record.name }));
      toast.success(t('libraries.duplicated'));
      this.onOpen(copy);
    } catch (error) {
      toast.error(this.errorMessage(error));
    }
  }
}

function section(title, content, hint) {
  const box = el('section', 'libedit__section');
  box.append(el('h2', 'libedit__section-title', title));
  if (hint) box.append(el('p', 'libedit__hint', hint));
  box.append(content);
  return box;
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
