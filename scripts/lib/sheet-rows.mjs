// Maps Firestore docs back to sheet rows (array-of-arrays, first row = headers).
// Header orders MUST match the inbound CSV schemas so a round-trip stays stable
// (sheet → app → sheet leaves the config tabs identical).

const STAGE_LABEL = { 0: 'Green 1', 1: 'Green 2', 2: 'Green 3', 3: 'Gate', 4: 'Orange', 5: 'Gold' };

export function tasksRows(docs) {
  const header = ['id', 'type', 'title', 'titleHe', 'description', 'descriptionHe', 'lat', 'lng',
    'locationHint', 'difficulty', 'pointValue', 'estimatedMinutes', 'maxConcurrentTeams',
    'maxDurationMinutes', 'photoRequired', 'status'];
  const rows = docs.map((t) => [
    t.id ?? '', t.type ?? 'green', t.title ?? '', t.titleHe ?? '', t.description ?? '', t.descriptionHe ?? '',
    t.coordinates?.lat ?? '', t.coordinates?.lng ?? '', t.locationHint ?? '',
    t.difficulty ?? '', t.pointValue ?? '', t.estimatedMinutes ?? '', t.maxConcurrentTeams ?? '',
    t.maxDurationMinutes ?? '', t.photoRequired === true, t.status ?? 'active',
  ]);
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return [header, ...rows];
}

export function basketZonesRows(docs) {
  const header = ['id', 'name', 'nameHe', 'riddle', 'riddleHe', 'lat', 'lng', 'maxTeams'];
  const rows = docs.map((z) => [
    z.id ?? '', z.name ?? '', z.nameHe ?? '', z.riddle ?? '', z.riddleHe ?? '',
    z.coordinates?.lat ?? '', z.coordinates?.lng ?? '', z.maxTeams ?? 3,
  ]);
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return [header, ...rows];
}

export function raceConfigRows(cfg) {
  const header = ['startLat', 'startLng', 'finishLat', 'finishLng', 'gateLat', 'gateLng',
    'centerLat', 'centerLng', 'zoom'];
  const c = cfg ?? {};
  const row = [
    c.start?.lat ?? '', c.start?.lng ?? '', c.finish?.lat ?? '', c.finish?.lng ?? '',
    c.gate?.lat ?? '', c.gate?.lng ?? '', c.center?.lat ?? '', c.center?.lng ?? '', c.zoom ?? 13.5,
  ];
  return [header, row];
}

/** Live standings — a read-only reflection tab the app keeps updated. */
export function statusRows(teams) {
  const header = ['rank', 'team', 'code', 'score', 'stage', 'status', 'completedSlots', 'finishedAt'];
  const ranked = [...teams].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const rows = ranked.map((t, i) => [
    i + 1, t.name ?? t.teamId ?? '', t.code ?? '', t.score ?? 0,
    t.finished ? 'Finished' : (STAGE_LABEL[t.stageIndex] ?? '—'),
    t.status ?? '', t.completedSlots ?? 0, t.finishedAt ?? '',
  ]);
  return [header, ...rows];
}
