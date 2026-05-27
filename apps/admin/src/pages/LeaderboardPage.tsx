import React, { useState } from 'react';
import { useI18n } from '../i18n';

export default function LeaderboardPage() {
  const { t } = useI18n();
  const [frozen, setFrozen] = useState(false);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">{t('leaderboard.title')}</h1>
          <p className="text-zinc-500 text-sm">
            {frozen ? (
              <span className="text-yellow-400 font-medium">{t('leaderboard.frozenNote')}</span>
            ) : (
              t('leaderboard.live')
            )}
          </p>
        </div>
        <button
          onClick={() => setFrozen((f) => !f)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            frozen
              ? 'bg-yellow-900 text-yellow-300 hover:bg-yellow-800'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
          }`}
        >
          {frozen ? t('leaderboard.unfreeze') : t('leaderboard.freeze')}
        </button>
      </div>

      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-12 text-center text-zinc-600">
        {frozen ? t('leaderboard.frozenBody') : t('leaderboard.noFinishers')}
      </div>
    </div>
  );
}
