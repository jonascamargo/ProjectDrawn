// Conceitos: o que cada tipo de nó É, sem depender de linguagem (um conceito por arquivo nesta
// pasta). Cada nó da linguagem diz o conceito que veste (concept: 'variable'…) e o núcleo aplica as
// regras pelo conceito: área, script, o que contém, referências.
// Conceito: { id, area, script, pathable, contains, inside, references, reference, hidden }.
//   contains: conceitos aceitos dentro da área, ou '@script' = qualquer nó comum da linguagem.
//   inside: o nó só existe dentro de uma área desse conceito (em qualquer nível).
//   references: { get, set }: conceitos dos nós criados com Ctrl+clique (get) e Alt+clique (set) no nó;
//   reference: 'get' | 'set' — o nó é uma dessas referências (node.ref = id do alvo).
//   node + icon: nó do próprio núcleo (pasta e arquivo), igual em toda linguagem.
import { branch } from './branch.js';
import { builtin } from './builtin.js';
import { call } from './call.js';
import { constant } from './constant.js';
import { klass } from './class.js';
import { event } from './event.js';
import { file } from './file.js';
import { folder } from './folder.js';
import { func } from './function.js';
import { get } from './get.js';
import { literal } from './literal.js';
import { loop } from './loop.js';
import { method } from './method.js';
import { operator } from './operator.js';
import { parameter } from './parameter.js';
import { path } from './path.js';
import { property } from './property.js';
import { ret } from './return.js';
import { set } from './set.js';
import { variable } from './variable.js';

export const concepts = Object.fromEntries(
  [folder, file, klass, func, parameter, ret, variable, get, set, path, event, call, builtin, method, property, constant, branch, loop, operator, literal].map((c) => [c.id, c]),
);

// Na raiz do canvas: só pastas e arquivos.
export const rootContains = ['folder', 'file'];

// Regras do conceito que vão para a definição do nó (a linguagem pode trocar no próprio nó).
const FLAGS = ['area', 'script', 'pathable', 'contains', 'inside', 'references', 'reference', 'hidden'];

export function conceptFlags(concept) {
  return Object.fromEntries(FLAGS.filter((k) => concept[k] !== undefined).map((k) => [k, concept[k]]));
}
