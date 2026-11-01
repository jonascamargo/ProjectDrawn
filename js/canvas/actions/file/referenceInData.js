import { profileOf } from '../../../lang/profileLoader.js';

// Arquivo solto dentro de um arquivo de dados (.tres…) cujo perfil tem um nó "dropFile":
// cria esse nó apontando para o arquivo (recurso externo).
const dropNode = (target) => profileOf(target)?.nodes?.find((n) => n.dropFile)?.id ?? null;

export default {
  id: 'file.referenceInData',
  area: 'file',
  itemDrop: {
    when: (c) => c.graph.isData(c.target.entry.item) && Boolean(dropNode(c.target.entry.item)),
    run: (c) => c.graph.addNode(c.target.id, dropNode(c.target.entry.item), c.world, { fields: { ref: c.item.id } }),
  },
};
