import React from 'react';
import { useI18n } from '../i18n';
import { useRole } from '../roles';

// Placeholder — full station-operator console is built in task #7 (#10).
export default function StationPage() {
  const { t } = useI18n();
  const { stationId } = useRole();
  return (
    <div className="max-w-3xl mx-auto p-6 md:p-8">
      <h1 className="font-brand text-2xl font-bold text-white mb-1">
        {t('station.title', { n: stationId ?? '—' })}
      </h1>
      <p className="text-zinc-500 text-sm">{t('common.comingSoon')}</p>
    </div>
  );
}
