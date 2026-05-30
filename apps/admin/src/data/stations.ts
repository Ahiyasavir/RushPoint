// Admin map stations — derived from the canonical race geography in
// @rushpoint/shared (no more duplicated/drifting coordinates). Adds display
// labels for marker tooltips; everything geographic comes from shared.
import {
  STATION_GEO,
  STATION_COLOR as SHARED_STATION_COLOR,
  RACE_CENTER,
  type StationType,
} from '@rushpoint/shared';

export interface Station {
  id: string;
  label: string;
  type: StationType;
  lat: number;
  lng: number;
}

const LABEL: Record<StationType, string> = {
  green:  'Field Mission',
  gate:   'Matchmaking Duel',
  orange: 'Find the Tene',
  gold:   'Gan HaKipod — Craft & Judge',
};

export const JERUSALEM = RACE_CENTER;

export const STATIONS: Station[] = STATION_GEO.map((s) => ({
  id: s.id,
  label: s.type === 'green' ? `${LABEL.green} ${s.slot + 1}` : LABEL[s.type],
  type: s.type,
  lat: s.lat,
  lng: s.lng,
}));

export const STATION_COLOR = SHARED_STATION_COLOR;
