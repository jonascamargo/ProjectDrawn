import { bus } from './events.js';
import { emptyGraph } from './graph.js';

// Comandos de grafo por "fotografia" (antes/depois do grafo inteiro do arquivo).
// Simples e confiável para desfazer/refazer qualquer edição de nós e fios.

function changed(project) {
  project.invalidate();
  bus.emit('project:changed', project);
}

export function graphSnapshot(project, itemId, before, after, label) {
  return {
    label,
    do() {
      project.get(itemId).graph = structuredClone(after);
      changed(project);
    },
    undo() {
      project.get(itemId).graph = structuredClone(before);
      changed(project);
    },
  };
}

// Aplica `mutate(graph)` numa cópia e registra no histórico. mutate pode retornar false para cancelar.
export function editGraph(history, project, itemId, label, mutate) {
  const item = project.get(itemId);
  if (!item) return null;
  const before = structuredClone(item.graph ?? emptyGraph());
  const working = structuredClone(before);
  const result = mutate(working);
  if (result === false) return null;
  history.execute(graphSnapshot(project, itemId, before, working, label));
  return result ?? true;
}
