## 1. Placement spike (blocks every test below)

- [x] 1.1 **Resolved: `functions/mediaServing.js`** — plain CommonJS at the `functions/`
  root, mirroring `functions/uploadRoute.js`. **The path named in `design.md` § D3
  (`functions/lib/…`) is wrong and must not be used:** `functions/lib/` is the esbuild
  output directory (`functions/package.json` `"build"` → `--outfile=lib/index.js`,
  `tsconfig` `outDir: "lib"`) and is gitignored (`.gitignore:27`), so a module placed
  there would be wiped by the next build and never committed.
- [x] 1.2 Proved with a throwaway `createRequire` import from a scratch
  `scripts/test-*.ts` before any real test was written. `server.js` requires it
  directly; a tsx test reaches it through `createRequire(import.meta.url)`.

## 2. Content type — RED

- [x] 2.1 `scripts/test-media-content-type.ts` — a `.webm` prefix containing `V_VP8`
  resolves to `video/webm`. Confirmed RED for the right reason (`MODULE_NOT_FOUND`,
  not a typo).
- [x] 2.2 Extended with the audio case, the inconclusive cases (truncated / empty /
  random / non-Buffer / null → falls back to `audio/webm`) and the unambiguous cases
  (`.jpg` / `.png` / `.mp4` / `.mov` / `.m4a` — the probe is not consulted even when
  the bytes carry a video marker). Still RED.
- [x] 2.3 Totality guards: unknown extension and no extension → `application/octet-stream`;
  a non-string filename never throws; a sweep asserting every `EXTENSION_TYPES` key
  yields a non-empty string, printing the denominator. Still RED.

## 3. Content type — GREEN

- [x] 3.1 Created `functions/mediaServing.js`: `EXTENSION_TYPES` moved in from
  `server.js`, `AMBIGUOUS_EXTENSIONS = {'.webm'}`, `AMBIGUOUS_VIDEO_TYPES`,
  `resolveContentType(filename, bytePrefix)`. Inconclusive falls back to the table, so
  the change can only upgrade `.webm` audio→video, never the reverse.
- [x] 3.2 `probeWebmHasVideo` scans a `latin1` view of the passed `Buffer` for
  `V_VP8` / `V_VP9` / `V_AV1`. Pure, no `fs`, never throws on any input. `latin1`
  rather than `utf8` so no marker can be lost to a replacement character.
- [x] 3.3 `npm test` section 2 GREEN.

## 4. Range decision — RED then GREEN

- [x] 4.1 `scripts/test-range-request.ts` covering every case named in the design plus
  a reversed window, a case-varied unit, a bare dash, a multi-range list, and a
  fractional/NaN/negative total. Confirmed RED.
- [x] 4.2 Seeded 4000-case sweep: every `206` satisfies `0 <= start <= end < total`,
  and the sweep asserts it actually exercised the partial path (denominator printed).
  Still RED.
- [x] 4.3 Implemented `parseRange(rangeHeader, totalBytes)`. Total, never throws;
  anything unparseable degrades to `200`. A multi-range list degrades to `200` rather
  than serving one part and claiming to have satisfied the request.
- [x] 4.4 `npm test` GREEN.

## 5. Content-Disposition — RED then GREEN

- [x] 5.1 `scripts/test-content-disposition.ts` — CR / LF / quote / backslash / NUL /
  ESC / DEL / TAB / BACKSPACE all stripped, the value is always exactly one
  `attachment; filename="…"` line, a name that sanitizes to empty yields the constant.
  **Every dangerous character is built with `String.fromCharCode`, never a source
  escape** — CLAUDE.md records a real defect where a mis-escaped `\b` became a literal
  backspace and the check silently examined nothing. Confirmed RED.
- [x] 5.2 Implemented the sanitizer and builder. **Deliberately a code-point predicate,
  not a regex character class:** every character it must reject is one a regex literal
  would itself have to escape, which is the same trap. A traversal segment falls back
  to the safe constant rather than being reduced to a basename.

## 6. Wire the route (thin I/O only)

- [x] 6.1 Route rewritten. **Deviation from design D3, for testability:** the handler
  moved INTO `mediaServing.js` as `createUploadsGetHandler({ uploadDir })`, taking its
  directory by injection exactly like `createUploadHandler` in `uploadRoute.js`.
  `server.js` is now a one-line mount. This is what makes task 7 possible at all.
  Guards (`..` rejection, `UPLOAD_DIR` containment, existence) are byte-identical and
  still run before any file access; `statSync` for the size; the bounded prefix is read
  only when the extension is ambiguous; `createReadStream(path, {start, end})`.
