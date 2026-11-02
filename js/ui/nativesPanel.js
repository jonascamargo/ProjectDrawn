import { normalize } from '../core/canvas/nodeMenu.js';
import { t } from '../core/i18n.js';

// Aba de métodos nativos: os de cada linguagem (que uma Function sobrescreve pelo nome), com busca.
// Linguagem com virtuals (GDScript): os da classe escolhida (ex.: Node2D) e das pais dela.
// Arrastar um método para dentro de um arquivo (ou classe) da linguagem cria a função dele.
export class NativesPanel {
  // onDragNative(language, native): começou a arrastar um método (quem soltar cria a função).
  // typePicker: o seletor com busca do painel, para escolher a classe.
  constructor({ languages, typePicker = null, onDragNative = () => {} }) {
    this.languages = languages.list.filter((l) => l.natives?.length || l.virtuals);
    this.onDragNative = onDragNative;
    this.typePicker = typePicker;
    this.base = {}; // classe escolhida por linguagem
    this.el = document.createElement('div');
    this.el.className = 'natives';
    this.select = document.createElement('select');
    for (const l of this.languages) {
      const option = document.createElement('option');
      option.value = l.id;
      option.textContent = l.name;
      this.select.append(option);
    }
    this.select.value = this.languages[0]?.id ?? '';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = t('natives.search');
    this.list = document.createElement('ul');
    this.classButton = document.createElement('button');
    this.classButton.type = 'button';
    this.classButton.className = 'inspector__type';
    this.classButton.addEventListener('click', () => {
      const language = this.language;
      const classes = Object.fromEntries(Object.entries(language.types ?? {}).filter(([, type]) => 'inherits' in type));
      this.typePicker?.open(this.classButton, { types: classes, value: this.classOf(language), onPick: (id) => {
        this.base[language.id] = id;
        this.refresh();
      } });
    });
    this.el.append(this.select, this.classButton, this.input, this.list);
    this.select.addEventListener('change', () => this.refresh());
    this.input.addEventListener('input', () => this.refresh());
    this.refresh();
  }

  get language() {
    return this.languages.find((l) => l.id === this.select.value) ?? this.languages[0] ?? null;
  }

  // Classe de onde os nativos partem (só em linguagem com virtuals); padrão: Node, se existir.
  classOf(language) {
    return this.base[language.id] ?? (language.types?.Node ? 'Node' : language.defaultBase);
  }

  // Lista da linguagem escolhida que casa com a busca: nome(parâmetros: tipo) → retorno.
  refresh() {
    const language = this.language;
    const q = normalize(this.input.value.trim());
    const label = (type) => language.types?.[type]?.label ?? type;
    this.classButton.hidden = !language?.virtuals;
    this.classButton.textContent = language?.virtuals ? this.classOf(language) : '';
    const all = language?.virtuals ? language.virtuals(this.classOf(language)) : language?.natives ?? [];
    const items = all.filter((n) => normalize(n.name).includes(q));
    this.list.replaceChildren(...items.map((native) => {
      const li = document.createElement('li');
      li.title = t('natives.drag', { lang: language.name });
      const name = document.createElement('span');
      name.className = 'natives__name';
      name.textContent = `${native.name}(${native.params.map((p) => `${p.name}: ${label(p.type)}`).join(', ')})`;
      name.title = name.textContent; // nome longo: cortado com …, completo na dica
      const returns = document.createElement('small');
      returns.textContent = `→ ${native.returns ? label(native.returns) : 'void'}`;
      li.append(name, returns);
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.onDragNative(language, native);
      });
      return li;
    }));
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = t('natives.empty');
      this.list.append(empty);
    }
  }
}
