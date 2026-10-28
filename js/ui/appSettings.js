import { settings, updateSettings } from '../core/settings.js';
import { t } from '../i18n/i18n.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';

// Painel de configurações gerais do app (a Fase 6 amplia com tema, idioma etc.).
export async function openAppSettings() {
  const current = settings();
  const result = await openModal({
    title: t('settings.title'),
    width: '460px',
    fields: [
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
    ],
    validate: (v) => ({
      trashRetentionDays: v.trashRetentionDays < 0 ? t('settings.notNegative') : null,
      fileSyncMinutes: v.fileSyncMinutes < 0 ? t('settings.notNegative') : null,
    }),
  });
  if (!result) return;
  updateSettings({
    trashRetentionDays: Math.floor(result.values.trashRetentionDays),
    fileSyncMinutes: result.values.fileSyncMinutes,
  });
  toast.success(t('settings.saved'));
}
