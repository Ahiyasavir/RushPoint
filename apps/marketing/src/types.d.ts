import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
import type { HTMLAttributes, ImageMetadata } from 'astro/types';

export interface Post {
  /** Unique ID identifying the post. */
  id: string;
  /** URL-friendly slug derived from the post name. */
  slug: string;
  /** Fully resolved permalink, computed from the configured pattern. */
  permalink: string;

  publishDate: Date;
  updateDate?: Date;

  title: string;
  /** Optional summary of post content. */
  excerpt?: string;
  image?: ImageMetadata | string;

  category?: Taxonomy;
  tags?: Taxonomy[];
  author?: string;

  metadata?: MetaData;

  draft?: boolean;

  /** Rendered Astro component factory for the post body. */
  Content?: AstroComponentFactory;

  /** Estimated reading time in minutes. */
  readingTime?: number;
}

export interface Taxonomy {
  slug: string;
  title: string;
}

export interface MetaData {
  title?: string;
  ignoreTitleTemplate?: boolean;

  canonical?: string;

  robots?: MetaDataRobots;

  description?: string;

  openGraph?: MetaDataOpenGraph;
  twitter?: MetaDataTwitter;
}

export interface MetaDataRobots {
  index?: boolean;
  follow?: boolean;
}

export interface MetaDataImage {
  url: string;
  width?: number;
  height?: number;
}

export interface MetaDataOpenGraph {
  url?: string;
  siteName?: string;
  images?: Array<MetaDataImage>;
  locale?: string;
  type?: string;
}

export interface MetaDataTwitter {
  handle?: string;
  site?: string;
  cardType?: string;
}

export interface Image {
  src: string;
  alt?: string;
}

export interface Widget {
  id?: string;
  isDark?: boolean;
  bg?: string;
  classes?: Record<string, string | Record<string, string>>;
}

export interface Headline {
  title?: string;
  subtitle?: string;
  tagline?: string;
  classes?: Record<string, string>;
}

interface TeamMember {
  name?: string;
  job?: string;
  image?: Image;
  socials?: Array<Social>;
  description?: string;
  classes?: Record<string, string>;
}

interface Social {
  icon?: string;
  href?: string;
}

export interface Stat {
  amount?: number | string;
  title?: string;
  icon?: string;
}

export interface Item {
  title?: string;
  description?: string;
  icon?: string;
  classes?: Record<string, string>;
  callToAction?: CallToAction;
  image?: Image;
}

export interface Price {
  title?: string;
  subtitle?: string;
  description?: string;
  price?: number | string;
  period?: string;
  items?: Array<Item>;
  callToAction?: CallToAction;
  hasRibbon?: boolean;
  ribbonTitle?: string;
}

export interface Testimonial {
  title?: string;
  testimonial?: string;
  name?: string;
  job?: string;
  image?: string | unknown;
}

export interface Input {
  type: HTMLInputTypeAttribute;
  name: string;
  label?: string;
  autocomplete?: string;
  placeholder?: string;
}

export interface Textarea {
  label?: string;
  name?: string;
  placeholder?: string;
  rows?: number;
}

export interface Disclaimer {
  label?: string;
}

// COMPONENTS
export interface CallToAction extends Omit<HTMLAttributes<'a'>, 'slot'> {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'link';
  text?: string;
  icon?: string;
  classes?: Record<string, string>;
  type?: 'button' | 'submit' | 'reset';
}

export interface Collapse {
  iconUp?: string;
  iconDown?: string;
  items?: Array<Item>;
  columns?: number;
  classes?: Record<string, string>;
}

export interface Form {
  inputs?: Array<Input>;
  textarea?: Textarea;
  disclaimer?: Disclaimer;
  button?: string;
  description?: string;
}

// WIDGETS
export interface Hero extends Omit<Headline, 'classes'>, Omit<Widget, 'isDark' | 'classes'> {
  content?: string;
  actions?: string | CallToAction[];
  image?: string | unknown;
}

export interface Team extends Omit<Headline, 'classes'>, Widget {
  team?: Array<TeamMember>;
}

export interface Stats extends Omit<Headline, 'classes'>, Widget {
  stats?: Array<Stat>;
}

export interface Pricing extends Omit<Headline, 'classes'>, Widget {
  prices?: Array<Price>;
}

