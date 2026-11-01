import { bus } from '../core/events.js';
import { t } from '../i18n/i18n.js';
import { scopeEntry, readGraph } from '../core/graph.js';
import { adapterFor, generateCode } from '../lang/adapters.js';
import { profileOf } from '../lang/profileLoader.js';
import { downloadText } from '../storage/importExport.js';
import { toast } from './toast.js';

// Coluna de código (só leitura) à direita do canvas: código do arquivo ativo (o do grafo
// selecionado ou o arquivo selecionado), atualizado a cada mudança. Clicar numa linha
// seleciona o nó dela; os nós selecionados destacam as linhas deles.

const WIDTH_KEY = 'projectdrawn.codePanel.width';
// Cores pelo perfil da linguagem ("syntax": { comments, keywords, types, capitalizedTypes }).
const rules = new WeakMap();
function syntaxRules(syntax = {}) {
  if (rules.has(syntax)) return rules.get(syntax);
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const comments = (syntax.comments ?? []).map((c) => `${escapeRe(c)}.*$`).join('|') || '(?!)';
  const out = {
    keywords: new Set(syntax.keywords ?? []),
    types: new Set(syntax.types ?? []),
    capitalized: syntax.capitalizedTypes !== false,
    tokens: new RegExp(`(${comments})|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')|(\\b\\d+(?:\\.\\d+)?(?:e-?\\d+)?\\b)|(@\\w+)|([A-Za-z_]\\w*)`, 'g'),
  };
  rules.set(syntax, out);
  return out;
}

