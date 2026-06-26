## ADDED Requirements

### Requirement: submitStationPhoto rejects photoUrl from non-Firebase-Storage origins
The `submitStationPhoto` callable in `functions/src/runs/index.ts` SHALL validate that the
`photoUrl` parameter begins with the project's Firebase Storage HTTPS prefix:
`https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/`

If the URL does NOT begin with that prefix, the callable SHALL throw
`new functions.https.HttpsError('invalid-argument', 'Photo URL must be a Firebase Storage URL.')`.
No photo submission document SHALL be written to Firestore for an invalid URL.

The prefix check SHALL be implemented as a pure, exported helper `isFirebaseStorageUrl(url)`
in `packages/shared/src/validation.ts` (re-exported from `@rushpoint/shared`) so it is unit-
testable without the Firebase Admin SDK and shared between the callable and the test lane. The
helper SHALL return `false` for non-string input.

#### Scenario: Valid Firebase Storage URL — submission accepted
- **WHEN** `submitStationPhoto` is called with `photoUrl = "https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/runs%2F..."`
- **THEN** the callable proceeds normally and returns `{ submitted: true, ... }`

#### Scenario: External URL — submission rejected with INVALID_ARGUMENT
- **WHEN** `submitStationPhoto` is called with `photoUrl = "https://example.com/malicious.jpg"`
- **THEN** the callable throws `HttpsError` with code `invalid-argument`
- **THEN** no `stationReview` document is written to Firestore

#### Scenario: HTTP (not HTTPS) Firebase Storage URL — submission rejected
- **WHEN** `submitStationPhoto` is called with `photoUrl = "http://firebasestorage.googleapis.com/..."`
- **THEN** the callable throws `HttpsError` with code `invalid-argument`

#### Scenario: Blank URL — submission rejected
- **WHEN** `submitStationPhoto` is called with `photoUrl = ""`
- **THEN** the callable throws `HttpsError` with code `invalid-argument`

#### Scenario: e2e test — bad URL rejected, good URL accepted
- **WHEN** the e2e suite (`scripts/e2e-verify.mjs`) calls `submitStationPhoto` with an external URL
- **THEN** the call throws and the error code is `invalid-argument`
- **WHEN** the e2e suite calls `submitStationPhoto` with a valid Firebase Storage URL
- **THEN** the call returns `{ submitted: true, autoApproved: false }`


### Requirement: PhotoEntry revokes object URL on cleanup
`PhotoEntry` in `TaskRunner.tsx` SHALL revoke the object URL created by
`URL.createObjectURL(f)` when either (a) the preview is replaced by a new file pick or
(b) the component unmounts. No blob URL SHALL remain active after the preview it was
created for is no longer in use.

#### Scenario: New file picked — previous object URL revoked
- **WHEN** the participant picks a file (creating object URL A), then picks another file (creating object URL B)
- **THEN** `URL.revokeObjectURL` is called with URL A before URL B is set as the preview

#### Scenario: Component unmounts — active object URL revoked
- **WHEN** the component unmounts while a file preview is active
- **THEN** `URL.revokeObjectURL` is called with the active preview URL