export interface Testimonials extends Omit<Headline, 'classes'>, Widget {
  testimonials?: Array<Testimonial>;
  callToAction?: CallToAction;
}

export interface Brands extends Omit<Headline, 'classes'>, Widget {
  icons?: Array<string>;
  images?: Array<Image>;
}

export interface Features extends Omit<Headline, 'classes'>, Widget {
  image?: string | unknown;
  items?: Array<Item>;
  columns?: number;
  defaultIcon?: string;
  isBeforeContent?: boolean;
  isAfterContent?: boolean;
}

export interface Faqs extends Omit<Headline, 'classes'>, Widget {
  items?: Array<Item>;
  columns?: number;
}

export interface Steps extends Omit<Headline, 'classes'>, Widget {
  items?: Array<Item>;
  callToAction?: string | CallToAction;
  image?: string | Image;
  isReversed?: boolean;
}

export interface Content extends Omit<Headline, 'classes'>, Widget {
  content?: string;
  image?: string | unknown;
  items?: Array<Item>;
  columns?: number;
  isReversed?: boolean;
  isAfterContent?: boolean;
  callToAction?: CallToAction;
}

export interface Contact extends Omit<Headline, 'classes'>, Form, Widget {}

/**
 * The playable demo mission (change: try-a-mission). The widget takes its entire visible
 * surface as `content`, so the component holds no copy of its own and cannot leak the wrong
 * language onto a page. The shape is validated at build time by the `homePages` schema in
 * src/content.config.ts; this interface is the same contract for the component's props.
 */
export interface TryMissionContent {
  tagline?: string;
  title: string;
  subtitle: string;
  startBody: string;
  startAction: string;
  checkAction: string;
  resetAction: string;
  replayAction: string;
  wrongFeedback: string;
  /** Carries `{n}` and `{total}` placeholders. */
  progressLabel: string;
  /** Carries a `{score}` placeholder. */
  scoreLabel: string;
  youLabel: string;
  doneTitle: string;
  doneBody: string;
  doneAction: string;
  doneScoreLabel: string;
  doneTimeLabel: string;
  doneRankLabel: string;
  boardNote: string;
  rivals: { name: string; score: number }[];
  missions: {
    order: { kindLabel: string; title: string; prompt: string; items: string[] };
    answer: { kindLabel: string; title: string; prompt: string; hint?: string; answers: string[] };
    /** The closing question — not graded, no `correct` flag (change: try-mission-occasion). */
    occasion: {
      kindLabel: string;
      title: string;
      prompt: string;
      options: { label: string; emoji?: string }[];
    };
  };
}

export interface TryMission {
  content: TryMissionContent;
  id?: string;
}

/**
 * The mission idea generator (change: mission-ideas). Like TryMission, the widget takes its
 * whole visible surface as `content` so it holds no copy of its own. `occasions` and `places`
 * are the tag vocabulary; each idea declares which of them it belongs to, and the generator
 * widens its filter rather than ever returning an empty result.
 */
export interface MissionIdeasContent {
  tagline?: string;
  title: string;
  subtitle: string;
  occasionLabel: string;
  placeLabel: string;
  generateAction: string;
  againAction: string;
  ctaAction: string;
  note: string;
  occasions: { id: string; label: string }[];
  places: { id: string; label: string }[];
  ideas: { kindLabel?: string; text: string; occasions: string[]; places: string[] }[];
}

export interface MissionIdeas {
  content: MissionIdeasContent;
  id?: string;
}

/**
 * The station planner (change: game-planner). The numeric defaults are content so the tool can
 * be pointed at the kind of event a given site actually runs.
 */
export interface GamePlannerContent {
  tagline?: string;
  title: string;
  subtitle: string;
  fieldLabels: {
    teams: string;
    minutes: string;
    missions: string;
    perMission: string;
    capacity: string;
  };
  defaultTeams: number;
  defaultMinutes: number;
  defaultMissions: number;
  defaultPerMission: number;
  defaultCapacity: number;
  outputTitle: string;
  stationsLabel: string;
  durationLabel: string;
  throughputLabel: string;
  verdictOk: string;
  verdictTight: string;
  note: string;
}

export interface GamePlanner {
  content: GamePlannerContent;
  id?: string;
}
