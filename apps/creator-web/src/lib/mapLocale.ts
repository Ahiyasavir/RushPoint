// MapLibre's own words, in the app's language (change: map-locale).
//
// MapLibre draws some text itself: the two-finger hint on a phone, the zoom
// buttons' labels, the attribution toggle, the map's accessible name. It ships
// them in English and they never pass through `t.*`, so a Hebrew screen said
// "Use two fingers to move the map". Every `new maplibregl.Map(` passes
// `locale: mapLocale(...)` (scripts/test-map-locale.ts enforces it).
//
// Deliberately duplicated in both apps, like `mapRtl.ts`: packages/shared holds
// no map engine and no dictionary.

export interface MapUiCopy {
  mapTitle: string;
  zoomIn: string;
  zoomOut: string;
  resetBearing: string;
  toggleAttribution: string;
  mapFeedback: string;
  twoFingers: string;
  ctrlScroll: string;
  cmdScroll: string;
  closePopup: string;
  findMyLocation: string;
  locationNotAvailable: string;
}

/** Every MapLibre locale key this helper fills. */
export const MAP_LOCALE_KEYS = [
  'Map.Title',
  'NavigationControl.ZoomIn',
  'NavigationControl.ZoomOut',
  'NavigationControl.ResetBearing',
  'AttributionControl.ToggleAttribution',
  'AttributionControl.MapFeedback',
  'CooperativeGesturesHandler.MobileHelpText',
  'CooperativeGesturesHandler.WindowsHelpText',
  'CooperativeGesturesHandler.MacHelpText',
  'Popup.Close',
  'GeolocateControl.FindMyLocation',
  'GeolocateControl.LocationNotAvailable',
] as const;

export function mapLocale(m: MapUiCopy): Record<string, string> {
  return {
    'Map.Title': m.mapTitle,
    'NavigationControl.ZoomIn': m.zoomIn,
    'NavigationControl.ZoomOut': m.zoomOut,
    'NavigationControl.ResetBearing': m.resetBearing,
    'AttributionControl.ToggleAttribution': m.toggleAttribution,
    'AttributionControl.MapFeedback': m.mapFeedback,
    'CooperativeGesturesHandler.MobileHelpText': m.twoFingers,
    'CooperativeGesturesHandler.WindowsHelpText': m.ctrlScroll,
    'CooperativeGesturesHandler.MacHelpText': m.cmdScroll,
    'Popup.Close': m.closePopup,
    'GeolocateControl.FindMyLocation': m.findMyLocation,
    'GeolocateControl.LocationNotAvailable': m.locationNotAvailable,
  };
}
