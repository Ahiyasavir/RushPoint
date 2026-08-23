## ADDED Requirements

### Requirement: The Run Console resolves a missing or unreadable run instead of spinning forever
The Run Console SHALL give its run-document listener an error path and a not-found branch so a run
that cannot be resolved escapes the loading spinner into a clear, exit-able state. When the run
document reports that it does not exist, or the listener errors (a purged run, a soft-deleted game, a
mistyped id, or a permission failure), the console SHALL render a not-found card with a message that
the run could not be loaded and a control that returns the operator to the Runs list, rather than an
indefinite "loading run" spinner.

The not-found state SHALL only be entered after a snapshot actually reports a non-existent document or
the listener actually errors — never during the normal interval before the first snapshot arrives — so
a run that is still loading is not misreported as missing. A subsequent snapshot that delivers the
existing run SHALL clear the not-found/error state and render the live console. The happy-path loading
spinner and the live console rendering SHALL be otherwise unchanged.

This requirement SHALL apply only to the run-document listener and SHALL NOT alter the separately
hardened teams poll or alerts stream.

#### Scenario: A run that does not resolve shows a not-found card with an exit
- **WHEN** the run document reports it does not exist, or the run-doc listener errors
- **THEN** the console shows a not-found card explaining the run could not be loaded
- **AND** the card offers a control that returns the operator to the Runs list
- **AND** no permanent loading spinner is shown

#### Scenario: A run still loading is not misreported as missing
- **WHEN** the console mounts and the first run-doc snapshot has not yet arrived
- **THEN** the existing loading spinner is shown
- **AND** the not-found card is NOT shown until a snapshot reports a non-existent document or the
  listener errors

#### Scenario: A recovered run clears the not-found state
- **WHEN** the run-doc listener later delivers the existing run after an error or transient blip
- **THEN** the not-found/error state is cleared and the live console renders normally
