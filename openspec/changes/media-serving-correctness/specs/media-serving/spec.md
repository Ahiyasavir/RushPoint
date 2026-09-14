# media-serving Specification

## ADDED Requirements

### Requirement: Served Content-Type reflects the object's actual media kind

`GET /uploads/*` in `functions/server.js` SHALL declare a `Content-Type` that matches
what the stored object actually is, rather than what its filename extension suggests.

The historical table maps `.webm` to `audio/webm`, while `functions/uploadRoute.js`
accepts BOTH `audio/webm` and `video/webm` as legitimate participant uploads — so a
video submission and an audio submission are stored under the same extension and the
extension cannot distinguish them. Because every response also carries
`X-Content-Type-Options: nosniff`, a wrong declaration is not recoverable by the
browser: it is final.

For any extension that is ambiguous between media kinds in this product, the route
SHALL determine the kind by inspecting the stored container's own declarations. For an
unambiguous extension the existing table SHALL continue to decide, unchanged.

The resolution SHALL be implemented as a pure, exported, total function (no `fs`, no
Express — it takes a filename and a byte prefix) so it is unit-testable in the
`npm test` lane, with the route reduced to I/O around it. It SHALL return a usable
type for every input, never `undefined`, and SHALL never throw, falling back to the
extension table and finally to `application/octet-stream`.

#### Scenario: A stored .webm carrying a video track is served as video

- **GIVEN** a `.webm` object whose bytes declare a VP8, VP9 or AV1 video track
- **WHEN** it is requested
- **THEN** the response declares `Content-Type: video/webm`
- **AND** a `<video>` element rendering that URL displays a picture

#### Scenario: A stored .webm carrying only audio is served as audio

- **GIVEN** a `.webm` object whose bytes declare only an audio track
- **WHEN** it is requested
- **THEN** the response declares `Content-Type: audio/webm`

#### Scenario: Existing media is repaired with no migration

- **GIVEN** the four `.webm` video submissions of run `ijI9JMITSf8C9heN1Cwp`, stored
  before this change and currently served as `audio/webm`
- **WHEN** they are requested after this change ships
- **THEN** they are served as `video/webm` and become viewable
- **AND** no object was rewritten, re-uploaded or migrated to achieve it

#### Scenario: An unambiguous extension is unaffected

- **WHEN** a `.jpg`, `.png` or `.mp4` object is requested
- **THEN** the content type is exactly what the existing extension table already
  declares, with no inspection performed

#### Scenario: A truncated or unreadable container does not fail the request

- **GIVEN** a `.webm` object whose leading bytes are truncated, empty or malformed
- **WHEN** it is requested
- **THEN** the inspection is inconclusive, the extension table's value is used
- **AND** the response is still a successful delivery of the object's bytes

#### Scenario: An unknown extension is served as octet-stream

- **WHEN** a stored object's extension is absent from the known-type table
- **THEN** the response declares `Content-Type: application/octet-stream`
- **AND** the request still succeeds

### Requirement: Content inspection reads a bounded prefix, never the whole object

Determining the media kind SHALL read at most a bounded prefix of the stored file, so
its cost does not scale with object size. A 15 MB clip SHALL NOT be read in full to
decide how to label it.

The inspection SHALL NOT be performed for an extension the table already resolves
unambiguously.

#### Scenario: A large video is labelled without being fully read

- **GIVEN** a 15 MB `.webm` video object
- **WHEN** it is requested
- **THEN** the bytes read to determine its content type are bounded by the configured
  prefix size, not by the object's length

#### Scenario: A ranged request does not re-read the whole object to label it

- **WHEN** a `Range` request asks for bytes near the end of a large `.webm` object
- **THEN** the content type is still determined from the bounded leading prefix
- **AND** only the requested range is streamed to the client

### Requirement: nosniff and the path-traversal guards survive unchanged

Every response from `GET /uploads/*` SHALL continue to carry
`X-Content-Type-Options: nosniff`.

The route SHALL continue to reject a `relativePath` containing `..` with `400`, and
SHALL continue to refuse any resolved path that does not lie within `UPLOAD_DIR` with
`403`. Neither range handling nor content inspection SHALL introduce a second path
that reaches the filesystem without both guards.

#### Scenario: nosniff is present on a ranged response too

- **WHEN** a `Range` request is answered with `206`
- **THEN** the response still carries `X-Content-Type-Options: nosniff`

#### Scenario: Traversal is still refused when a Range header is present

- **WHEN** a request carries both a traversal attempt in the path and a `Range` header
- **THEN** the request is refused by the existing guard with its existing status
- **AND** no file outside `UPLOAD_DIR` is opened or inspected

#### Scenario: Inspection happens only after the guards pass

- **WHEN** a request would be refused with `400` or `403`
- **THEN** no byte of any file is read for content inspection

### Requirement: Media is seekable via HTTP range requests

`GET /uploads/*` SHALL advertise `Accept-Ranges: bytes` and SHALL send a
`Content-Length` on every successful response.

