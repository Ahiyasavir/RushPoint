import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const metadataDefinition = () =>
  z
    .object({
      title: z.string().optional(),
      ignoreTitleTemplate: z.boolean().optional(),

      canonical: z.url().optional(),

      robots: z
        .object({
          index: z.boolean().optional(),
          follow: z.boolean().optional(),
        })
        .optional(),

      description: z.string().optional(),

      openGraph: z
        .object({
          url: z.string().optional(),
          siteName: z.string().optional(),
          images: z
            .array(
              z.object({
                url: z.string(),
                width: z.number().optional(),
                height: z.number().optional(),
              })
            )
            .optional(),
          locale: z.string().optional(),
          type: z.string().optional(),
        })
        .optional(),

      twitter: z
        .object({
          handle: z.string().optional(),
          site: z.string().optional(),
          cardType: z.string().optional(),
        })
        .optional(),
    })
    .optional();

/**
 * A picture or a video, wherever one may appear.
 *
 * `src` is a site relative path under /uploads, which is where the CMS puts what
 * it is given. A video is NOT loaded as an image: `kind` says which it is rather
 * than the extension being sniffed, because a mis-sniffed video renders as a
 * broken image with no explanation.
 */
const mediaItem = () =>
  z.object({
    kind: z.enum(['image', 'video']),
    src: z.string(),
    /**
     * Required for an image, because an image with no alt text is invisible to
     * anyone using a screen reader and to a search engine. For a video it is the
     * accessible label.
     */
    alt: z.string(),
    caption: z.string().optional(),
    /** Shown while a video loads, and as its thumbnail before play. */
    poster: z.string().optional(),
  });

/** Media that may be absent. A page without a picture is a page, not an error. */
const optionalMedia = () => mediaItem().optional();

const postCollection = defineCollection({
  loader: glob({ pattern: ['*.md', '*.mdx'], base: 'src/data/post' }),
  schema: z.object({
    // REQUIRED, deliberately. An optional publishDate would let a post with no
    // date sort anywhere at all, and the index promises newest first.
    publishDate: z.date(),
    updateDate: z.date().optional(),
    draft: z.boolean().default(false),

    // REQUIRED. A post belongs to exactly one language: it appears in that
    // language's index and feed, and nowhere else. There is no default, because
    // a defaulted language is a Hebrew post quietly filed as English.
    language: z.enum(['he', 'en']),

    // REQUIRED and DECLARED, never derived from the title or the filename.
    // A URL derived from a title breaks the moment someone edits the title, and
    // it breaks silently: the old address 404s and the new one has no history.
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase words joined by single hyphens'),

    // Set on BOTH posts of a translated pair, to the same value, to make them
    // annotate each other. Absent means this post has no counterpart, which is
    // the honest state for most posts and is not an error.
    pairedSubject: z.string().optional(),

    title: z.string(),
    excerpt: z.string().optional(),
    image: z.string().optional(),
    /**
     * A self-hosted picture or video for the post body, same as the standing
     * pages: a file the CMS uploaded and we serve, never a third-party embed.
     */
    media: optionalMedia(),

    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    author: z.string().optional(),

    metadata: metadataDefinition(),
  }),
});

// ── Pages (change: editable-pages-and-media) ─────────────────────────────────
//
// The home, story and contact pages used to be TypeScript modules under
// src/copy/. That made every word on them a developer task: to change a headline
// you had to edit code, commit and deploy. They are content, so they live in
// content files and the CMS can reach them.
//
// One file per page PER LANGUAGE (`home.he.json`, `home.en.json`), rather than
// one file holding both. Two reasons: a language can then be edited without the
// risk of touching the other, and it matches how the blog posts already work, so
// there is one mental model rather than two.

