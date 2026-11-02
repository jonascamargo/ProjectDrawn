import { conceptFlags, concepts } from './concepts/index.js';

// Linguagens registradas. Cada uma: { id, name, extensions: { ext: cor }, fileContains, types,
// canAssign, icons, nodes, natives }. extensions: as extensões de arquivo que ela cuida (e a cor do
// arquivo); fileContains: conceitos aceitos direto no arquivo; natives: métodos nativos
// ({ name, params: [{ name, type }], returns }) que uma Function com o mesmo nome sobrescreve, ou
// virtuals(classe): os nativos pela classe da linguagem de onde a classe em volta parte.
// classFiles: o arquivo é uma classe (fileFields: campos que ele ganha, ex.: class_name e extends;
// defaultBase: a classe de onde parte sem extends; projectClassColor: cor das classes do projeto).
// Nós montados na hora (muitos para uma lista, ex.: métodos das classes da Godot): memberDefs(classe)
// (os da classe e das pais), allMemberDefs() (todos, para a busca) e resolveNode(id) (ao abrir). Cada nó diz o conceito que veste (concept); o
// registro junta as regras do conceito com o que a linguagem definiu e marca o nó com a linguagem
// (lang). Pasta e arquivo são do núcleo: ficam em `core`, que vale fora dos scripts.
export class Languages {
  constructor(list = []) {
    const own = Object.values(concepts).filter((c) => c.node);
    this.core = {
      id: null,
      name: 'Core',
      extensions: {},
      types: {},
      icons: Object.fromEntries(own.map((c) => [c.node.icon, c.icon])),
      nodes: own.map((c) => ({ ...conceptFlags(c), ...c.node, concept: c.id, lang: null })),
    };
    this.list = [];
    this.prepared = new WeakMap(); // nó montado na hora → com as regras do conceito (uma vez só)
    for (const language of list) this.register(language);
  }

  register(language) {
    const entry = { ...language, nodes: language.nodes.map((def) => this.withConcept(language, def)) };
    this.list.push(entry);
    return entry;
  }

  // O nó com as regras do conceito e a marca da linguagem. Conceito que não existe (ou que é do
  // núcleo, como pasta e arquivo) é erro da linguagem.
  withConcept(language, def) {
    const concept = concepts[def.concept];
    if (!concept || concept.node) throw new Error(`${language.id}: node "${def.id}" has invalid concept "${def.concept}"`);
    return { ...conceptFlags(concept), ...def, lang: language.id };
  }

  // Nó montado na hora pela linguagem, preparado como os da lista (e guardado).
  prepare(language, def) {
    if (!this.prepared.has(def)) this.prepared.set(def, this.withConcept(language, def));
    return this.prepared.get(def);
  }

  // Nós montados na hora: language[method](arg), preparados (ex.: dynamic('gdscript', 'memberDefs', 'Node2D')).
  dynamic(lang, method, arg) {
    const language = this.get(lang);
    return (language[method]?.(arg) ?? []).map((def) => this.prepare(language, def));
  }

  // Linguagem pelo id; sem id (ou desconhecido), o núcleo.
  get(id) {
    return (id != null && this.list.find((l) => l.id === id)) || this.core;
  }

  // Linguagem do nó (a dos nós de pasta e arquivo é o núcleo).
  of(node) {
    return this.get(node?.lang);
  }

  // Linguagem do arquivo, pela extensão do nome; null se nenhuma cuida dela.
  forFile(file) {
    const ext = extensionOf(file.values.name);
    return this.list.find((l) => Object.hasOwn(l.extensions ?? {}, ext)) ?? null;
  }

  // Definição pelo id (também dos nós montados na hora). Sem linguagem: procura no núcleo e depois em
  // cada linguagem, na ordem.
  def(type, lang) {
    const pools = lang === undefined ? [this.core, ...this.list] : [this.get(lang)];
    for (const pool of pools) {
      const def = pool.nodes.find((d) => d.id === type) ?? pool.resolveNode?.(type);
      if (def) return pool.nodes.includes(def) ? def : this.prepare(pool, def);
    }
    return null;
  }

  // Primeiro nó da linguagem que veste o conceito (ex.: o get da variável, o caminho).
  byConcept(lang, concept) {
    return this.get(lang).nodes.find((d) => d.concept === concept) ?? null;
  }

  // Ícones de todas as linguagens (para carregar antes de medir os nós).
  icons() {
    return [this.core, ...this.list].flatMap((l) => Object.values(l.icons ?? {}));
  }

  // Cor própria do nó, quando não é a do ícone: pasta pela cor escolhida no inspetor; arquivo pela
  // extensão (na linguagem que cuida dela).
  nodeColor(node) {
    if (node.concept === 'folder') return node.values.color || null;
    if (node.concept === 'file') return this.forFile(node)?.extensions[extensionOf(node.values.name)] ?? null;
    return null;
  }
}

function extensionOf(name) {
  return String(name).split('.').pop().toLowerCase();
}
