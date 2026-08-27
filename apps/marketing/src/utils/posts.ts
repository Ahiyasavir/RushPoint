/**
 * The published post set, and the single filter that decides what "published"
 * means.
 *
 * ONE definition, read by the index, the post pages, the sitemap and the feed.
 * When each surface applies its own filter they eventually disagree, and the
 * way you find out is a draft appearing in a feed.
 *
 * Change: marketing-site.
 */
import { getCollection, type CollectionEntry } from 'astro:content';

import { postPath, postUrl, HREFLANG, X_DEFAULT_LANGUAGE, type Alternate, type Language } from './i18n';

export type Post = CollectionEntry<'post'>;

/**
 * Every published post, newest first.
 *
 * Drafts are excluded HERE, once. `import.meta.env.PROD` is deliberately not
 * consulted: a draft that is visible in dev and invisible in production is a
 * post nobody proofreads in the state it actually ships in.
 */
export async function publishedPosts(language?: Language): Promise<Post[]> {
  const all = await getCollection('post', ({ data }) => data.draft !== true);
  const scoped = language ? all.filter((post) => post.data.language === language) : all;
  return scoped.sort((a, b) => b.data.publishDate.valueOf() - a.data.publishDate.valueOf());
}

/** A post's path, derived from its DECLARED slug. Never from its title. */
export function pathOf(post: Post): string {
  return postPath(post.data.language, post.data.slug);
}

export function urlOf(post: Post): string {
  return postUrl(post.data.language, post.data.slug);
}

/**
 * A post's hreflang cluster.
 *
 * Empty unless the author declared a `pairedSubject` AND a post carrying the
 * same value exists in the other language. An empty set is the accurate
 * statement that no counterpart exists: annotating one that is not there points
 * a reader at a page about something else, which is worse than saying nothing.
 */
export async function alternatesOfPost(post: Post): Promise<Alternate[]> {
  const subject = post.data.pairedSubject;
  if (!subject) return [];

  const siblings = (await publishedPosts()).filter((p) => p.data.pairedSubject === subject);
  if (siblings.length < 2) return [];

  const entries: Alternate[] = siblings.map((p) => ({
    hreflang: HREFLANG[p.data.language],
    href: urlOf(p),
  }));

  const fallback = siblings.find((p) => p.data.language === X_DEFAULT_LANGUAGE) ?? siblings[0];
  return [...entries, { hreflang: 'x-default', href: urlOf(fallback) }];
}
