import type maplibregl from 'maplibre-gl';

/**
 * Keep the map's credits folded into their (i) button. MapLibre's compact attribution opens itself
 * whenever a style loads and folds only after the first drag, so on a setup screen the long credits
 * line ("Imagery © Esri, Maxar, Earthstar Geographics…") sat open across the map, cut at its edge and
 * under the search box (29.10, at 1000x457). Folded, the credits stay one tap away, which is what the
 * providers' terms ask for.
 */
export function keepAttributionFolded(map: maplibregl.Map): void {
  const fold = () => {
    try {
      map.getContainer()
        .querySelectorAll('.maplibregl-ctrl-attrib.maplibregl-compact-show')
        .forEach((el) => el.classList.remove('maplibregl-compact-show'));
    } catch { /* a map torn down between events has nothing to fold */ }
  };
  map.on('load', fold);
  // A style swap (map ⇄ satellite) rebuilds the credits and opens them again.
  map.on('styledata', () => setTimeout(fold, 0));
}
