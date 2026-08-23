# Design — emulator-port-offset

## 1. The ports that actually have to move (audited)

`firebase.json` declares five, but the CLI starts more than five. From the pinned
firebase-tools@15.18.0 (`lib/emulator/constants.js` `DEFAULT_PORTS`, `lib/emulator/controller.js:263`):

| Emulator | Default | Declared in `firebase.json`? | `portFixed`? |
|---|---|---|---|
| ui | 4000 | yes | auto-finds a free port |
| hub | 4400 | **no** | auto-finds |
| logging | 4500 | **no** | auto-finds |
| functions | 5001 | yes | **fixed — hard failure if taken** |
| hosting | 5002 | yes (not started by `--only`) | auto-finds |
| firestore | 8080 | yes | **fixed** |
| firestore.websocket | 9150 | **no** | auto-finds |
| auth | 9099 | yes | **fixed** |
| storage | 9199 | yes | **fixed** |

The four `portFixed` ones are the ones that make `emulators:exec` die outright against a live
playtest. The auto-finding ones (ui/hub/logging/websocket) would silently drift instead — which is
worse, not better: the Emulator UI would appear on an unpredictable port and the hub would answer
for the *other* stack's session. So the resolver covers **all nine**, and the generated config pins
every one of them. `hosting` is included for completeness even though `--only
firestore,auth,functions,storage` never starts it, so that a future `--only hosting` cannot
reintroduce the bug.

`pubsub` (8085), `database` (9000), `eventarc` (9299), `dataconnect` (9399), `tasks` (9499) are not
configured, not started by any gate, and are deliberately left out.

## 2. Why the offset is snapped to a multiple of 1000

The naive design ("shift everything by N") has a silent failure mode: a shifted port can land on a
**different** service's port in the still-running default block. Concretely, with `N = 1019`:

```
firestore 8080 + 1019 = 9099   ← the LIVE playtest stack's Auth emulator
```

`emulators:exec` would then either fail with a confusing bind error or, worse, the gate's Firestore
traffic would be pointed at a port the live Auth emulator owns.

Pairwise differences between the nine default ports, exhaustively:

```
400 500 1001 1002 4080 5099 5150 5199
100 601 602 3680 4699 4750 4799
501 502 3580 4599 4650 4699
1 3079 4098 4149 4198
3078 4097 4148 4197
1019 1070 1119
51 100
49
```

**None is a multiple of 1000.** Therefore any offset that is a positive multiple of 1000 makes the
shifted set provably disjoint from the default set. The resolver snaps up
(`Math.ceil(n / 1000) * 1000`), never down, so the operator always gets *at least* the separation
they asked for.

A second, free property falls out: a multiple-of-1000 shift preserves the last three digits of every
port, so the shifted set is `{…000, …400, …500, …001, …002, …080, …150, …099, …199}` — which can
never collide with the dev servers on **5180 / 5181** or the tunnel proxy on **3000** either. The
test asserts this invariant directly rather than trusting the arithmetic.

Bounds: `MIN_OFFSET = 1000`; `MAX_OFFSET = 56000`, i.e. `floor((65535 − 9199) / 1000) * 1000`, the
largest multiple of 1000 that keeps the highest port (storage, 9199) inside the legal range. The
lowest port (ui, 4000) is already above 1024 and only moves up, so the low bound needs no clamp —
it is asserted anyway, because a future base-port edit could invalidate that reasoning.

## 3. Why a generated config file, not CLI flags

Investigated in the pinned CLI. `lib/commands/emulators-exec.js` registers exactly five options:
`--only`, `--inspect-functions`, `--import`, `--export-on-exit`, `--log-verbosity`, `--ui`. **There
is no per-emulator port flag** — not on `emulators:exec`, not on `emulators:start`. `--test-config`
exists but is documented as Firestore/RTDB-only and is an extensions-testing affordance, not a port
mechanism. The ports come from `firebase.json` and nowhere else.

So the only route is to hand the CLI a different config. Two constraints decided *where*:

1. `lib/detectProjectRoot.js` returns `dirname(resolve(cwd, options.configPath))`. Every relative
   path inside the config (`functions.source: "functions"`, `firestore.rules`, `storage.rules`,
   `firestore.indexes.json`) is resolved against that directory. A config written to `.firebase/`
   would silently resolve `functions` to `.firebase/functions` and fail.
2. Mutating `firebase.json` in place is unacceptable — it is committed, and a crashed gate would
   leave the repo's real config rewritten.

⇒ **write a sibling file in the repo root**: `firebase.emulator-offset.json`, generated from
`firebase.json` on every offset run, gitignored, and pointed at with the global `--config` flag.
There is direct precedent: `scripts/hosting-mode.mjs` already generates root-level
`firebase.tunnel.json` for the same reason, and `.gitignore` already lists it.

