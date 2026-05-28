// Mock station coordinates around Jerusalem for the Phase 2 live map.
// Real per-event station GPS will replace these once stations are geo-tagged.
export interface Station {
  id: string;
  label: string;
  labelHe: string;
  type: 'green' | 'orange' | 'gold';
  lat: number;
  lng: number;
}

export const JERUSALEM = { lat: 31.7767, lng: 35.2345 };

export const STATIONS: Station[] = [
  { id: 'green-001', label: 'Landmarks Photo Hunt', labelHe: 'ציד נקודות ציון', type: 'green',  lat: 31.7780, lng: 35.2290 },
  { id: 'green-002', label: 'Blindfolded Trust Relay', labelHe: 'ריצת שליחות', type: 'green',  lat: 31.7740, lng: 35.2410 },
  { id: 'green-003', label: 'Bible Trivia Blitz', labelHe: 'חידון תנ"ך', type: 'green',  lat: 31.7812, lng: 35.2360 },
  { id: 'green-004', label: 'The Human Knot', labelHe: 'הקשר האנושי', type: 'green',  lat: 31.7705, lng: 35.2300 },
  { id: 'orange-001', label: 'Bible Park — Find the Tene', labelHe: 'פארק התנ"ך — מצאו את הטנא', type: 'orange', lat: 31.7690, lng: 35.2450 },
  { id: 'gold-001', label: 'Ancient Grape Press', labelHe: 'גת ענבים עתיקה', type: 'gold',   lat: 31.7665, lng: 35.2470 },
  { id: 'gold-002', label: 'Olive Oil Craft', labelHe: 'מלאכת שמן זית', type: 'gold',   lat: 31.7680, lng: 35.2490 },
  { id: 'gold-003', label: 'Basket Weaving', labelHe: 'קליעת סלים', type: 'gold',   lat: 31.7655, lng: 35.2455 },
];

export const STATION_COLOR: Record<Station['type'], string> = {
  green: '#10b981',
  orange: '#f97316',
  gold: '#f59e0b',
};
