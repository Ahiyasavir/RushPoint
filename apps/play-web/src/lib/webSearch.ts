// Where "Search the web" in the play menu goes (change: return-to-game). At המירוץ לציון players
// left the game's tab to search Google and could not find their way back; the menu now opens a
// search in a NEW tab, so the game stays where it was. Google's home in the interface language,
// with no query: the player types what they are looking for. Pure, so the address is tested
// (scripts/test-return-to-game.ts) and a change of provider is one line.
export function webSearchHref(lang: 'he' | 'en'): string {
  return `https://www.google.com/?hl=${lang === 'en' ? 'en' : 'he'}`;
}