function escape(text) {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

// Cores simples: comentário, texto, número, anotação, palavra-chave e tipo.
export function highlight(line, syntax) {
  const r = syntaxRules(syntax);
  let html = '';
  let last = 0;
  for (const m of line.matchAll(r.tokens)) {
    html += escape(line.slice(last, m.index));
    const [text, comment, string, number, annotation, word] = m;
    const isType = word && (r.types.has(word) || (r.capitalized && /^[A-Z]/.test(word)));
    const cls = comment ? 'com' : string ? 'str' : number ? 'nr' : annotation ? 'ann' : word && r.keywords.has(word) ? 'kw' : isType ? 'type' : null;
    html += cls ? `<span class="code-panel__${cls}">${escape(text)}</span>` : escape(text);
    last = m.index + text.length;
  }
  return html + escape(line.slice(last));
}

export class CodePanel {
  #frame = 0;
  #fileId = null;
  #cache = { item: null, revision: -1, result: null };
  #rows = [];
  #map = [];
  #rendered = null;

  constructor(root, editor) {
    this.root = root;
    this.editor = editor;
    root.classList.add('code-panel');
    const resizer = el('div', 'code-panel__resizer');
    const head = el('div', 'code-panel__head');
    this.title = el('span', 'code-panel__title');
    const copy = button(t('export.copy'), () => this.#copy());
    const save = button('⤓', () => this.#download());
    save.title = t('codePanel.download');
    head.append(this.title, copy, save);
    this.body = el('div', 'code-panel__body');
    root.append(resizer, head, this.body);
    this.#bindResize(resizer);

    const schedule = () => {
      if (!this.#frame) this.#frame = requestAnimationFrame(() => this.render());
    };
    bus.on('selection:changed', schedule);
    bus.on('project:changed', schedule);
    bus.on('session:changed', schedule);
  }

  refresh() {
    this.render();
  }

  // Arquivo mostrado: o do grafo selecionado; senão o arquivo selecionado; senão o último.
  #activeFile() {
    const editor = this.editor;
    const project = editor.project;
    if (!project) return null;
    const candidates = [editor.graph.fileId, editor.selection?.size === 1 ? [...editor.selection][0] : null, this.#fileId];
    for (const id of candidates) {
      const item = id ? project.get(id) : null;
      if (item && adapterFor(item)) return item;
    }
    return null;
  }

  #result(item) {
    const revision = this.editor.project.revision;
    if (this.#cache.item !== item || this.#cache.revision !== revision) {
      let result = null;
      try {
        result = generateCode(item);
      } catch (e) {
        result = { code: String(e?.message ?? e), lines: [] };
      }
      this.#cache = { item, revision, result };
    }
    return this.#cache.result;
  }

  render() {
    this.#frame = 0;
    if (this.root.hidden) return;
    const item = this.#activeFile();
    if (!item) {
      this.#fileId = null;
      this.title.textContent = t('codePanel.empty');
      this.body.replaceChildren();
      this.#rows = [];
      return;
    }
    const result = this.#result(item);
    const changedFile = this.#fileId !== item.id;
    if (changedFile || this.#rendered !== result) {
      this.#fileId = item.id;
      this.#rendered = result;
      this.title.textContent = item.name;
      this.#map = result?.lines ?? [];
      const lines = (result?.code ?? '').replace(/\n$/, '').split('\n');
      const syntax = profileOf(item)?.syntax;
      this.#rows = lines.map((text, i) => {
        const row = el('div', 'code-panel__line');
        const num = el('span', 'code-panel__num', String(i + 1));
        const code = el('span', 'code-panel__code');
        code.innerHTML = highlight(text, syntax) || ' ';
        row.append(num, code);
        if (this.#map[i]?.node) {
          row.classList.add('code-panel__line--link');
          row.addEventListener('click', () => this.#goTo(this.#map[i].node));
        }
        return row;
      });
      this.body.replaceChildren(...this.#rows);
    }
    this.#highlightSelection();
  }

  // Linhas dos nós selecionados (função/evento selecionado = linha do cabeçalho).
  #highlightSelection() {
    const gc = this.editor.graph;
    const selected = new Set();
    if (gc.fileId === this.#fileId) {
      for (const id of gc.nodes) selected.add(id);
      const graph = readGraph(this.editor.project.get(this.#fileId));
      for (const id of gc.scopes) {
        const entry = scopeEntry(graph, id);
        if (entry) selected.add(entry.id);
      }
    }
    let first = null;
    this.#rows.forEach((row, i) => {
      const on = Boolean(selected.size && this.#map[i]?.nodes.some((id) => selected.has(id)));
      row.classList.toggle('code-panel__line--selected', on);
      if (on && !first) first = row;
    });
    if (first && !this.root.contains(document.activeElement)) first.scrollIntoView({ block: 'nearest' });
  }

  // Seleciona o nó e centraliza a câmera nele (sem mudar o zoom).
  #goTo(nodeId) {
    const editor = this.editor;
    const fileId = this.#fileId;
    const placed = editor.layout?.entries.get(fileId)?.graph?.nodes.get(nodeId);
    if (!placed) {
      editor.revealGraph(fileId, { nodeId });
      return;
    }
    editor.graph.select(fileId, { nodes: [nodeId] });
    const r = placed.rect;
    editor.camera.centerOn(r.x + r.w / 2, r.y + r.h / 2, editor.renderer.width, editor.renderer.height);
    editor.renderer.invalidate();
    bus.emit('camera:changed', editor.camera);
  }

  async #copy() {
    const code = this.#rendered?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success(t('export.copied'));
    } catch {
      toast.error(t('export.copyFailed'));
    }
  }

  #download() {
    const item = this.#fileId ? this.editor.project?.get(this.#fileId) : null;
    if (item && this.#rendered?.code) downloadText(item.name, this.#rendered.code, 'text/plain');
  }

  // Arrastar a borda esquerda muda a largura (guardada no navegador).
  #bindResize(handle) {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (saved) this.root.style.width = `${saved}px`;
    } catch {
      // sem armazenamento local: largura padrão
    }
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startW = this.root.getBoundingClientRect().width;
      const move = (e) => {
        const w = Math.max(240, Math.min(window.innerWidth * 0.6, startW + startX - e.clientX));
        this.root.style.width = `${w}px`;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        try {
          localStorage.setItem(WIDTH_KEY, String(Math.round(this.root.getBoundingClientRect().width)));
        } catch {
          // ignora
        }
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, onClick) {
  const b = el('button', 'btn btn--ghost code-panel__btn', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
