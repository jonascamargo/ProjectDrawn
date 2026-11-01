import { profileOf } from '../../../lang/profileLoader.js';

// Arquivo solto dentro de um script expandido vira um const ligado a ele.
export default {
  id: 'file.referenceInScript',
  area: 'file',
  itemDrop: {
    when: (c) => c.graph.isScript(c.target.entry.item) && Boolean(profileOf(c.target.entry.item)?.nodes?.some((n) => n.id === 'var.path')),
    run: (c) => c.graph.addFileReference(c.target.id, c.item.id, c.world),
  },
};
