import React from 'react';

// Phase 2: integrate react-map-gl + Mapbox satellite layer
// showing live team GPS pins, station crowd indicators, and SOS alerts
export default function HeatmapPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-2">Live Team Map</h1>
      <p className="text-zinc-500 text-sm mb-6">Real-time GPS positions of all active teams</p>
      <div className="rounded-xl bg-zinc-900 border border-zinc-800 h-[600px] flex items-center justify-center">
        <p className="text-zinc-600">Mapbox integration — Phase 2</p>
      </div>
    </div>
  );
}