Given a satisfiable `Range: bytes=<start>-<end>` request, the route SHALL respond
`206 Partial Content` with a `Content-Range: bytes <start>-<end>/<total>` header and
only the requested bytes. An open-ended range (`bytes=<start>-`) SHALL be served to
the end of the object. A suffix range (`bytes=-<n>`) SHALL return the final `n` bytes.

A request with no `Range` header SHALL respond `200` with the whole object, exactly as
today.

The mapping from a `Range` header string plus a total byte length to a decision
(`200`, `206` with an offset pair, or `416`) SHALL be a pure, exported, total function
covered by the `npm test` lane. It SHALL never produce an offset outside the object,
never produce `end < start`, and never throw for any input string.

#### Scenario: A satisfiable range returns 206 with the requested bytes

- **WHEN** a client requests `Range: bytes=0-99` on a 1000-byte object
- **THEN** the response status is `206`
- **AND** `Content-Range` is `bytes 0-99/1000`
- **AND** `Content-Length` is `100`
- **AND** exactly the first 100 bytes are returned

#### Scenario: An open-ended range runs to the end of the object

- **WHEN** a client requests `Range: bytes=500-` on a 1000-byte object
- **THEN** the response status is `206` and `Content-Range` is `bytes 500-999/1000`

#### Scenario: A suffix range returns the tail

- **WHEN** a client requests `Range: bytes=-200` on a 1000-byte object
- **THEN** the response status is `206` and `Content-Range` is `bytes 800-999/1000`

#### Scenario: A suffix range larger than the object returns the whole object

- **WHEN** a client requests `Range: bytes=-5000` on a 1000-byte object
- **THEN** the response status is `206` and `Content-Range` is `bytes 0-999/1000`

#### Scenario: A range past the end of the object is unsatisfiable

- **WHEN** a client requests `Range: bytes=5000-6000` on a 1000-byte object
- **THEN** the response status is `416`
- **AND** the response carries `Content-Range: bytes */1000`

#### Scenario: A malformed range header is ignored rather than fatal

- **WHEN** a client sends a `Range` header the parser cannot understand
  (for example `bytes=abc-def`, `items=0-10`, `bytes=`, or an empty value)
- **THEN** the route responds `200` with the whole object
- **AND** the request does not error

#### Scenario: A zero-byte object with a range is unsatisfiable

- **WHEN** a client requests any byte range on a zero-length object
- **THEN** the response status is `416` and the request does not throw

#### Scenario: No Range header behaves exactly as before

- **WHEN** a client requests an object with no `Range` header
- **THEN** the response status is `200` and the whole object is returned

#### Scenario: A HEAD request advertises range support without a body

- **WHEN** a client issues `HEAD` on a stored object
- **THEN** the response carries `Accept-Ranges: bytes`, the correct `Content-Length`
  and the same `Content-Type` a `GET` would declare
- **AND** no body bytes are sent

### Requirement: A download is requested explicitly and is served as an attachment

`GET /uploads/*` SHALL send `Content-Disposition: attachment` only when the request
explicitly asks for it via a query flag. Without that flag the response SHALL carry no
`Content-Disposition`, so inline `<video>` / `<img>` rendering in the review consoles
is unaffected.

The header exists because the `download` attribute on an `<a>` is ignored for
cross-origin URLs — media is served from the API origin while the creator console runs
on its own origin — so the already-correct client code in
`apps/creator-web/src/lib/downloadFile.ts` cannot work without it.

The filename in the header SHALL be derived from the object's own stored name and
sanitized: any character that could terminate or inject a header — CR, LF, `"`, and
any other control character — SHALL be removed or replaced before it is emitted. A
name that sanitizes to empty SHALL fall back to a safe constant. The sanitizer SHALL
be a pure, exported, total function covered by the `npm test` lane.

#### Scenario: The download flag produces an attachment

- **WHEN** an object is requested with the download query flag set
- **THEN** the response carries `Content-Disposition: attachment` naming the file
- **AND** a browser saves the file instead of navigating to it

#### Scenario: Without the flag, playback stays inline

- **WHEN** the same object is requested with no download flag
- **THEN** the response carries no `Content-Disposition` header
- **AND** a `<video>` element plays it inline as before

#### Scenario: A filename carrying control characters cannot inject a header

- **WHEN** a stored object's name contains a CR, an LF or a double quote
- **THEN** those characters do not appear in the emitted `Content-Disposition` value
- **AND** the response headers parse as a single well-formed header block

#### Scenario: A filename that sanitizes to nothing still yields a valid header

- **WHEN** a stored object's name consists only of characters the sanitizer strips
- **THEN** the emitted header names a safe fallback filename
- **AND** the header is still well-formed

#### Scenario: Download and range compose

- **WHEN** a request carries both the download flag and a satisfiable `Range` header
- **THEN** the response is `206` and also carries `Content-Disposition: attachment`
