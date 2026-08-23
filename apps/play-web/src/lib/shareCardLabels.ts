// Pure, dependency-free label assembler for the participant share cards
// (change: localized-share-cards). It maps the play-web `final` dictionary for
// the CURRENT language plus the scoring preset onto the localized label set the
// canvas cards consume — so a Hebrew player shares a Hebrew image and an English
// player's image is byte-identical to before.
//
// It MUST NOT import the canvas modules (`storyCard` / `podiumCard`): those are
// heavy and stay behind a dynamic `import()` so they never re-enter the play-web
// entry chunk. Keeping this helper tiny + dependency-free lets `FinalScreen`
// import it eagerly without breaking `npm run bundle:budget`.

// Structural slice of the play-web `final` dictionary this helper reads. Declared
// here (not imported from i18n) so the module has zero dependencies.
export interface ShareCardDict {
  cardHeadline: string;
  cardPoints: string;
  cardTime: string;
  cardRank: string;
  cardStages: string;
  cardCta: string;
  cardPodium: string;
}

export interface ShareCardLabels {
  headline: string;
  scoreLabel: string;
  rankLabel: string;
  timeLabel: string;
  stagesLabel: string;
  ctaText: string;
  podiumTitle: string;
}

// The single source of the preset -> hero-label decision (finding #4): a
// `time_only` game's hero is the finish TIME (labeled with the localized TIME
// token), NOT the completion-bonus integer labeled POINTS. Points-based presets
// keep the points hero + label.
export function shareCardLabels(d: ShareCardDict, isTimeOnly: boolean): ShareCardLabels {
  return {
    headline: d.cardHeadline,
    scoreLabel: isTimeOnly ? d.cardTime : d.cardPoints,
    rankLabel: d.cardRank,
    timeLabel: d.cardTime,
    stagesLabel: d.cardStages,
    ctaText: d.cardCta,
    podiumTitle: `🏆 ${d.cardPodium}`,
  };
}
