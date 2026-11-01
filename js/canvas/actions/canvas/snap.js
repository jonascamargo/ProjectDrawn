import { bus } from '../../../core/events.js';
import { t } from '../../../i18n/i18n.js';

export default {
  id: 'canvas.snap',
  area: 'canvas',
  menu: {
    group: 'view',
    order: 40,
    label: 'canvas.snap',
    checked: (c) => c.project.settings.snap,
    run(c) {
      const settings = c.project.settings;
      settings.snap = !settings.snap;
      bus.emit('status', t(settings.snap ? 'canvas.snapOn' : 'canvas.snapOff'));
      bus.emit('project:changed', c.project);
    },
  },
};
