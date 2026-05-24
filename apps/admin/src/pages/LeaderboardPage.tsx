import React, { useState } from 'react';

export default function LeaderboardPage() {
  const [frozen, setFrozen] = useState(false);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Leaderboard</h1>
          <p className="text-zinc-500 text-sm">
            {frozen ? (
              <span className="text-yellow-400 font-medium">Frozen — rankings hidden until ceremony</span>
            ) : (
              'Live rankings'
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
          {frozen ? 'Unfreeze' : 'Freeze Board'}
        </button>
      </div>

      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-12 text-center text-zinc-600">
        {frozen ? 'Leaderboard is frozen' : 'No finishers yet'}
      </div>
    </div>
  );
}
