import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';

import { LANGUAGES, SITE_ORIGIN, postPath, type Language } from '~/utils/i18n';
import { publishedPosts } from '~/utils/posts';
import { blogCopy } from '~/copy/blog';

/**
 * One feed per language, at /he/rss.xml and /en/rss.xml.
 *
 * A single mixed feed would deliver Hebrew posts to English subscribers and the
 * reverse, which is not a feed anyone wants. Both read `publishedPosts`, the
 * same filter the index and the sitemap read, so a draft cannot be absent from
 * the site and present in the feed.
 */
export function getStaticPaths() {
  return LANGUAGES.map((lang) => ({ params: { lang } }));
}

export const GET: APIRoute = async ({ params }) => {
  const language = params.lang as Language;
  const t = blogCopy[language];
  const posts = await publishedPosts(language);

  return rss({
    title: t.title,
    description: t.description,
    site: SITE_ORIGIN,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.excerpt ?? '',
      pubDate: post.data.publishDate,
      link: postPath(language, post.data.slug),
    })),
    customData: `<language>${language}</language>`,
  });
};
