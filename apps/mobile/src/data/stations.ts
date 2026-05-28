// Mock station coordinates around Jerusalem for the Phase 2 mission map.
export interface Station {
  id: string;
  type: 'green' | 'orange' | 'gold';
  lat: number;
  lng: number;
}

export const JERUSALEM = { lat: 31.7767, lng: 35.2345 };

export const STATIONS: Station[] = [
  { id: 'green-001', type: 'green', lat: 31.778, lng: 35.229 },
  { id: 'green-002', type: 'green', lat: 31.774, lng: 35.241 },
  { id: 'green-003', type: 'green', lat: 31.7812, lng: 35.236 },
  { id: 'green-004', type: 'green', lat: 31.7705, lng: 35.23 },
  { id: 'orange-001', type: 'orange', lat: 31.769, lng: 35.245 },
  { id: 'gold-001', type: 'gold', lat: 31.7665, lng: 35.247 },
  { id: 'gold-002', type: 'gold', lat: 31.768, lng: 35.249 },
  { id: 'gold-003', type: 'gold', lat: 31.7655, lng: 35.2455 },
];

// Mapbox marker pin colours (hex without '#', per Static Images API).
const PIN_COLOR: Record<Station['type'], string> = {
  green: '10b981',
  orange: 'f97316',
  gold: 'f59e0b',
};

/**
 * Builds a Mapbox Static Images API URL with a pin per station.
 * Works in <Image> on both web and native — no GL dependency required.
 */
export function buildStaticMapUrl(token: string, width = 640, height = 420): string {
  const overlays = STATIONS.map(
    (s) => `pin-s+${PIN_COLOR[s.type]}(${s.lng},${s.lat})`,
  ).join(',');
  const center = `${JERUSALEM.lng},${JERUSALEM.lat},12.5,0`;
  return (
    `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/` +
    `${overlays}/${center}/${width}x${height}@2x?access_token=${token}`
  );
}
