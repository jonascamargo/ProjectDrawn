// Pasta: área do projeto que guarda pastas e arquivos. É do núcleo (a mesma em toda linguagem).
// Solta num script, vira um nó de caminho. A cor é escolhida no inspetor.
export const folder = {
  id: 'folder',
  area: true,
  pathable: true,
  contains: ['folder', 'file'],
  icon: { file: 'icons/folder.svg', color: null },
  node: {
    id: 'folder', title: 'Folder', category: 'Project', icon: 'folder',
    fields: [
      { id: 'name', label: 'Name', input: 'text', default: 'folder', sets: 'title' },
      { id: 'color', label: 'Color', input: 'color', default: null },
    ],
  },
};
