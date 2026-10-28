import { findPin, pinType, readGraph, resolveFile, resolveTypes } from './graph.js';
import { generateScript } from './scriptCode.js';
import { getDef, typesCompatible } from '../lang/nodeRegistry.js';

// Problemas de um arquivo com nós, para a validação visual:
//   scripts — avisos de montagem do .gd (fora do fluxo, referência quebrada, pino vazio…);
//   todos   — nó desconhecido, fio de tipos incompatíveis (validação estrita) e arquivo
//             referenciado que não existe mais (script/instância de cena, const (arquivo)).
// Retorna [{ nodeId, message (chave i18n), params }].
export function validateItem(item, { script, strict }) {
  const graph = readGraph(item);
  if (!graph.nodes.length) return [];
  const issues = script ? generateScript(item).warnings.filter((w) => w.nodeId) : [];
  const seen = new Set(issues.map((w) => `${w.nodeId}|${w.message}`));
  const push = (nodeId, message, params = {}) => {
    const key = `${nodeId}|${message}|${JSON.stringify(params)}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ nodeId, message, params });
  };

  for (const node of graph.nodes) {
    const def = getDef(node.type);
    if (!def) {
      if (!script) push(node.id, 'export.warn.unknownNode', { type: node.type });
      continue;
    }
    for (const key of ['script', 'instance']) {
      if (def.sceneNode && node.fields?.[key] && !resolveFile(node.fields[key])) push(node.id, 'validation.missingFile', { title: def.title });
    }
    if (def.filePath && node.fields?.ref && !resolveFile(node.fields.ref)) push(node.id, 'validation.missingFile', { title: def.title });
  }

  if (strict) {
    const types = resolveTypes(graph);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const wire of graph.wires) {
      if (wire.kind !== 'data') continue;
      const a = byId.get(wire.from.node);
      const b = byId.get(wire.to.node);
      const out = a && findPin(a, wire.from.pin, 'out', graph);
      const inp = b && findPin(b, wire.to.pin, 'in', graph);
      if (!out || !inp) continue;
      const from = pinType(a, out, types);
      const to = pinType(b, inp, types);
      if (!typesCompatible(from, to)) push(b.id, 'validation.invalidWire', { from, to, pin: inp.label || inp.id });
    }
  }
  return issues;
}
