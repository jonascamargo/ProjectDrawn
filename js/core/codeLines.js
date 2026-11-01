import { getDef } from '../lang/nodeRegistry.js';
import { isPureDef } from './codeFormat.js';

// Linhas do código ligadas aos nós. Os geradores marcam cada linha com o nó que a gerou
// (tag) e, no fim, lineMap devolve uma entrada por linha do código final:
//   { node, nodes } — node = nó da linha; nodes = ele + os nós de dado puros que o alimentam
//   (selecionar um "+" destaca a linha onde a conta aparece) — ou null.

export function tag(nodeId, text) {
  const line = new String(text);
  line.node = nodeId ?? null;
  return line;
}

// Mesmo nó de `from` com outro texto.
export function retag(from, text) {
  return from?.node ? tag(from.node, text) : text;
}

export function lineMap(graph, lines) {
  const feeders = new Map();
  const upstream = (id) => {
    if (feeders.has(id)) return feeders.get(id);
    const out = [];
    feeders.set(id, out);
    for (const w of graph.wires) {
      if (w.kind !== 'data' || w.to.node !== id) continue;
      const src = graph.nodes.find((n) => n.id === w.from.node);
      const def = src && getDef(src.type);
      if (!src || !(src.type === 'core.reroute' || (def && isPureDef(def)))) continue;
      out.push(src.id, ...upstream(src.id));
    }
    return out;
  };
  const map = [];
  for (const line of lines) {
    const owner = line?.node ? { node: line.node, nodes: [...new Set([line.node, ...upstream(line.node)])] } : null;
    for (const _ of String(line).split('\n')) map.push(owner);
  }
  return map;
}
