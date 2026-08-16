## ADDED Requirements

### Requirement: Step 3 opt-in chip labels describe their group's real contents
Each step 3 opt-in chip label, and the group title it expands into, SHALL describe in plain language what that group actually contains. A label SHALL NOT name only one member of a multi-purpose group in a way that misrepresents the rest. A chip and the group it opens SHALL use the same label text, so opening a chip never renames what the creator clicked. Group membership, chip order, chip styling, and the collapsed-by-default rule are unchanged.

#### Scenario: The timing/points chip and its group share one plain label
- **WHEN** a creator views the step 3 chip row and then opens the timing/points group
- **THEN** the chip label and the opened group's title are the same plain-language string describing points and timing

#### Scenario: The rules chip label reflects that the group governs unlocking and limits
- **WHEN** a creator views the chip for the group holding `unlockAfterTaskIds`, `requirePresence`, `tags`, and `maxConcurrentTeams`
- **THEN** its label describes unlocking and limits rather than the bare word "Rules", and does not name prerequisites alone as though that were the group's only content

#### Scenario: The already-clear hint chip is unchanged
- **WHEN** a creator views the chip for the hint group
- **THEN** its label is unchanged from before this change

#### Scenario: Group membership and behavior are untouched
- **WHEN** a creator opens any step 3 opt-in group after this change
- **THEN** it contains exactly the same fields as before, in the same order, with the same collapsed-by-default behavior and the same count badge semantics

#### Scenario: New labels obey the no-dash copy standard
- **WHEN** the new chip and group labels are scanned by the user-facing-copy dash check
- **THEN** none contains a hyphen, en dash, em dash, or other banned dash separator, and `scripts/test-no-dashes.ts` passes

#### Scenario: Labels exist in both languages
- **WHEN** the chip row renders in either language
- **THEN** every chip and group label resolves from a `t.*` key with both EN and HE entries, with HE pure Hebrew and EN pure English
