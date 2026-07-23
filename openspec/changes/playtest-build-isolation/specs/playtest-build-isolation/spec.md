## ADDED Requirements

### Requirement: The verification gate and the live playtest never write the same directory
A production build produced by the verification gate SHALL be written to an output directory that is
disjoint from the output directory the live playtest serves. The playtest build SHALL write to
`dist-playtest` and the gate build SHALL write to `dist`, for both `apps/creator-web` and
`apps/play-web`.

The playtest preview servers SHALL serve the playtest output directory, and SHALL name that
directory explicitly in the command that starts them rather than relying on a mode-dependent
configuration default.

The gate SHALL be unchanged in what it proves: `creator:build` and `play:build` SHALL still produce a
real production build, the bundle budget SHALL still measure the `apps/play-web` gate output, and the
default developer flow (no playtest mode) SHALL still build to `dist` and serve the creator console
at the site root.

#### Scenario: A gate build cannot clobber the live artifact
- **WHEN** the verification gate builds both apps while the playtest is serving its own build
- **THEN** the gate writes only to the `dist` directories
- **AND** the directories the playtest previews serve are untouched

#### Scenario: The playtest build targets its own directory
- **WHEN** the apps are built in playtest mode
- **THEN** the output is written to `dist-playtest` for both apps
- **AND** the `dist` directories are untouched

#### Scenario: The default developer flow is unchanged
- **WHEN** an app is built without playtest mode
- **THEN** the output directory is `dist` and the asset base is the site root

### Requirement: A built artifact's asset base matches the path it is served from
The platform SHALL provide a pure check that, given a built `index.html` and the base that artifact
is intended to be served from, reports whether the artifact's asset references match that base.

Every root-absolute `src` or `href` on a `<script>` or `<link>` element SHALL be required to begin
with the intended base. References that are not root-absolute, including absolute `http`/`https`
URLs and protocol-relative URLs, SHALL be ignored, because they are hand-authored and are not
rewritten by the build.

An artifact carrying no root-absolute asset references at all SHALL be reported as a failure, so an
empty, truncated or placeholder document cannot satisfy the check vacuously.

An artifact whose intended base is the site root SHALL be reported as a failure if it carries a
reference beginning with a reserved reverse-proxy prefix, since that indicates a playtest build was
written into a directory that is not served under that prefix.

The check SHALL be a pure function of the supplied document text and the intended base. It SHALL NOT
read the filesystem, run a build, or consult the network.

#### Scenario: A creator build served under the proxy prefix is accepted
- **WHEN** an artifact whose asset references all begin with the reserved proxy prefix is checked
  against that prefix as its intended base
- **THEN** the check reports no problems

#### Scenario: A root-base creator build served under the proxy prefix is rejected
- **WHEN** an artifact whose asset references begin at the site root is checked against the reserved
  proxy prefix as its intended base
- **THEN** the check reports a wrong-base problem naming the offending reference

#### Scenario: A playtest build written into a gate directory is rejected
- **WHEN** an artifact whose asset references begin with the reserved proxy prefix is checked
  against the site root as its intended base
- **THEN** the check reports a problem

#### Scenario: An empty document cannot pass
- **WHEN** a document carrying no root-absolute asset references is checked against any base
- **THEN** the check reports a problem

#### Scenario: External and protocol-relative references are ignored
- **WHEN** an otherwise correct artifact also carries absolute `https` and protocol-relative
  references
- **THEN** the check reports no problems

### Requirement: The playtest serving wiring is asserted, not assumed
The platform SHALL provide a pure check over the repository's declared scripts that fails when the
playtest and gate build wiring drift.

The check SHALL require that the gate build scripts for both apps carry no playtest mode, that the
playtest build script builds both apps in playtest mode, and that both playtest preview scripts serve
the playtest output directory explicitly. The check SHALL fail if any playtest preview script serves
the gate output directory.

The expected wiring SHALL be declared in the check rather than inferred from the scripts it
validates.

#### Scenario: The real repository wiring is asserted
- **WHEN** the check runs against the repository's own script map
- **THEN** it reports no problems

#### Scenario: A gate build that acquired playtest mode is rejected
- **WHEN** a gate build script is given playtest mode
- **THEN** the check reports a problem naming that script

#### Scenario: A playtest preview re-pointed at the gate directory is rejected
- **WHEN** a playtest preview script serves the gate output directory instead of the playtest one
- **THEN** the check reports a problem naming that script

### Requirement: A wrong-base build fails a gate rather than a participant
The verification gate SHALL apply the built-artifact base check to every built output directory
present on disk after the builds have run.

An output directory that has not been built SHALL be skipped rather than reported as a failure, so a
fresh checkout does not fail the gate.

#### Scenario: A mismatched build fails the gate
- **WHEN** the gate runs and a built artifact's asset base does not match the base its directory is
  served from
- **THEN** the gate fails and names the artifact, the expected base and the offending reference

#### Scenario: An unbuilt directory is skipped
- **WHEN** the gate runs in a checkout where an output directory does not exist
- **THEN** that directory is skipped and the gate does not fail because of it
