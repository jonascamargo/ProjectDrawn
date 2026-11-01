import { openCodeImport } from '../../../ui/codeImport.js';
import { adapterFor } from '../../../lang/adapters.js';
import { extensionOf } from '../../../lang/profileLoader.js';
import { t } from '../../../i18n/i18n.js';

export default {
  id: 'file.importCode',
  area: 'file',
  menu: {
    group: 'main',
    order: 50,
    when: (c) => c.editor.selection.size === 1 && c.graph.supportsGraph(c.item),
    // Linguagem sem adaptador de código: a opção aparece desabilitada.
    disabled: (c) => !adapterFor(c.item),
    label: (c) => t('import.menu', { ext: extensionOf(c.item.name) }),
    run: (c) => openCodeImport(c.editor, c.item.id),
  },
};
