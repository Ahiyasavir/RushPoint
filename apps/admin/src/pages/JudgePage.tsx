import React, { useState } from 'react';

export default function JudgePage() {
  const [search, setSearch] = useState('');
  const [score, setScore] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // TODO Phase 1: write to Firestore checkIns/{id} with judgeScore + judgeNote
    setSubmitted(true);
  }

  return (
    <div className="p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-2">Judge Scoring</h1>
      <p className="text-zinc-500 text-sm mb-8">Score a team's physical basket quality</p>

      {submitted ? (
        <div className="rounded-xl bg-green-900/30 border border-green-800 p-6 text-center">
          <p className="text-green-400 font-semibold text-lg">Score submitted!</p>
          <button
            onClick={() => { setSubmitted(false); setSearch(''); setScore(''); setNote(''); }}
            className="mt-4 text-sm text-zinc-400 hover:text-white"
          >
            Score another team
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Team name or code</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. Team Alpha or ALPH1"
              required
              className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">
              Basket score <span className="text-zinc-600">(0–100)</span>
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              placeholder="85"
              required
              className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Notes (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Excellent grape juice presentation, missing spice bag..."
              rows={3}
              className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold transition-colors"
          >
            Submit Score
          </button>
        </form>
      )}
    </div>
  );
}
