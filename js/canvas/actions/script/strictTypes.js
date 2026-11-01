import { bus } from '../../../core/events.js';

// Validação estrita de tipos, no menu da área (Shift + clique direito).
export default {
  id: 'script.strictTypes',
  area: ['script', 'scope'],
  menu: {
    group: 'view',
    order: 10,
    when: (c) => c.mods.shift && (c.hit.kind === 'garea' || c.part === 'body'),
    label: 'graph.menu.strictTypes',
    checked: (c) => c.graph.strict(),
    run(c) {
      c.project.settings.strictTypes = !c.graph.strict();
      bus.emit('project:changed', c.project);
    },
  },
};
