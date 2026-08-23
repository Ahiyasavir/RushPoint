## ADDED Requirements

### Requirement: Unread is what came after the viewer last looked

The system SHALL define a thread's unread count, for one viewer, as the number of messages that
appear after the last message that viewer has already seen.

The viewer's own messages SHALL NOT be counted as unread, regardless of which side the server
attributed them to.

A viewer with no recorded reading history SHALL see every message in the thread that they did not
write themselves counted as unread.

An empty thread SHALL report zero unread for any reading history.

#### Scenario: Nothing new since the last look

- **WHEN** a viewer's reading history names the newest message in the thread
- **THEN** the unread count is zero

#### Scenario: New messages since the last look

- **WHEN** two messages from other participants have arrived after the message named by the viewer's reading history
- **THEN** the unread count is two

#### Scenario: The viewer's own message is not unread

- **WHEN** the only message that arrived after the viewer's reading history was written by that viewer
- **THEN** the unread count is zero

#### Scenario: First time opening a thread

- **WHEN** a viewer has no recorded reading history for a thread holding three messages from others
- **THEN** the unread count is three

#### Scenario: Empty thread

- **WHEN** the thread holds no messages
- **THEN** the unread count is zero

### Requirement: Unread survives a reload on every surface

Every surface that displays an unread indicator SHALL record the viewer's reading history in
device-local storage when the viewer reads a thread, and SHALL restore it when the surface is
loaded again. This covers the participant chat section, the staff console thread list, and the
creator run-console thread list alike.

Reloading a surface SHALL NOT change the unread count when no new message arrived in the meantime.

When device-local storage is unavailable, the system SHALL degrade to treating the thread as
unread rather than failing.

#### Scenario: HQ reloads the console after reading a thread

- **WHEN** an HQ operator opens a team's thread, reads it, and then reloads the console
- **THEN** that thread is not shown as unread

#### Scenario: HQ's own reply does not re-flag a thread after a reload

- **WHEN** an HQ operator replies to a team, and then reloads the console before the team answers
- **THEN** that thread is not shown as unread

#### Scenario: A message that arrived during the reload is unread

- **WHEN** a team sends a message while the HQ console is being reloaded
- **THEN** that thread is shown as unread after the reload

#### Scenario: Storage is unavailable

- **WHEN** device-local storage cannot be read or written
- **THEN** the unread indicator still renders and the thread is treated as unread

### Requirement: Unread does not depend on message timestamps

The unread decision SHALL be derived from the thread's stored message order and message identity,
and SHALL NOT compare message timestamps against a stored time.

Messages sharing an identical timestamp, or carrying timestamps that do not increase along the
thread, SHALL NOT change the unread count.

#### Scenario: Messages share one timestamp

- **WHEN** three consecutive messages carry the same timestamp and the viewer's reading history names the middle one
- **THEN** the unread count is one

#### Scenario: Timestamps go backwards

- **WHEN** the messages after the viewer's reading history carry timestamps earlier than the message named by that history
- **THEN** those messages are still counted as unread

### Requirement: Unread is correct after history is trimmed

The system SHALL treat every retained message as newer than the viewer's reading history when the
message that history names is no longer present. The thread keeps only its most recent messages,
dropping the oldest when the history cap is reached, so an absent anchor means the viewer has
missed at least the whole retained window.

#### Scenario: The viewer's anchor has been dropped

- **WHEN** the thread has been trimmed so the message named by the viewer's reading history is gone
- **THEN** every retained message the viewer did not write is counted as unread

#### Scenario: A trimmed thread still reports new activity

- **WHEN** the thread is at its cap and a new message arrives, dropping the oldest
- **THEN** the unread count reflects the new message rather than staying at zero

### Requirement: Existing reading history is honored

The system SHALL honor reading history recorded by an earlier version of the participant app, which
stored only how many messages had been seen, so that upgrading does not make an already-read thread
appear unread.

A recorded count larger than the number of messages present SHALL yield zero unread, never a
negative count.

#### Scenario: Upgrade from a count-only history

- **WHEN** a device holds a count-only reading history equal to the number of messages in the thread
- **THEN** the unread count is zero

#### Scenario: Count-only history with new messages

- **WHEN** a device holds a count-only reading history of two and the thread now holds four messages from others
- **THEN** the unread count is two

#### Scenario: Count larger than the thread

- **WHEN** the recorded count exceeds the number of retained messages
- **THEN** the unread count is zero

### Requirement: Each device tracks its own reading

Reading history SHALL be recorded per device and per thread. A thread read on one device attached to
a team SHALL NOT be marked read on another device attached to the same team.

A message written by one device of a team SHALL count as unread on the team's other devices, and
SHALL NOT count as unread on the device that wrote it.

#### Scenario: A teammate's message on a second device

- **WHEN** one device of a team sends a message
- **THEN** the team's other devices count it as unread and the sending device does not
