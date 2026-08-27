# Uploads

Pictures and videos added through the content editor at `/admin/` land here, and
are served from the site root: a file called `race-start.jpg` is reachable at
`/uploads/race-start.jpg`.

They are committed to the repository, which is what makes them work with no
storage service and no third party. That has one real cost worth knowing before
you upload a long video: **git keeps every version of a file forever.** Replacing
a 40 MB video five times leaves 200 MB in the repository permanently, even though
only the last one is on the site.

So, before uploading a video:

- Trim it to the part you actually want people to watch.
- Export at 1080p or smaller. A marketing page does not need 4K.
- Aim for tens of megabytes, not hundreds.

`scripts/test-marketing-media.ts` fails the build if a file here goes over the
budget, and tells you which one. That is a guard against a mistake that is
awkward to undo, not a style rule.
