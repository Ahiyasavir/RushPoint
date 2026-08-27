# Operator checklist: the off site half of organic search

Everything in this file is **account level work that only you can do**. None of it is code,
none of it can be tested by a gate, and the landing pages this change ships will
underperform without it. Ordered by leverage per minute spent.

Deliberately excluded from the code change for two reasons: creating accounts and
submitting business identity details requires being you, and a checklist that pretends to
be an implementation task would sit permanently unchecked in `tasks.md`.

---

## 1. Search Console (do this first, it gates the rest)

Neither origin's verification status could be checked from the repository, so start here.

- [ ] Verify **`rush-point.com`** in [Google Search Console](https://search.google.com/search-console). Prefer a **Domain property** (DNS TXT record) over a URL prefix property: one domain property covers `http`, `https`, `www` and every subdomain, so it also covers the creator console without a second setup.
- [ ] Submit `https://rush-point.com/sitemap.xml`. It now lists 15 URLs: the join screen, the two legal documents, and the 12 landing pages.
- [ ] Verify **`creator.rush-point.com`** as well if you did not use a domain property.
- [ ] Submit `https://creator.rush-point.com/sitemap.xml`.
- [ ] Under **Indexing → Pages**, check back after roughly a week. The status to look for on the landing pages is *Indexed*. If they read *Discovered, currently not indexed*, that is normal for a new site and means keep going with sections 2 and 3, not that something is broken.
- [ ] Use **URL Inspection → Test live URL** on one Hebrew and one English landing page. Confirm the rendered HTML contains the copy. It will, because the pages need no JavaScript, but this is the check that would have caught it if they did.

**Expect weeks, not days.** The pages are correct and crawlable now; ranking follows from
usefulness and inbound links, and neither is instant.

## 2. Business listings and citations

Consistency is the whole point: the same business name, the same contact details, the same
description, everywhere. Inconsistent details across directories actively hurt, so decide
the exact wording once and reuse it verbatim.

### Google Business Profile — check eligibility before spending time on it

**This may not apply to RushPoint, and that is fine.** Google requires that a business make
**in person contact with customers**, either at a storefront or by travelling to them. A
pure software platform that creators use on their own does not qualify.

- [ ] Decide honestly which you are:
  - **If you personally run events for clients** (you show up and operate the game), you qualify as a **service area business**. Create the profile, **hide the address** (required when you have no storefront with signage), and set service areas realistically. Do not claim every region: over claiming dilutes visibility rather than extending it.
  - **If RushPoint is only software that customers use themselves**, skip Google Business Profile entirely. A profile created on a false premise can be suspended, and a suspension is much harder to undo than a missing listing.
- [ ] Never use a PO box or a virtual office address. Google rejects both, and attempting it risks the profile.

### Israeli directories (highest value for Hebrew search)

- [ ] **Zap** (`zap.co.il`) — the leading Hebrew language listing site. This is the single most valuable listing in this market.
- [ ] **Dooly** — a local directory that also brings real discovery traffic, not only a link.

### Global anchors (these feed maps and AI search worldwide)

- [ ] **OpenStreetMap** — free, and feeds a surprising number of downstream apps.
- [ ] **Foursquare** — feeds map and discovery products beyond its own app.

## 3. Content and links, which is what actually moves rankings

Sections 1 and 2 make the site findable. This section is what makes it rank, and it is the
part that cannot be automated.

- [ ] Get links from places that already reach your audience: youth movement sites, event planner directories, bar mitzvah and wedding vendor lists, school and community newsletters. **Two genuinely relevant Israeli links beat fifty generic directory links**, and paid link schemes are a penalty risk rather than a shortcut.
- [ ] Write follow up content in **native Hebrew**. Roughly 78% of Israeli searches are in Hebrew, and machine translated Hebrew reads as machine translated to the audience you are trying to convince. The 12 pages shipped here are the foundation, not the finished site.
- [ ] After running real events, ask organisers for reviews wherever you are listed. Reviews are both a ranking signal and the thing a human actually reads before booking.

## 4. What to watch, and what not to panic about

- [ ] In Search Console, watch **Performance → Queries** for which Hebrew and English terms actually bring impressions. Those queries tell you which pages to expand next, and they are usually not the ones you predicted.
- [ ] **Do not** expect movement inside the first month. A new site with no inbound links ranks for nothing regardless of how correct its markup is.
- [ ] If a landing page shows as **Alternate page with proper canonical tag**, that is Google correctly recognising the Hebrew and English pair. It is the intended outcome, not an error.

---

## What the code already handles, so you do not have to

For contrast, none of the following needs any action from you. It ships in the repository
and is enforced by `npm test`:

- `robots.txt` and `sitemap.xml` exist as real files on both origins, and the sitemap is regenerated from the page registry, so it can never name a page that does not exist or omit one that does.
- Every page carries a unique title and description, a self referencing canonical, symmetric `hreflang` annotations covering `he-IL`, `en` and `x-default`, Open Graph and Twitter tags, and JSON LD.
- Hebrew pages are checked to contain no English and English pages no Hebrew, using the same predicate that guards the app's translation dictionaries.
- The committed pages are verified byte for byte against their generator, so a stale page fails the build rather than shipping quietly.
