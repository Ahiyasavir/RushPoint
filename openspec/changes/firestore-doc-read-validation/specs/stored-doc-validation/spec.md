## ADDED Requirements

### Requirement: Core stored documents are validated at the read boundary
The backend SHALL validate the shape of the core stored documents — Game, Run, RunTeam, and Wallet —
at the point they are read back from Firestore, verifying that every REQUIRED field is present and of
the correct runtime type, before the document's data is used in any scoring, routing, ranking, or
payment computation. Validation SHALL be performed by shared, pure (Firebase-free) parsers
(`parseGame`, `parseRun`, `parseRunTeam`, `parseWallet`) that return the strongly-typed object on
success. The parsers SHALL tolerate unknown/extra fields and MUST preserve them on the returned
object, so a document written by a newer code version still parses under the current parser
(forward compatibility). Validation SHALL NOT alter the success-path result: a well-formed document
parses to exactly the object a direct type assertion would have produced, so no observable behavior
changes for a healthy run.

#### Scenario: A well-formed document passes and is used unchanged
- **WHEN** a Game / Run / RunTeam / Wallet document with all required fields correctly typed is read
  by a scoring, routing, or payment path
- **THEN** the parser returns the typed object and the computation proceeds exactly as before,
  producing identical results

#### Scenario: Unknown extra fields are tolerated
- **WHEN** a stored document contains all required fields plus additional fields the current code
  does not recognize (e.g. a field added by a newer deployment)
- **THEN** the parser accepts the document and the extra fields survive on the returned object

#### Scenario: Reads outside the converted scope are unaffected
- **WHEN** a read site that this change does not convert (a denormalized/public/gallery read) loads a
  document
- **THEN** its behavior is unchanged by this requirement (the parsers are available for later
  adoption but are not mandated at every read site)

### Requirement: A malformed stored document fails loud and safe
A malformed core stored document SHALL fail loud and safe. When such a document is missing a
required field, has a required field of the wrong runtime type, or is absent where a value was
expected, the read boundary SHALL fail loud — surfacing a typed
`functions.https.HttpsError` with code `internal` that identifies the document type and the offending
field — and fail safe — the malformed, mis-typed object MUST NOT propagate into scoring, routing,
ranking, or payment logic. Where the read occurs inside a transaction, the parse SHALL happen before
any write is computed, so a malformed document aborts the transaction rather than committing a
mutation derived from invalid data. The parsers themselves (in the shared package) SHALL throw a
typed, Firebase-free `StoredDocError`; a functions-side adapter maps it to the `internal` HttpsError,
mirroring how inbound-payload `ValidationError`s map to `invalid-argument`.

#### Scenario: A required field is missing
- **WHEN** a RunTeam document read on the leaderboard path is missing `score` (or `bonusPenalty`, or
  `stages`)
- **THEN** the read fails with an `internal` HttpsError naming the offending field, and no
  leaderboard ranking is computed from the malformed team

#### Scenario: A required field has the wrong type
- **WHEN** a stored document's required numeric field is non-finite or a required array field is not
  an array (e.g. `eventCredits: NaN`, `stages: {}`)
- **THEN** the parser rejects the document with a typed error naming that field, rather than allowing
  a `NaN` or mis-shaped value to enter downstream math

#### Scenario: A malformed document does not corrupt a transaction
- **WHEN** a document read inside a transaction (e.g. a Wallet during a credit mutation, or a Run
  during task assignment) fails to parse
- **THEN** the transaction aborts with an `internal` error and no write derived from the malformed
  document is committed

#### Scenario: The failure is diagnosable, not a deep stack trace
- **WHEN** a corrupt core document is encountered on any converted read path
- **THEN** the caller receives a clean `internal` error identifying the document type and field,
  instead of a mis-typed object silently producing a `NaN` score or a stack trace thrown deep inside
  scoring/routing
