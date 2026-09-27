/**
 * Reading a standing page's content for one language.
 *
 * The pages used to be TypeScript modules indexed by language, so a page read
 * was `homeCopy[language]` and could not fail. Content collections are async and
 * CAN fail: a missing file, a renamed id, a schema change. This is the one place
 * that turns "the entry for this language" into a value, so every page fails the
 * same way instead of each inventing its own fallback.
 *
 * A missing entry THROWS rather than falling back to the other language. Silently
 * serving English on a Hebrew URL would look like a working page while being the
 * wrong one, and the build is the right place to find out.
 *
 * Change: editable-pages-and-media.
 */
import { getEntry, type CollectionEntry } from 'astro:content';

import type { Language } from './i18n';

/** The collections that hold standing pages. Posts are read elsewhere. */
export type PageCollection = 'homePages' | 'storyPages' | 'contactPages';

export async function pageContent<K extends PageCollection>(
  collection: K,
  page: string,
  language: Language,
): Promise<CollectionEntry<K>['data']> {
  // The loader's generateId strips the extension, so `home.he.json` is `home.he`.
  const id = `${page}.${language}`;

  // getEntry is typed against the union of every collection's ids, which a
  // computed id cannot satisfy. The cast is on the ID only; the RESULT keeps its
  // collection type, so the fields each page reads are still checked.
  const entry = (await getEntry(collection, id as never)) as CollectionEntry<K> | undefined;

  if (!entry) {
    throw new Error(
      `Missing content for ${collection}/${id}. Expected apps/marketing/src/data/pages/${id}.json. ` +
        'A standing page must exist in BOTH languages: serving one language on the other ' +
        "language's URL would look like a working page while being the wrong one.",
    );
  }

  return entry.data;
}
