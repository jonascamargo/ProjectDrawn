// Ícones da etiqueta do nó nesta linguagem: arquivo SVG (relativo ao index.html) e cor da etiqueta
// e da borda do nó. color: null = cor padrão do tema (ou a que nodeColor der). Outra linguagem pode
// trocar arquivos e cores.
export const icons = {
  function: { file: 'icons/function.svg', color: '#0A6CC2' },
  event: { file: 'icons/event.svg', color: '#C20A0A' },
  loop: { file: 'icons/loop.svg', color: '#C2850A' },
  condition: { file: 'icons/condition.svg', color: '#666666' },
  folder: { file: 'icons/folder.svg', color: null },
  file: { file: 'icons/file.svg', color: null },
  class: { file: 'icons/class.svg', color: '#196633' },
};

// Cor do arquivo pela extensão (etiqueta e borda da área File). Cores provisórias.
export const extensions = {
  gd: '#478CBF',
  gdshader: '#5FB7A4',
  tscn: '#B07FD6',
  tres: '#D9775A',
  json: '#C9A227',
};

// Cor própria do nó, quando não é a do ícone: pasta pela cor escolhida no inspetor; arquivo pela extensão.
export function nodeColor(node) {
  if (node.type === 'folder') return node.values.color || null;
  if (node.type === 'file') return extensions[String(node.values.name).split('.').pop().toLowerCase()] ?? null;
  return null;
}
