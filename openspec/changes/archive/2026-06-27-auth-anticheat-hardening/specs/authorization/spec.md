# Authorization

## ADDED Requirements

### Requirement: Station callables act only on the caller's own team
The station callables `submitStationPhoto` and `verifyStationCode` SHALL derive the acting team
from the authenticated token (`context.auth.uid`) and MUST NOT trust a `teamId` supplied in the
request payload. When the payload carries a `teamId` that differs from the caller's uid, the call
MUST be rejected with `permission-denied` and no team state may change.

#### Scenario: Mismatched payload teamId is rejected
- **WHEN** team A (uid_A) calls `submitStationPhoto` or `verifyStationCode` with `teamId = uid_B`
- **THEN** the call fails with `permission-denied`
- **AND** team B's progress, score, and `activeTaskId` are left unchanged

#### Scenario: Caller acts on its own team
- **WHEN** team A calls `submitStationPhoto`/`verifyStationCode` with no `teamId` or `teamId = uid_A`
- **THEN** the call is processed against team A's own document
- **AND** an `autoApprove` photo task advances only team A

### Requirement: Access codes cannot be enumerated
A client SHALL be able to read a single access-code document by its known code id (`get`) but MUST
NOT be able to list the `accessCodes` collection. The `firestore.rules` for `/accessCodes/{code}`
MUST split `allow get` (authenticated) from `allow list` (denied), so the join lookup keeps working
while collection-wide harvesting of every run's `{ownerUid, gameId, runId}` is impossible.

#### Scenario: Direct get by known code succeeds
- **WHEN** an authenticated client calls `getDoc(doc('accessCodes', CODE))` for a code it knows
- **THEN** the document is returned (join flow unaffected)

#### Scenario: Listing the collection is denied
- **WHEN** any client calls `getDocs(collection('accessCodes'))`
- **THEN** the read is denied by the security rules

#### Scenario: Server-side lookups are unaffected
- **WHEN** `getJoinInfo` or `getPublicLeaderboard` resolves a code by id via the Admin SDK
- **THEN** the lookup still succeeds (rules apply to clients, not Cloud Functions)
