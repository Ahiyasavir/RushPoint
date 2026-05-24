import React from 'react';

// Phase 2: real-time Firestore subscription + photo review queue
export default function CheckInsPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-2">Check-in Review</h1>
      <p className="text-zinc-500 text-sm mb-6">Approve or reject team mission submissions</p>
      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-12 text-center text-zinc-600">
        No pending check-ins
      </div>
    </div>
  );
}
