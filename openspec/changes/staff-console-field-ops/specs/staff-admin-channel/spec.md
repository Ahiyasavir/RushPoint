## ADDED Requirements

### Requirement: Staff and the run's admin share one messaging thread per run
The system SHALL provide a single, run-scoped messaging thread that any authorized staffer and the
run's owner (admin) can read and post to, separate from the existing team↔HQ chat.

#### Scenario: A staffer sends a message to the thread
- **WHEN** an authorized staffer sends a message in the staff↔admin channel
- **THEN** the message is stored in that run's shared thread, attributed to that staffer by name,
  and visible to every other authorized staffer and to the run's owner

#### Scenario: The admin replies from the desktop console
- **WHEN** the run's owner sends a message in the staff↔admin channel from the desktop Run Console
- **THEN** the message appears in the same shared thread, attributed to the admin, and is visible
  on every staffer's mobile console

#### Scenario: Sender role is server-determined, never client-supplied
- **WHEN** any message is sent to the channel
- **THEN** whether it is attributed as staff or admin is decided by the server from the caller's
  authenticated identity, never from a value the client sends

### Requirement: The channel is scoped to authorized participants only
Only the run's owner and staff authorized for that specific run SHALL be able to read or post to
its channel.

#### Scenario: An unrelated user cannot read the channel
- **WHEN** a user who is neither the run's owner nor an authorized staffer for that run attempts
  to read the channel
- **THEN** the read is refused

#### Scenario: A client cannot write the thread directly
- **WHEN** any client attempts to write to the channel's storage directly, bypassing the send
  callable
- **THEN** the write is refused — every message is written by the server only

### Requirement: Staff and admin can each tell unread messages from read ones
Both sides of the channel SHALL be able to see when new messages have arrived since they last
viewed the thread.

#### Scenario: A new message shows as unread until viewed
- **WHEN** a message arrives in the channel while a staffer or the admin has not yet viewed it
- **THEN** their console indicates the thread has unread activity, and that indicator clears once
  they view the thread
