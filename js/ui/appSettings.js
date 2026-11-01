import { settings, updateSettings } from '../core/settings.js';
import { themeIndex } from '../theme/themeLoader.js';
import { t } from '../i18n/i18n.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';

// Painel de configurações gerais do app (a Fase 6 amplia com tema, idioma etc.).
export async function openAppSettings() {
  const current = settings();
  const themes = await themeIndex();
  const result = await openModal({
    title: t('settings.title'),
    width: '460px',
    fields: [
      {
        name: 'theme',
        label: t('settings.theme'),
        type: 'select',
        value: current.theme ?? 'system',
        options: [{ value: 'system', label: t('settings.themeSystem') }, ...themes.map((th) => ({ value: th.id, label: th.name }))],
      },
      { name: 'snapToGrid', label: t('settings.snapToGrid'), type: 'checkbox', value: current.snapToGrid !== false, hint: t('settings.snapToGridHint') },
      {
        name: 'canvasPattern',
        label: t('settings.canvasPattern'),
        type: 'select',
        value: current.canvasPattern ?? 'lines',
        options: ['lines', 'dots', 'none'].map((v) => ({ value: v, label: t(`settings.pattern.${v}`) })),
      },
      { name: 'customBackground', label: t('settings.customBackground'), type: 'checkbox', value: Boolean(current.canvasBackground) },
      { name: 'canvasBackground', label: t('settings.canvasBackground'), type: 'color', value: current.canvasBackground || '#121418' },
      {
        name: 'trashRetentionDays',
        label: t('settings.trashRetentionDays'),
        type: 'number',
        min: 0,
        step: 1,
        value: current.trashRetentionDays,
        hint: t('settings.trashRetentionHint'),
        required: true,
      },
      {
        name: 'fileSyncMinutes',
        label: t('settings.fileSyncMinutes'),
        type: 'number',
        min: 0,
        step: 1,
        value: current.fileSyncMinutes,
        hint: t('settings.fileSyncHint'),
        required: true,
      },
      {
        name: 'areaBlur',
        label: t('settings.areaBlur'),
        type: 'number',
        min: 0,
        max: 20,
        step: 1,
        value: current.areaBlur,
        hint: t('settings.areaBlurHint'),
        required: true,
      },
    ],
    validate: (v) => ({
      trashRetentionDays: v.trashRetentionDays < 0 ? t('settings.notNegative') : null,
      fileSyncMinutes: v.fileSyncMinutes < 0 ? t('settings.notNegative') : null,
      areaBlur: v.areaBlur < 0 ? t('settings.notNegative') : null,
    }),
  });
  if (!result) return;
  updateSettings({
    theme: result.values.theme,
    trashRetentionDays: Math.floor(result.values.trashRetentionDays),
    fileSyncMinutes: result.values.fileSyncMinutes,
    areaBlur: Math.min(20, Math.floor(result.values.areaBlur)),
    snapToGrid: Boolean(result.values.snapToGrid),
    canvasPattern: result.values.canvasPattern,
    canvasBackground: result.values.customBackground ? result.values.canvasBackground : '',
  });
  toast.success(t('settings.saved'));
}