**Offset 0 does not generate anything and does not pass `--config`.** The spawned command line is
character-identical to today's. That is the strongest possible guarantee that CI is unaffected — the
no-op is structural, not a value that happens to be equal.

## 4. Invalid input policy — total, never throwing

`resolveEmulatorPortOffset` is called at the top of every gate script, before any emulator exists.
Throwing there would turn a typo in an env var into an unexplained gate crash. So it is total:

| Input | Result | Notice |
|---|---|---|
| absent / `''` / whitespace | 0 | none (this is the normal case) |
| `'0'` | 0 | none |
| `'abc'`, `'1e3'`… non-integer text, `NaN`, `Infinity` | 0 | `invalid` |
| negative | 0 | `negative` |
| `1 … 999` | 1000 | `snapped` |
| a multiple of 1000 in range | as given | none |
| any other in-range positive | next multiple of 1000 | `snapped` |
| `> 56000` | 56000 | `clamped` |

Falling back to **0** (rather than to some arbitrary offset) on garbage is the fail-safe direction
for a *gate*: at worst the gate refuses to start because the live stack holds the ports, which is
loud. Silently choosing an unrequested offset would be quiet and confusing. The notice is printed by
`emulator-exec.mjs` so an operator whose typo was ignored finds out immediately.

`'1e3'` is deliberately rejected rather than read as 1000: `Number('1e3')` is 1000, but accepting
exponent/decimal/hex text widens the accepted surface for no operator benefit. The rule is "an
integer written as digits, with an optional sign".

## 5. Consistency across the exec boundary

`emulators:exec` spawns the wrapped gate script as a child that inherits the wrapper's environment,
so `RUSHPOINT_EMULATOR_PORT_OFFSET` reaches `e2e-verify.mjs` and friends, and they resolve the same
ports from the same module. Nothing is passed on the command line, so `package.json` scripts and the
`npm run e2e` shorthand keep working verbatim.

The CLI additionally exports `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` /
`FIREBASE_STORAGE_EMULATOR_HOST` into the exec'd child with the ports it actually bound. The gate
scripts keep their existing `??=` idiom, so the CLI's values win where present and the resolver only
fills the gap (which is what makes `node scripts/e2e-verify.mjs` work standalone against an
already-running offset stack too).

## 6. The reaper stays exactly as it is — verified, not assumed

`scripts/lib/emulatorReap.mjs` was read end to end. Its verdict function
`planEmulatorExecReap` branches on: protected pid sets, `classifyProcessRole` (substring match on
the command line), `resolveLineage` (ppid chain + recorded exec sessions), `startedAt` age. **No
branch reads a port.** The string `8080/9099/5001/4000` appears once, in the file's header comment
explaining the symptom. `scripts/test-emulator-reap.ts` fixtures carry a `ports` field, but the
planner never reads it.

Consequence: an offset exec session is reaped by the identical rule as a default one — lineage
attribution to a *finished* session of *this* repo — and a live playtest stack on the default block
is kept by the `live-emulator-session` branch regardless of which ports anything holds. Making the
reaper port-aware would be a strict regression: it would introduce a way for a port coincidence to
authorise a kill. Left alone on purpose.

## 7. Test strategy

`scripts/test-emulator-ports.ts` (auto-discovered by `scripts/run-unit-tests.mjs`, so it enters
`npm test` with no registration):

- **the no-op pin** — the resolved map for an empty env, `{}`, `{VAR: ''}`, `{VAR: '0'}` and a
  garbage value equals a literal frozen table of today's nine ports written out by hand. Written as
  literals on purpose: a regression in `BASE_EMULATOR_PORTS` cannot hide behind the test importing
  the same constant.
- shifting — every port moves by exactly the resolved offset, for several offsets.
- adversarial input — `undefined`, `null`, `''`, `'   '`, `'abc'`, `'NaN'`, `'Infinity'`, `'-5'`,
  `'1e3'`, `'12.5'`, `'0x10'`, `'999999999'`, a number, an object — none throws, all yield finite
  integer ports in 1024..65535.
- no two resolved ports collide, at every offset tested.
- the shifted set is disjoint from the default set and from `{3000, 5180, 5181}`.
- `buildOffsetFirebaseConfig` does not mutate its input, writes all nine ports, and preserves the
  non-emulator sections (`functions.source`, rules paths, hosting targets) untouched.
- `resolveEmulatorHostEnv` returns `host:port` strings matching the resolved map.

No test in this change boots, contacts or enumerates anything. The module has no I/O to mock.