- [x] 6.2 `nosniff`, `Cache-Control: immutable` and `Access-Control-Allow-Origin: *`
  asserted on the `200`, the `206`, the `416`, the `HEAD` and the `?download=1`
  response. Also added `Access-Control-Expose-Headers` so a cross-origin JS reader can
  actually see `Content-Length` / `Content-Range` / `Accept-Ranges`.
- [x] 6.3 `HEAD` advertises `Accept-Ranges`, `Content-Length` and the same
  `Content-Type` a `GET` would declare (including the probed one), with no body.
- [x] 6.4 A read error mid-stream destroys the response; no late `res.status()`.

## 7. The real HTTP round trip

- [x] 7.1 **Deviation from the design's plan, and the reason matters:
  `scripts/e2e-verify.mjs` CANNOT cover this route.** It drives the Firebase emulator
  suite, and the emulator does not serve `/uploads` at all — that route exists only in
  the self-hosted VPS API. Writing the assertions there would have produced a scenario
  that passed without ever reaching the code. Instead
  `scripts/test-uploads-route.ts` mounts the REAL handler on a bare express app over a
  temp directory and speaks real HTTP to it (no Firebase, no callables bundle, no
  emulator). It runs in the pure lane via `npm test`.
- [x] 7.2 `HEAD` advertises `Accept-Ranges` + correct `Content-Length` with no body; a
  no-`Range` `GET` returns `200` byte-identical to what is on disk.
- [x] 7.3 `?download=1` sets `Content-Disposition: attachment` naming the file; its
  absence sets no such header.
- [x] 7.4 `nosniff` present on the `200`, the `206`, the `416`, `HEAD` and `?download=1`.
- [x] 7.5 Three traversal attempts **with a `Range` header present** are refused and
  serve nothing — asserted against a real file planted outside the upload root, so the
  test fails loudly if it were ever served. Plus: a directory is not served as a file,
  a missing object is still `404`, and a zero-byte object neither hangs nor lies.
- [x] 7.6 **Mutation-checked**: emptying `VIDEO_CODEC_MARKERS` turns the suite RED on
  exactly the three content-type assertions. 58 assertions, denominator printed — a
  suite that examines nothing and a suite that finds nothing print the same line
  otherwise.

## 8. Gates

- [x] 8.1 `npm run verify` — 297/297 unit files green, i18n PART A + PART B clean,
  every build green. The ONE red gate is `check-marketing-output`, failing on the
  untracked `apps/marketing/public/_kit-b83f9d2e/` kit present at session start,
  outside this change. (The pipe trap fired again while getting here:
  `npm run verify > log 2>&1; echo $?` reported the ECHO's status as the tool exit
  code while `VERIFY_EXIT=1`.)
- [x] 8.2 `npm run e2e` — **ALL PASS**, exit 0, 121/121 callables covered. No callable
  added or changed. NOTE the emulator must be self-booted
  (`node scripts/emulator-exec.mjs`) and needs `FUNCTIONS_DISCOVERY_TIMEOUT=120`, or
  every scenario fails identically with `functions/not-found` — the documented
  discovery-timeout storm, not a regression.
- [x] 8.3 No UI text changed ⇒ `i18n:check:strict` reports zero new findings.
- [x] 8.4 `scripts/test-source-control-chars.ts` green over the three new test files
  and the new module.

## 9. Ship and verify in production

- [ ] 9.1 Commit/PR body states this is VPS API code: it ships by `git pull` +
  `docker compose -f docker-compose.api.yml up -d --build` on the VPS, NOT by
  `deploy:hosting`. Expect the documented ~40 s `503` window; do not deploy mid-event.
- [ ] 9.2 After deploy, re-request the four known-broken `.webm` URLs from run
  `ijI9JMITSf8C9heN1Cwp` and assert `Content-Type: video/webm`.
- [ ] 9.3 Probe production: `Range: bytes=0-9` → `206`; `?download=1` →
  `Content-Disposition: attachment`; `nosniff` still present on each.
- [ ] 9.4 Open that run's Run Console and confirm the four previously-black videos now
  play, and that the gallery download button saves a file.

## 10. Follow-ups to file separately (do NOT do here)

- [ ] 10.1 The retention question from `design.md` § Open Questions: `pruneRunPII`
  purges media via a *Firebase Storage* bucket prefix while the VPS stores objects on
  local disk, and nothing appears to call the internal `DELETE /uploads/*` prefix
  route — so disk-stored participant media may never be swept at 90 days.
- [ ] 10.2 "The review queue has no download action at all" (`PhotoReviewConsole`).
