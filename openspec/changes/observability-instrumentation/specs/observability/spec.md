# Observability

## ADDED Requirements

### Requirement: Every callable emits a structured entry/exit log
Every v2 Cloud Function callable SHALL route its body through a shared `logCall` helper that emits
exactly one structured log record per invocation: `info` (`callable.ok`) on success, `warn`
(`callable.error`, with `errorCode`) when an `HttpsError` is thrown, and `error` (`callable.crash`)
on an unexpected throw. The record SHALL carry stable identifiers only — `callable` name, `uid`,
and (where applicable) `runId`/`gameId` — as structured fields, never string-concatenated. `logCall`
SHALL re-throw the original error after logging it (it changes visibility, not control flow).

#### Scenario: Successful callable logs one info record
- **WHEN** a wrapped callable completes successfully
- **THEN** exactly one `info` record `callable.ok` is emitted carrying `callable` and `uid`
- **AND** the callable's return value is unchanged

#### Scenario: A thrown HttpsError logs a warn and re-throws
- **WHEN** a wrapped callable throws an `HttpsError` (an error carrying a `.code`)
- **THEN** exactly one `warn` record `callable.error` is emitted carrying that `errorCode`
- **AND** the same error propagates to the client unchanged

#### Scenario: An unexpected throw logs an error and re-throws
- **WHEN** a wrapped callable throws a non-`HttpsError`
- **THEN** exactly one `error` record `callable.crash` is emitted
- **AND** the error propagates unchanged

### Requirement: Logs never contain secrets or PII
The logging helpers SHALL accept only stable identifiers and sizes; answer keys, PINs, access codes,
photo bytes, participant display names, and full registration payloads MUST NOT appear in any log
record. Redaction is structural — the helper's typed input makes passing a secret field impossible.

#### Scenario: Secret-bearing context is redacted
- **WHEN** a caller passes a context object containing a `displayName` or `answer` field to a log helper
- **THEN** the emitted record does not contain that field's value

### Requirement: Best-effort failures are logged, not silently swallowed
Best-effort (non-fatal) side effects SHALL log their failures instead of silently swallowing them:
every site that previously used `.catch(() => undefined)` / `.catch(() => null)` routes its error
through `logBestEffort`, which emits a `warn`
record and never throws. The operation remains non-fatal — the outer callable still succeeds.

#### Scenario: A failed best-effort side effect is visible but non-fatal
- **WHEN** a best-effort side effect (e.g. a `publicGames` denormalization update) fails
- **THEN** a `warn` record is emitted identifying the operation
- **AND** the enclosing callable still resolves successfully
