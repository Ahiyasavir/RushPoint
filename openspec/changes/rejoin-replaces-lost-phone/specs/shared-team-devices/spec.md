## ADDED Requirements

### Requirement: A phone that lost its sign-in takes its own place back

When a phone rejoins its team after losing its sign-in, and names the identity it held before
(`replacesUid`), and that identity is still attached to the same team, the server SHALL put the new
identity in the old one's place. Such a rejoin:

- SHALL NOT add a device;
- SHALL NOT be limited by the team's phone allowance;
- SHALL NOT change the run's device count.

If the old identity held the sending role, the new identity SHALL hold it afterwards. The old identity
SHALL no longer be a device of the team.

When `replacesUid` is absent, is not attached to the team being joined, or is the caller, the attach
SHALL behave exactly as an ordinary attach.

#### Scenario: Rejoin on a team at its phone limit
- **GIVEN** a team holding its maximum number of phones, one of which lost its sign-in
- **WHEN** that phone rejoins with the device code and names its old identity
- **THEN** it is attached, the team holds the same number of phones as before, and the old identity is gone

#### Scenario: Repeated losses on one phone
- **GIVEN** a phone that lost its sign-in, rejoined, and then lost it again
- **WHEN** it rejoins again naming its latest identity
- **THEN** it is attached and the team's phone count has not grown

#### Scenario: The sender rejoins
- **GIVEN** the team's sending phone lost its sign-in
- **WHEN** it rejoins naming its old identity
- **THEN** the rejoined phone is the team's sender

#### Scenario: A uid from another team
- **WHEN** a phone attaches to team A naming a uid that belongs to team B
- **THEN** team B is untouched, and the attach to team A follows the ordinary rules
