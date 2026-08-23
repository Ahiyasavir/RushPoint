# Tasks — playtest-build-isolation

## RED

- [x] 1. Write `scripts/test-build-artifact-guard.ts` against the not-yet-existing
      `scripts/lib/buildArtifactGuard.mjs`: `ARTIFACT_CONTRACT` shape and disjointness,
      `extractRootRefs` (script/link, attribute order, self-closing, single/double quotes,
      `https://` and `//` filtered out), `checkBuiltBase` for all four problem codes on both bases,
      the two real-shaped fixtures (creator playtest / play gate), and
      `checkPlaytestScriptWiring` on synthetic maps plus the repository's real `package.json`.
      Record the RED output verbatim.

## GREEN

- [x] 2. Create `scripts/lib/buildArtifactGuard.mjs`: `PLAYTEST_OUT_DIR`, `GATE_OUT_DIR`,
      `RESERVED_PROXY_PREFIXES`, `ARTIFACT_CONTRACT`, `extractRootRefs`, `checkBuiltBase`,
      `checkPlaytestScriptWiring`, `formatProblems`. Pure: no `fs`, no `child_process`, no network.
- [x] 3. `apps/creator-web/vite.config.ts` and `apps/play-web/vite.config.ts`:
      `build.outDir = mode === 'playtest' ? 'dist-playtest' : 'dist'`. `play-web`'s config becomes a
      `({ mode }) => ({…})` factory. Document the hazard in place.
- [x] 4. `package.json` scripts (surgical, the file is contended):
      `playtest:creator:preview` and `playtest:play:preview` gain `--outDir dist-playtest`
      (and play-web's preview gains `--mode playtest` to match its build); add
      `base:check` and append it to `verify`.
- [x] 5. `scripts/check-build-base.mjs`: walk `ARTIFACT_CONTRACT`, read each
      `apps/<app>/<outDir>/index.html` that exists, run `checkBuiltBase`, print a per-artifact
      verdict, exit non-zero on any problem. Skip missing directories.
- [x] 6. `scripts/playtest-forever.mjs`: `distReady()` probes `dist-playtest/index.html` for both
      apps, since that is what `playtest:prod` serves.
- [x] 7. `.gitignore`: ignore `apps/creator-web/dist-playtest/` and `apps/play-web/dist-playtest/`.
- [x] 8. Run the guard test green.

## DOCUMENT

- [x] 9. `CLAUDE.md`: new gotcha entry, "a gate build must never write the directory the live
      playtest serves", covering both the base clobber and the `isEmulatorBuild` clobber, plus the
      `base:check` gate in the required-gates list.
- [x] 10. `PLAYTEST.md`: a "Build isolation" section with the gate-build vs playtest-build command
      table and the recovery procedure.

## VERIFY (owner, not runnable here — a live playtest is on this machine)

- [ ] 11. `npm run verify` — must be green and must leave `apps/*/dist-playtest` untouched.
- [ ] 12. `npm run playtest:build` — must populate `apps/*/dist-playtest` and leave `apps/*/dist`
      untouched.
- [ ] 13. Restart the playtest stack, then confirm the creator console loads at
      `https://<tunnel>/creator` and a phone can still join, then run `npm run verify` again and
      confirm the creator console is still alive.