const homePages = defineCollection({
  // The id is DECLARED, not left to the loader. The default generateId
  // slugifies a filename, so `home.he.json` becomes `home-he`, and every read
  // that assumed the filename silently found nothing.
  loader: glob({
    pattern: 'home.*.json',
    base: 'src/data/pages',
    generateId: ({ entry }) => entry.replace(/.json$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    tagline: z.string(),
    headline: z.string(),
    subhead: z.string(),
    primaryAction: z.string(),
    secondaryAction: z.string(),
    ideasAction: z.string(),

    // ── The conversion copy (change: marketing-home-cro-redesign) ────────────
    //
    // REQUIRED, not optional, and that is the point. Every other island on this
    // page is optional so a page without it still renders; these five are the
    // reasons a visitor does or does not start, and a homepage that quietly
    // drops the one line saying "no signup, no card" looks completely fine while
    // asking for more trust than it has earned. A missing key fails the build,
    // in the language it is missing from.
    //
    /** Social proof framed on engagement DEPTH, never on a user count. */
    heroTrust: z.string(),
    /** The curiosity gap beside the hero map: a challenge, not a caption. */
    heroChallenge: z.string(),
    /** The door for a visitor who came to PLAY, shown under the hero CTAs. */
    heroJoinPrompt: z.string(),
    heroJoinAction: z.string(),
    /** Friction reduction, immediately above the playable mission. */
    lowFrictionNote: z.string(),
    /** The heading beside the founder video. */
    videoLabel: z.string(),
    /** Two or three lines beside the founder video. */
    videoBody: z.string(),
    /** The link from the video section to the full story page. */
    videoStoryAction: z.string(),
    /** The video's running time, e.g. `1:35`. Shown as a badge. */
    videoDuration: z.string(),

    featuresTagline: z.string(),
    featuresTitle: z.string(),
    featuresSubtitle: z.string(),
    features: z.array(z.object({ title: z.string(), description: z.string(), icon: z.string() })),
    stepsTitle: z.string(),
    steps: z.array(z.object({ title: z.string(), description: z.string(), icon: z.string() })),
    ctaTitle: z.string(),
    ctaSubtitle: z.string(),

    // Media. All optional, so the page keeps working with none of it.
    hero: optionalMedia(),

    /**
     * The clip inside the hero's phone frame (change: marketing-home-cro-redesign).
     *
     * ABSENT BY DESIGN. With nothing here the frame shows an inline SVG field map
     * that draws its own route, which costs no request and cannot be the reason
     * the largest paint on the page is slow. Set it once a real screen capture of
     * a game exists and the frame plays that instead, muted and looping, with no
     * code change: a content decision rather than a deploy.
     */
    heroClip: optionalMedia(),
    /**
     * The mission-taste screen shown in the hero when `heroClip` is absent
     * (change: brand-any-place). Three real-feeling missions, each tagged with
     * a different PLACE, so the hero itself makes the "any place" argument
     * instead of a topographic map that argued the opposite.
     */
    heroTaste: z
      .object({
        progress: z.string(),
        clock: z.string(),
        score: z.string(),
        missions: z
          .array(
            z.object({
              kind: z.string(),
              place: z.string(),
              title: z.string(),
              prompt: z.string(),
              points: z.string(),
            }),
          )
          .min(1),
      })
      .optional(),
    galleryTitle: z.string().optional(),
    gallerySubtitle: z.string().optional(),
    gallery: z.array(mediaItem()).default([]),

    // The playable demo mission (change: try-a-mission). OPTIONAL as a whole: a page with no
    // `tryMission` renders exactly as it did before, so this is a content decision rather
    // than a deploy. Every string a visitor can see lives here, in the language's own file,
    // which is what keeps the Hebrew page from leaking English.
    tryMission: z
      .object({
        tagline: z.string().optional(),
        title: z.string(),
        subtitle: z.string(),
        startBody: z.string(),
        startAction: z.string(),
        checkAction: z.string(),
        resetAction: z.string(),
        replayAction: z.string(),
        wrongFeedback: z.string(),
        // `{n}` and `{total}` / `{score}` are substituted at runtime.
        progressLabel: z.string(),
        scoreLabel: z.string(),
        youLabel: z.string(),
        doneTitle: z.string(),
        doneBody: z.string(),
        doneAction: z.string(),
        doneScoreLabel: z.string(),
        doneTimeLabel: z.string(),
        doneRankLabel: z.string(),
        boardNote: z.string(),
        rivals: z.array(z.object({ name: z.string(), score: z.number() })).default([]),
        missions: z.object({
          order: z.object({
            kindLabel: z.string(),
            title: z.string(),
            prompt: z.string(),
            /** Authored in the CORRECT order; the widget scrambles them for display. */
            items: z.array(z.string()).min(2),
          }),
          answer: z.object({
            kindLabel: z.string(),
            title: z.string(),
            prompt: z.string(),
            hint: z.string().optional(),
            answers: z.array(z.string()).min(1),
          }),
          photo: z.object({
            kindLabel: z.string(),
            title: z.string(),
            prompt: z.string(),
            options: z
              .array(z.object({ label: z.string(), emoji: z.string().optional(), correct: z.boolean().optional() }))
              .min(2),
          }),
        }),
      })
      .optional(),

    // The mission idea generator (change: mission-ideas). Optional as a whole, like the demo
    // above it: a page without it renders exactly as before. The bank is CONTENT so adding an
    // idea is a CMS edit rather than a deploy, and each language's bank is written in that
    // language rather than translated from the other.
    missionIdeas: z
      .object({
        tagline: z.string().optional(),
        title: z.string(),
        subtitle: z.string(),
        occasionLabel: z.string(),
        placeLabel: z.string(),
        generateAction: z.string(),
        againAction: z.string(),
        ctaAction: z.string(),
        note: z.string(),
        occasions: z.array(z.object({ id: z.string(), label: z.string() })).min(1),
        places: z.array(z.object({ id: z.string(), label: z.string() })).min(1),
        /** At least three, because the generator hands out three at a time. */
        ideas: z
          .array(z.object({
            kindLabel: z.string().optional(),
            text: z.string(),
            occasions: z.array(z.string()).default([]),
            places: z.array(z.string()).default([]),
          }))
          .min(3),
      })
      .optional(),

    // The station planner (change: game-planner). Optional like the other two islands.
    // The numeric defaults are content so a creator can point the tool at the kind of event
    // they actually run, without a deploy.
    gamePlanner: z
      .object({
        tagline: z.string().optional(),
        title: z.string(),
        subtitle: z.string(),
        fieldLabels: z.object({
          teams: z.string(),
          minutes: z.string(),
          missions: z.string(),
          perMission: z.string(),
          capacity: z.string(),
        }),
        defaultTeams: z.number().int().positive(),
        defaultMinutes: z.number().int().positive(),
        defaultMissions: z.number().int().positive(),
        defaultPerMission: z.number().int().positive(),
        defaultCapacity: z.number().int().positive(),
        outputTitle: z.string(),
        stationsLabel: z.string(),
        durationLabel: z.string(),
        throughputLabel: z.string(),
        verdictOk: z.string(),
        verdictTight: z.string(),
        note: z.string(),
      })
      .optional(),

    // The questions that stop someone trying this (change: home-faq). Optional, and empty
    // renders nothing rather than an empty heading.
    faqTitle: z.string().optional(),
    faqs: z.array(z.object({ title: z.string(), description: z.string() })).default([]),
  }),
});

const storyPages = defineCollection({
  // The id is DECLARED, not left to the loader. The default generateId
  // slugifies a filename, so `home.he.json` becomes `home-he`, and every read
  // that assumed the filename silently found nothing.
  loader: glob({
    pattern: 'story.*.json',
    base: 'src/data/pages',
    generateId: ({ entry }) => entry.replace(/.json$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    headline: z.string(),
    intro: z.string(),
    sections: z.array(
      z.object({
        title: z.string(),
        body: z.array(z.string()),
        // A picture belonging to THIS part of the story, so the page can be told
        // in pictures as well as words instead of stacking them all at the end.
        media: optionalMedia(),
      }),
    ),
    closing: z.string(),
    action: z.string(),
    portrait: optionalMedia(),
  }),
});

const contactPages = defineCollection({
  // The id is DECLARED, not left to the loader. The default generateId
  // slugifies a filename, so `home.he.json` becomes `home-he`, and every read
  // that assumed the filename silently found nothing.
  loader: glob({
    pattern: 'contact.*.json',
    base: 'src/data/pages',
    generateId: ({ entry }) => entry.replace(/.json$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    headline: z.string(),
    intro: z.string(),
    nameLabel: z.string(),
    emailLabel: z.string(),
    messageLabel: z.string(),
    submit: z.string(),
    sending: z.string(),
    successTitle: z.string(),
    successBody: z.string(),
    errorInvalid: z.string(),
    errorRateLimited: z.string(),
    errorOffline: z.string(),
    errorUnknown: z.string(),
    otherWaysTitle: z.string(),
    otherWaysBody: z.string(),
    // The label above the direct address shown when the form cannot reach the
    // API. The address itself is configuration (utils/i18n.ts); this is the
    // sentence around it, which is copy and differs per language.
    directEmailLabel: z.string().optional(),
  }),
});

export const collections = {
  post: postCollection,
  homePages,
  storyPages,
  contactPages,
};
