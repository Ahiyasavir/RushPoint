## ADDED Requirements

### Requirement: The apps show drawn icons, never stock emoji
The creator console and the participant app SHALL NOT render stock emoji in their own interface text,
labels, buttons, headings, empty states or generated share images. Where an icon helps, it SHALL be a
drawn icon from the app's own icon set, decorative beside words that carry the meaning.

#### Scenario: A staff member opens the alerts section
- **WHEN** the staff app shows the SOS alerts heading
- **THEN** the heading carries a drawn alert icon and no emoji character

#### Scenario: A new emoji is added to UI code
- **WHEN** a developer adds an emoji literal to either app's UI code
- **THEN** `scripts/test-no-stock-emoji.ts` fails

### Requirement: Reactions keep their stored keys
Feed and live reactions SHALL keep the emoji keys they are stored under, and SHALL be shown on screen as
drawn icons mapped from those keys.

#### Scenario: Reacting to a photo
- **WHEN** a player reacts to a feed photo with "fire"
- **THEN** the stored reaction key is unchanged from before this change and the button shows a drawn flame
