## 1. RED

- [x] 1.1 `scripts/test-hebrew-voice.ts`: render both Hebrew dictionaries, flag 4+ word strings with a masculine-singular imperative or a singular second-person form; declared exceptions with reasons; fail on a stale exception; print how many strings were examined. Run it and watch it fail (68 hits in 1,458 sentences; 57 rewritten, 6 declared as other grammar, and "עבור"/"מלא" dropped from the verb list as they are almost always a preposition and an adjective).

## 2. GREEN

- [x] 2.1 Rewrite each flagged Hebrew sentence in the plural (or impersonally), keeping meaning and length.
- [x] 2.2 Declare the false positives with reasons.

## 3. Verify

- [x] 3.1 Browser: the landing, sign in, dashboard, trash and settings read in one voice.
- [x] 3.2 Gates: `npm run verify` green, `npm run i18n:check:strict` clean.
