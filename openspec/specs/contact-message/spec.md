# contact-message Specification

## Purpose
The one channel a person with no account has for reaching the product's owner: a contact
form on the marketing site, the endpoint behind it, and the owner's way of reading what
arrives. It is the only write endpoint a complete stranger can reach, so the properties that
make that safe are the substance of this capability.

## Requirements

### Requirement: A stranger can send a message without an account

The system SHALL accept a contact message from an unauthenticated caller, because the
sender is by definition someone who does not yet have an account.

The callable SHALL be listed in the declared public callable allowlist together with the
reason it is public, so that a callable losing its authentication assertion by accident
still fails the hardening check.

#### Scenario: An unauthenticated caller is accepted

- **WHEN** a caller with no authentication token submits a well formed contact message
- **THEN** the call succeeds and the message is stored

#### Scenario: Being public is declared, not inferred

- **WHEN** the callable surface is analysed for authentication markers
- **THEN** this callable is present in the declared public allowlist with a stated reason

### Requirement: A message is validated server side and bounded in size

The server SHALL validate every field of a submitted message and SHALL reject a message
that is malformed, rather than storing it and repairing it later.

A message SHALL declare a sender name, a contact address, and a body. Each field SHALL be
bounded in length. A message exceeding a bound, missing a required field, or carrying a
field of the wrong type SHALL be rejected with an invalid argument error.

The transport encodes an absent optional value as null, so a server guard SHALL treat null
and absent identically wherever the field is optional, and SHALL NOT reject a caller for
omitting an optional field.

#### Scenario: An oversized body is rejected

- **WHEN** a message is submitted whose body exceeds the declared bound
- **THEN** the call fails with an invalid argument error and nothing is stored

#### Scenario: A missing required field is rejected

- **WHEN** a message is submitted without a body
- **THEN** the call fails with an invalid argument error and nothing is stored

#### Scenario: A wrongly typed field is rejected

- **WHEN** a message is submitted whose sender name is not a string
- **THEN** the call fails with an invalid argument error and nothing is stored

#### Scenario: Omitting an optional field is accepted

- **WHEN** a message is submitted with an optional field absent, and again with it explicitly null
- **THEN** both calls succeed and are treated identically

### Requirement: The endpoint is rate limited against abuse

Because the endpoint is unauthenticated and writes durable data, it SHALL be rate limited.
A caller exceeding the limit SHALL be refused with a resource exhausted error, and the
refused message SHALL NOT be stored.

Refusal SHALL NOT depend on the caller's own clock, and SHALL NOT be defeated by omitting
or forging a client supplied identifier.

#### Scenario: Excess submissions are refused

- **WHEN** a caller submits more messages in the window than the limit allows
- **THEN** the excess calls fail with a resource exhausted error and store nothing

#### Scenario: The limit does not rely on the caller

- **WHEN** a caller submits without a client supplied identifier, or with a forged one
- **THEN** the limit is still enforced

### Requirement: A rejected message does not consume the sender's allowance

The budget that governs how many messages a sender may STORE SHALL be charged only after a
submission has passed validation.

A sender who is refused for a malformed field SHALL still be able to submit a corrected
message immediately. A person mistyping their own contact address must not thereby lose
access to the only channel they have, for a cost nobody told them they were paying.

Calls SHALL still be bounded regardless of their outcome, so that a flood of malformed
submissions is refused rather than served indefinitely. That bound SHALL be wide enough
that no plausible sequence of human corrections reaches it.

#### Scenario: A correction after several mistakes is accepted

- **WHEN** a sender is rejected for invalid fields several times, up to the number of stored messages the tight budget allows
- **AND** then submits a well formed message
- **THEN** the message is accepted

#### Scenario: A flood of malformed submissions is still bounded

- **WHEN** a caller submits far more calls in the window than any person would
- **THEN** the calls are eventually refused, whether or not they were well formed

### Requirement: Stored messages are server write only and readable only by the owner

A contact message SHALL be written only by the server. Client writes to the message
collection SHALL be denied by rules.

A contact message SHALL NOT be readable by any client. It SHALL be readable by the product
owner through an authenticated, owner restricted path.

A stored message SHALL record when it arrived, so that ordering and retention do not
depend on a value the sender supplied.

#### Scenario: A client cannot write a message directly

- **WHEN** a client attempts to write to the contact message collection
- **THEN** the write is denied by rules

#### Scenario: A client cannot read messages

- **WHEN** any client, authenticated or not, attempts to read the contact message collection
- **THEN** the read is denied by rules

#### Scenario: Arrival time is recorded by the server

- **WHEN** a message is stored
- **THEN** it carries a server assigned arrival time, regardless of any timestamp the sender supplied

### Requirement: The sender learns the outcome and the content is never echoed as markup

A caller SHALL receive a definite outcome: accepted, rejected as invalid, or refused as
rate limited. The response SHALL NOT reveal internal identifiers or storage locations.

Message content SHALL be treated as data wherever it is later displayed, and SHALL NOT be
rendered as markup.

#### Scenario: A successful submission reports success without internals

- **WHEN** a valid message is accepted
- **THEN** the response reports success and contains no document identifier or storage path

#### Scenario: Content is not rendered as markup

- **WHEN** a message whose body contains markup is displayed to the owner
- **THEN** the markup is shown as text and is not interpreted
