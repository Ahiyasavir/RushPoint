import React from 'react';
import { useI18n } from '../i18n';

// Placeholder — full volunteer console is built in task #11.
export default function VolunteerPage() {
  const { t } = useI18n();
  return (
    <div className="max-w-3xl mx-auto p-6 md:p-8">
      <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('nav.volunteer')}</h1>
      <p className="text-zinc-500 text-sm">{t('common.comingSoon')}</p>
    </div>
  );
}
