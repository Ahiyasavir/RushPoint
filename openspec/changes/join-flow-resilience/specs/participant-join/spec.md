## ADDED Requirements

### Requirement: The access code a participant enters is canonicalized before it is sent

The participant app SHALL canonicalize the access code from the join field and from a deep link
through ONE pure, total function before any lookup or join call, and SHALL display the canonicalized
value so the participant always sees exactly what will be sent.

Canonicalization SHALL be tolerant of what a phone and a group chat do to a code: letter case,
leading and trailing whitespace, whitespace inside the code, dashes and other punctuation, and
bidirectional or format control characters SHALL NOT cause a valid code to be refused. When the
entered text contains a join link, the code SHALL be taken from that link's code parameter and the
rest of the link SHALL NOT contribute characters.

The length cap SHALL be applied by the canonicalizing function and SHALL NOT be applied by the input
control alone, so that pasted text is never truncated before it can be canonicalized.

The function SHALL be total: any input, including an empty, whitespace-only, absent or non-string
value, SHALL produce a string rather than an error, and its output SHALL contain only upper-case
letters and digits.

Canonicalization SHALL NOT substitute one character for another. The app SHALL send the characters
the participant supplied, never a different code inferred from them.

The client SHALL NOT decide from the canonicalized code whether a run may be joined. The server
remains the only authority on whether a code resolves and whether the run behind it is joinable.

#### Scenario: A pasted join link

- **WHEN** the participant pastes a full join link that carries the code as a query parameter
- **THEN** the field holds only the code from that parameter, and the lookup uses it

#### Scenario: A code typed with case, spaces or a dash

- **WHEN** the participant types the code in lower case, with a space inside it, with surrounding
  whitespace, or with a dash
- **THEN** the canonicalized code is the same code the host issued, and the lookup succeeds

#### Scenario: Look-alike characters

- **WHEN** the entered text contains characters that resemble other characters, such as the letter O
  and the digit zero
- **THEN** they are passed through unchanged apart from case, and no substituted code is sent

#### Scenario: Absent or unusable input

- **WHEN** the entered value is empty, whitespace only, absent, or not a string
- **THEN** canonicalization yields an empty code and no error is raised

### Requirement: Every join failure is shown as one localized, actionable sentence

The participant app SHALL map every failure returned by the join lookup and the join call to a
message in the participant's own language that states what to do next. It SHALL NOT display a raw
server message, a raw error code, or copy written for the host.

The mapping SHALL be a pure, total function from the failure to a message key: any input, including
an unrecognized failure code, a failure carrying no code, and a non-error value, SHALL produce a key
rather than an error.

The app SHALL distinguish, at minimum:

- a code that does not resolve, in which case the participant is told to check the code with the
  host;
- a code that is no longer active, in which case the participant is told to ask the host for a new
  code;
- a run that has already finished, in which case the participant is told to ask the host for the
  current code;
- a run that is full, in which case the participant is told to tell the host, who can open more
  spots;
- a transport or sign-in failure, in which case the participant is told to check their connection
  and try again, and is NOT told the code is wrong;
- anything else, in which case the participant is told to try again and to reach the host if it
  keeps happening.

Distinguishing these SHALL NOT change any server rule and SHALL NOT let the app proceed past a
failure the server returned.

#### Scenario: A finished run

- **WHEN** the join call fails because the run has already finished
- **THEN** the participant reads a localized sentence saying the race is over and to ask the host
  for the current code, and never the server's English sentence

#### Scenario: A revoked code

- **WHEN** the lookup or the join call fails because the code is no longer active
- **THEN** the participant reads a localized sentence telling them to ask the host for a new code

#### Scenario: A network failure

- **WHEN** the call fails because the network is unavailable, the call timed out, or anonymous
  sign-in has not completed
- **THEN** the participant reads the connection message and is not told that the code is invalid

#### Scenario: An unrecognized failure

- **WHEN** the call fails with a code the app does not recognize, or with no code at all
- **THEN** the participant reads the generic retry message and no raw server text is shown
