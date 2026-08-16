## ADDED Requirements

### Requirement: Authenticated media upload
The system SHALL accept a `PUT /upload?path=<path>` request only when it carries a valid
Firebase ID token in the `Authorization: Bearer <token>` header, and SHALL reject any
request lacking or failing this check before reading any request body bytes.

#### Scenario: Missing Authorization header
- **WHEN** a client PUTs to `/upload` with no `Authorization` header
- **THEN** the server responds `401 UNAUTHENTICATED` and does not open a write stream or
  create any temp file

#### Scenario: Invalid or expired token
- **WHEN** a client PUTs to `/upload` with an `Authorization` header that fails
  `admin.auth().verifyIdToken`
- **THEN** the server responds `401 UNAUTHENTICATED` and does not open a write stream or
  create any temp file

### Requirement: Path and ownership validation
The system SHALL require the `path` query parameter to start with `runs/` or `gameMedia/`,
SHALL reject any path containing `..` or a leading `/` or `\`, and SHALL confine a
participant (`runs/`) upload to `runs/{runId}/teams/{callerUid}/...` and a creator
(`gameMedia/`) upload to `gameMedia/{callerUid}/...`, using the authenticated caller's uid.

#### Scenario: Path traversal attempt
- **WHEN** the `path` query parameter contains `..`
- **THEN** the server responds `400 INVALID_ARGUMENT` before reading the body

#### Scenario: Participant uploads to another team's folder
- **WHEN** an authenticated participant PUTs to `runs/{runId}/teams/{otherTeamId}/...` where
  `otherTeamId` does not equal the caller's uid
- **THEN** the server responds `403 PERMISSION_DENIED` before reading the body

### Requirement: Content-type allowlist enforcement
The system SHALL reject any upload whose `Content-Type` header does not match the
applicable allowlist (participant vs. creator) before accepting body bytes beyond what is
needed to read the header.

#### Scenario: Disallowed content type
- **WHEN** a participant PUTs with `Content-Type: application/x-msdownload`
- **THEN** the server responds `400 INVALID_ARGUMENT` and does not write any file to disk

### Requirement: Bounded-memory streaming write
The system SHALL write the request body to disk via a streaming pipeline whose peak
additional memory usage does not scale with the total file size, and SHALL NOT materialize
the complete file body as a single in-memory buffer before validating or writing it.

#### Scenario: Large upload within the size cap
- **WHEN** an authenticated, authorized request with an allowed content type PUTs a body at
  or under the applicable size cap (`MAX_PARTICIPANT_BYTES` or `MAX_CREATOR_BYTES`)
- **THEN** the server streams the body to a temp file, and upon completion atomically
  renames it into place at `UPLOAD_DIR/<path>`, then responds `200` with `{url}` pointing at
  the servable `/uploads/<path>` location

#### Scenario: Concurrent uploads do not scale memory with file size
- **WHEN** N uploads at or near the size cap are in flight concurrently
- **THEN** the server's additional resident memory attributable to those uploads is bounded
  by N times a small, fixed per-connection chunk size — not N times the file size

### Requirement: Early rejection of oversized uploads
The system SHALL stop accepting body bytes for a given upload as soon as the number of
bytes received exceeds the applicable size cap, SHALL discard any partial temp file created
for that upload, and SHALL respond with a size-exceeded error without waiting to receive
the remainder of the body.

#### Scenario: Oversized body is aborted mid-stream
- **WHEN** an authenticated, authorized, correctly-typed request's body exceeds the
  applicable size cap partway through transmission
- **THEN** the server destroys the in-progress write stream and deletes the partial temp
  file as soon as the cap is crossed, and responds `400 INVALID_ARGUMENT` with a
  "file too large" message, without requiring the client to finish sending the oversized
  body

#### Scenario: Declared Content-Length already exceeds the cap
- **WHEN** a request declares a `Content-Length` header greater than the applicable size cap
- **THEN** the server MAY reject the request immediately based on the declared length as a
  fast path, but MUST also enforce the streaming byte-count check as the authoritative
  guard for any request where `Content-Length` is absent, inaccurate, or understated

### Requirement: No partially-written file is ever publicly servable
The system SHALL ensure that a file is only reachable at its final `/uploads/<path>` URL
after it has been completely and successfully received, and SHALL NOT expose a partial or
failed upload's bytes at that path at any point.

#### Scenario: Upload fails after partial write
- **WHEN** an in-progress upload is aborted (oversized, disconnected, or server error) after
  some bytes have already been written to a temp location
- **THEN** a subsequent `GET /uploads/<path>` for that same target path returns `404` (or
  the prior version of the file, if one already existed at that exact path) — never the
  truncated partial content
