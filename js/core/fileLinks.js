import { readGraph, scopeEntry } from './graph.js';
import { getDef } from '../lang/nodeRegistry.js';

// Ligações entre arquivos calculadas a partir dos nós de referência (nunca desenhadas à mão):
//   preload/load  — const (arquivo) apontando para um arquivo
//   script        — script associado a um nó de cena
//   instance      — nó de cena que instancia outra cena
//   signal        — Referência de script (sinais ligados a um método do script)
//   uses          — membro de outro script (ler/definir/chamar/emitir)
// Link: { key, kind, from: { fileId, nodeId }, to: { fileId, scopeId? }, name, detail }

// Nome do método de uma sub-área: nome da função própria ou do evento (_ready, _process…).
export function scopeMethodName(graph, scopeId) {
  const entry = scopeEntry(graph, scopeId);
  if (!entry) return null;
  return entry.type === 'func.entry' ? entry.fields?.name || null : getDef(entry.type)?.title ?? null;
}

function memberName(graph, ref) {
  if (!graph || !ref) return '';
  return graph.nodes.find((n) => n.id === ref)?.fields?.name ?? scopeMethodName(graph, ref) ?? '';
}

function scopeForMethod(graph, method) {
  if (!method) return null;
  return graph.scopes.find((sc) => scopeMethodName(graph, sc.id) === method)?.id ?? null;
}

export function collectLinks(project) {
  const links = [];
  const push = (kind, fileId, node, toFileId, extra = {}) => {
    if (!toFileId || !project.get(toFileId)) return;
    links.push({ key: `${kind}|${fileId}|${node.id}|${toFileId}`, kind, from: { fileId, nodeId: node.id }, to: { fileId: toFileId, ...(extra.scopeId ? { scopeId: extra.scopeId } : {}) }, name: extra.name ?? '', detail: extra.detail ?? '' });
  };
  for (const item of project.items.values()) {
    if (!item.graph) continue;
    const graph = readGraph(item);
    for (const node of graph.nodes) {
      const f = node.fields ?? {};
      if (node.type === 'var.path') push(f.mode === 'path' ? 'load' : 'preload', item.id, node, f.ref, { name: f.name });
      else if (node.type === 'scene.node') {
        push('script', item.id, node, f.script, { name: f.name });
        push('instance', item.id, node, f.instance, { name: f.name });
      } else if (getDef(node.type)?.external) {
        const target = project.get(f.file);
        const targetGraph = target?.graph ? readGraph(target) : null;
        const scopeId = targetGraph?.scopes.some((sc) => sc.id === f.ref) ? f.ref : null;
        push('uses', item.id, node, f.file, { name: memberName(targetGraph, f.ref), scopeId });
      } else if (node.type === 'scene.scriptRef') {
        const target = project.get(f.script);
        // Sinais que chegam na referência: "Nó.sinal".
        const signals = graph.wires
          .filter((w) => w.kind === 'signal' && w.to.node === node.id)
          .map((w) => {
            const source = graph.nodes.find((n) => n.id === w.from.node);
            return `${source?.fields?.name ?? '?'}.${w.from.pin.replace(/^sig:/, '')}`;
          });
        push('signal', item.id, node, f.script, {
          name: signals.join(', '),
          detail: f.method ? `${f.method}()` : '',
          scopeId: target ? scopeForMethod(readGraph(target), f.method) : null,
        });
      }
    }
  }
  return links;
}

// Ligações de um arquivo: o que ele usa e quem usa ele.
export function fileLinks(project, itemId) {
  const all = collectLinks(project);
  return { uses: all.filter((l) => l.from.fileId === itemId), usedBy: all.filter((l) => l.to.fileId === itemId) };
}
