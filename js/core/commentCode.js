import { scopeEntry } from './graph.js';

const COMMENT_SIZE = { w: 320, h: 180 };

// Comentários do script no código exportado: nota solta (sem agrupar) ou que não envolve nada
// vai para o topo do arquivo; comentário que agrupa vai logo antes da primeira linha gerada
// por um dos nós (ou funções) dentro dele. prefix: "#" (GDScript), "//" (shader).
// Retorna { top: [linhas], take(nodeId, recuo) → linhas a escrever antes desse nó (uma vez) }.
export function commentPlan(graph, prefix) {
  const top = [];
  const owners = new Map(); // id do nó → ids dos comentários que o envolvem
  const texts = new Map();
  for (const c of graph.nodes.filter((n) => n.type === 'misc.comment')) {
    const f = c.fields ?? {};
    const lines = [f.title, ...String(f.text ?? '').split('\n')].filter((l) => l && l.trim()).map((l) => `${prefix} ${l.trim()}`);
    if (!lines.length) continue;
    const scope = c.scopeId ?? null;
    const w = c.w ?? COMMENT_SIZE.w;
    const h = c.h ?? COMMENT_SIZE.h;
    const inside = (x, y) => x >= c.x && y >= c.y && x <= c.x + w && y <= c.y + h;
    const members = f.group === false ? [] : [
      ...graph.nodes.filter((n) => n !== c && n.type !== 'misc.comment' && (n.scopeId ?? null) === scope && inside(n.x, n.y)).map((n) => n.id),
      ...(scope === null ? graph.scopes.filter((s) => inside(s.x, s.y)).map((s) => scopeEntry(graph, s.id)?.id).filter(Boolean) : []),
    ];
    if (!members.length) {
      top.push(...lines);
      continue;
    }
    texts.set(c.id, lines);
    for (const id of members) owners.set(id, [...(owners.get(id) ?? []), c.id]);
  }
  const done = new Set();
  return {
    top,
    take(nodeId, pad = '') {
      const out = [];
      for (const id of owners.get(nodeId) ?? []) {
        if (done.has(id)) continue;
        done.add(id);
        out.push(...texts.get(id).map((l) => pad + l));
      }
      return out;
    },
  };
}
