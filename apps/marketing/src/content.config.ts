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
    /** A video embed URL for the post body. */
    video: z.url().optional(),

    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    author: z.string().optional(),

    metadata: metadataDefinition(),
  }),
});

export const collections = {
  post: postCollection,
};
