// Itens do diretório real = os que estão no retrato da pasta ligada (project.folder.snapshot).
// No app eles ficam travados: só mudam de posição dentro da mesma pasta e expandem/recolhem.
// "Ignorar" (item.ignored, vale também para o que está dentro) = continua no app, mas o
// conteúdo não sincroniza. Calculado uma vez por retrato/revisão do projeto (o canvas consulta
// a cada quadro).
const memo = new WeakMap();

function state(project) {
  const snapshot = project?.folder?.snapshot ?? null;
  let m = memo.get(project);
  if (m && m.snapshot === snapshot && m.revision === project.revision) return m;
  const paths = snapshot ? new Set([...(snapshot.folders ?? []), ...Object.keys(snapshot.files ?? {})]) : new Set();
  const real = new Set();
  const ignored = new Set();
  for (const item of project.items.values()) {
    if (snapshot && paths.has(project.path(item.id, ''))) real.add(item.id);
    if (item.ignored || project.ancestors(item.id).some((a) => a.ignored)) ignored.add(item.id);
  }
  m = { snapshot, revision: project.revision, real, ignored };
  memo.set(project, m);
  return m;
}

export function isReal(project, item) {
  return Boolean(project && item && state(project).real.has(item.id));
}

export function isIgnored(project, item) {
  return Boolean(project && item && state(project).ignored.has(item.id));
}
