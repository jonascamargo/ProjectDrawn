// Arquivo: área do projeto e ambiente de script. É do núcleo; a extensão do nome escolhe a
// linguagem (ver languages.js) e só os nós dela entram aqui (o que entra: language.fileContains).
// Solto num script, vira um nó de caminho. A cor vem da extensão.
export const file = {
  id: 'file',
  area: true,
  script: true,
  pathable: true,
  contains: null, // vem da linguagem do arquivo
  icon: { file: 'icons/file.svg', color: null },
  node: {
    id: 'file', title: 'File', category: 'Project', icon: 'file',
    // filename: nome e extensão separados no inspetor (as extensões que as linguagens cuidam, ou livre).
    fields: [{ id: 'name', label: 'Name', input: 'filename', default: 'script.gd', sets: 'title' }],
  },
};
