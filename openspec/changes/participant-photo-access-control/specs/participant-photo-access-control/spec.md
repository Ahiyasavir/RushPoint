## ADDED Requirements

> **NOT YET APPROVED.** These requirements describe the target capability that the recommended
> option (design.md § Option D, Phase 1) would establish. They are authored so the change can be
> reviewed and validated as a decision artifact; no implementation is authorized until the product
> owner selects an option. If a different option is chosen, these requirements are the ones to amend.

### Requirement: Participant media is not disclosed to an unauthenticated public audience

Participant-uploaded media (photos and audio submitted during a run) SHALL NOT be disclosed to
callers outside the run through any surface that is reachable with only a shared link. In particular,
the shareable public-standings surface SHALL NOT return any media reference — URL or path — to a
caller who is neither the run owner nor run-scoped staff, regardless of whether the run's leaderboard
has been published. Where a game deliberately wants public media on the big screen, that SHALL be an
explicit per-game opt-in that is disabled by default and disclosed to the creator at authoring time.

#### Scenario: A non-owner reading a published board receives no media references

- **WHEN** an authenticated caller who is not the run owner and not run-scoped staff requests the
  public leaderboard for a published run that has approved photo submissions
- **THEN** the response contains the standings and no media reference of any kind for any team

#### Scenario: The owner still gets the ceremony media

- **WHEN** the run owner requests the same published run's board
- **THEN** the ceremony media selection is returned as before, so the organizer-operated big-screen
  finale is unaffected

#### Scenario: An opt-in game may expose ceremony media publicly

- **WHEN** a game has explicitly enabled public ceremony media and its run's board is published
- **THEN** a non-owner caller receives the ceremony media selection

#### Scenario: The opt-in defaults to off

- **WHEN** a game has no explicit value for the public-ceremony-media setting
- **THEN** it is treated as disabled, and non-owner callers receive no media references

#### Scenario: No world-readable document carries a media reference

- **WHEN** the public gallery documents for a published game are read by an unauthenticated client
- **THEN** they contain no participant media reference — only creator-authored, deliberately public
  content

### Requirement: Removing participant media makes it unreachable, not merely unlisted

Removing participant media SHALL delete the underlying stored object, not merely de-list it. This
applies when a run's staff or owner removes an item and when a participant's deletion request is
honoured. Any
previously issued link to that object SHALL stop resolving. Deletion SHALL derive its storage
location through the hardened, unit-tested path helpers so that a missing or blank identifier fails
loudly instead of widening the deletion scope. Removal SHALL remain authorized to run-scoped staff
and the run owner only, and SHALL stay idempotent.

#### Scenario: Hiding a feed photo makes the object unreachable

- **WHEN** the owner or run-scoped staff hides a live-feed photo
- **THEN** the item is de-listed for participants **and** the stored object no longer exists, so a
  previously issued link to it no longer resolves

#### Scenario: Removal is idempotent

- **WHEN** removal is invoked again for media that has already been removed
- **THEN** the call succeeds without error and nothing further is deleted

#### Scenario: A participant cannot remove another team's media

- **WHEN** a run participant attempts the removal operation
- **THEN** the call is denied by the same staff/owner authorization that guards hiding today

#### Scenario: A blank identifier never widens the deletion

- **WHEN** a removal is attempted with a missing or empty run or team identifier
- **THEN** the path derivation throws and nothing is deleted

#### Scenario: Restoring a removed item does not resurrect the media

- **WHEN** a previously removed item is restored by staff
- **THEN** the listing may return, and the system SHALL NOT present a broken media reference for an
  object that no longer exists

### Requirement: Every run's media reaches its retention deadline

The retention sweep SHALL reach participant media for **every** run, including runs that were never
finalized. A run that has been inactive beyond the retention window SHALL be pruned on the same terms
as a finished one: its stored media objects deleted, its persisted media references cleared, and the
run stamped so the sweep is idempotent. Aggregate results (scores, rankings) SHALL continue to be
retained.

#### Scenario: A finished run is pruned as before

- **WHEN** the sweep runs against a run finished longer ago than the retention window
- **THEN** its media objects are deleted, its stored media references are cleared, and it is stamped
  as pruned

#### Scenario: An abandoned run is pruned too

- **WHEN** the sweep runs against a run that was never finalized and has had no activity for longer
  than the retention window
- **THEN** it is pruned on the same terms as a finished run

#### Scenario: A live run is never pruned

- **WHEN** the sweep runs against a run that is currently in progress or recently active
- **THEN** it is left untouched

#### Scenario: Pruning is idempotent

- **WHEN** the sweep runs twice over the same eligible run
- **THEN** the second pass performs no further deletion and reports the run as already pruned

#### Scenario: Prune eligibility is decided by pure, emulator-free logic

- **WHEN** the pure-logic test lane runs
- **THEN** an assertion script proves the eligibility predicate for finished, abandoned, active and
  already-pruned runs without requiring the emulator

### Requirement: Sharing a submission never forwards a raw permanent media link

The participant sharing flow SHALL NOT place a raw, permanently valid media URL into a share sheet,
clipboard or message body. When the branded-image composition path cannot complete, the share SHALL
degrade to text that carries no media link, and SHALL still not throw.

#### Scenario: Branded composition succeeds

- **WHEN** a participant shares a submitted photo and the branded image can be composed
- **THEN** the composed image is shared and no media URL appears in the shared text

#### Scenario: Composition fails

- **WHEN** the image cannot be loaded or the composed image cannot be produced
- **THEN** the share falls back to a caption containing no media link, and the operation does not
  throw

### Requirement: The published privacy disclosure matches the audience actually granted

The in-app privacy document SHALL describe the audience that actually receives participant media —
including other teams in the run when the live feed is enabled, and any additional audience created
by an opt-in public surface — and SHALL describe what removal and retention actually achieve. The
disclosure SHALL be present and consistent in both the Hebrew and English document bodies, and SHALL
NOT be contradicted by the Terms.

#### Scenario: The photo section names every audience

- **WHEN** a reader reads the photo section of the privacy document in either language
- **THEN** it names the creator, their staff, other teams in the run where the live feed is enabled,
  and any opt-in public surface

#### Scenario: The privacy document and the terms agree

- **WHEN** the photo audience described in the privacy document is compared with the
  participant-uploaded-content section of the terms
- **THEN** the two describe the same audience

#### Scenario: Retention copy matches retention behavior

- **WHEN** the retention statement for uploaded media is compared with the implemented sweep
- **THEN** the stated deadline applies to every run the sweep can reach, with no category of run
  silently retained beyond it

#### Scenario: Disclosure copy is localized

- **WHEN** the i18n check runs after the disclosure is updated
- **THEN** it passes with no dictionary errors and the new copy adds no hardcoded-string findings
