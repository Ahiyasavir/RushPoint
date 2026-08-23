## ADDED Requirements

### Requirement: Staff can send a team directly to a specific task
An authorized staffer SHALL be able to assign a team to a specific task within that team's current
active stage, instead of only the system's smart-routing pick.

#### Scenario: Staff force-assigns an eligible task
- **WHEN** an authorized staffer force-assigns a team to an unassigned, eligible task within that
  team's current active stage, and the task has an open station slot
- **THEN** the team is assigned that task directly, a station slot is claimed for it, and the
  action is recorded in the audit log

#### Scenario: Force-assign never exceeds a station's capacity
- **WHEN** a staffer force-assigns a team to a task whose station is already at its maximum
  concurrent-team capacity
- **THEN** the assignment is refused and no station slot is claimed, exactly as a normal
  system-routed assignment would refuse

#### Scenario: Force-assign is confined to the team's current active stage
- **WHEN** a staffer attempts to force-assign a team to a task outside that team's current active
  stage (a locked future stage, an already-completed stage, or a task not in the team's game)
- **THEN** the assignment is refused

#### Scenario: Force-assigning displaces the team's current in-flight task
- **WHEN** a staffer force-assigns a team that currently holds a different in-flight task in the
  same stage
- **THEN** the previous task is released (freeing its station slot) before the new one is claimed,
  and the team never appears to occupy two stations at once

#### Scenario: Force-assigning a team's own current task is a no-op refusal
- **WHEN** a staffer force-assigns a team to the task it is already assigned
- **THEN** the call is refused without releasing or re-claiming any station slot

### Requirement: Staff can deliberately override a sequencing gate, with a visible trail
An authorized staffer SHALL be able to explicitly bypass a task's unlock, scheduled-release, or
expiry gate for one team, distinctly from an ordinary eligible force-assign.

#### Scenario: Override bypasses a sequencing gate for one team
- **WHEN** a staffer force-assigns a team to a task that is locked, not yet released, or expired,
  with the override explicitly requested
- **THEN** the assignment succeeds for that one team only, and the audit log records that this was
  an override, distinguishable from a normal force-assign

#### Scenario: Override still cannot exceed station capacity
- **WHEN** an override force-assign targets a task whose station is at capacity
- **THEN** the assignment is still refused — override affects only sequencing gates, never the
  physical station-capacity limit

#### Scenario: Override is not used unless explicitly requested
- **WHEN** a staffer force-assigns a team without explicitly requesting an override
- **THEN** a locked, not-yet-released, or expired task is refused exactly like a normal force-assign

### Requirement: The affected team is told why its task changed
A team that has been force-assigned SHALL receive a visible indication that staff redirected them,
not a silent task swap.

#### Scenario: Team sees a notice after being redirected
- **WHEN** a team is force-assigned to a new task
- **THEN** the participant app surfaces a notice that staff sent them to this task, distinguishable
  from the ordinary "next task" flow
