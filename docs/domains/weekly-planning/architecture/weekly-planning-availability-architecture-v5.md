# weeklyPlanning availability / commitment architecture v5

Status: canonical subordinate contract
Updated: 2026-08-27

Parent: [weekly-planning-dialogue-architecture-v5.md](weekly-planning-dialogue-architecture-v5.md)
Semantic schema: [weekly-planning-semantic-schema-v5.md](weekly-planning-semantic-schema-v5.md)
Current contract: [current-contract-v5.md](current-contract-v5.md)
Scheduling policy: [../policies/scheduling.md](../policies/scheduling.md)
Semantic ownership: [weekly-planning-semantic-ownership-boundary-v5.md](weekly-planning-semantic-ownership-boundary-v5.md)

## Responsibility

Availability is a deterministic scheduling boundary after user meaning has been represented. It answers where candidate work may safely fit around occupied/unavailable time; it is not the owner of every temporal placement constraint.

Current scheduler input is conceptually compiled through separate typed paths:

```text
accepted Fact Graph
├─ schedulable work
├─ task/component temporal facts
│  → resolved temporal constraints
│  → hard date bounds / preferred placements
└─ availability / commitment inputs
   ├─ user-declared plan-wide availability
   ├─ accepted life / buffer constraints
   └─ authoritative occupied sources
      ├─ existing StudyPlanner plans
      └─ timetable
   → resolved availability

resolved work + resolved temporal placement constraints + resolved availability
→ scheduler
```

Availability answers where work may safely fit. Scheduler-facing temporal compilation answers which accepted date bounds/preferences apply to a work target and materializes those already interpreted meanings into absolute placement inputs. Neither layer decides what the user's raw language means, and neither may manufacture missing free time.

Do not route task/component deadline, earliest-start, latest-end or preferred-window meaning back through a second raw Fact Graph interpretation inside availability or downstream placement. Their current ownership is defined by [Semantic Ownership](weekly-planning-semantic-ownership-boundary-v5.md) and [Scheduling Policy](../policies/scheduling.md).

## Hard availability invariants

- workload is work demand, not availability.
- task temporal constraints are separate from plan-wide availability and from occupied-time resolution.
- user language such as unavailable/preferred periods is interpreted semantically by AI; calendar arithmetic is deterministic.
- existing plan IDs, timetable records, owner identity and concrete intervals are authoritative application data; AI does not invent or reinterpret them.
- scheduler never creates free time by ignoring a hard occupied interval.
- accepted unavailable interval, sleep/life constraint, travel/buffer or equivalent hard boundary must actually reduce or bound candidate availability across its represented date/recurrence scope.
- a required authoritative source that failed to load is not equivalent to an empty source.
- a known-but-unresolved required constraint is not interpreted as free capacity merely because its final interval is unavailable.
- preference, annotation, personalization score or renderer wording cannot widen hard availability.

## Request-time lower bound

For planning future work, the scheduler receives a request-time `notBefore` boundary. New planning blocks must not be placed before that boundary in the active horizon.

`selectedDate` and calendar navigation are display/planning context; they do not authorize creating a new future-plan block in already elapsed time.

Retrospective actual logging is a separate product operation and does not weaken this scheduling lower bound.

## Life constraints and study availability

Sleep end and study-available start are distinct concepts.

```text
sleep ends at 09:00
≠
study can necessarily start at 09:00
```

Breakfast, preparation, commuting, recovery or another accepted activity may move the earliest practical study time later. When this distinction matters to the plan, represent the usable start/buffer as typed state rather than assuming that the end of sleep creates free study capacity.

The application should not force the user to enumerate every micro-activity. Dialogue should obtain the smallest behaviorally useful boundary and pass an accepted typed result to availability resolution.

Historical parser-specific representations of this idea are not current semantic authority.

## Recurrence and scope

A recurring or date-less accepted life/availability constraint must be expanded over the planning dates defined by its typed scope. A dated exception applies only where represented.

Task/component temporal-placement recurrence and applicability are compiled by the scheduler-facing temporal-constraint boundary rather than being independently re-derived by availability. Shared recurrence utilities may be reused, but the same semantic decision must not gain two owners.

Knowing one dimension does not silently resolve another. For example:

- known sleep does not imply known meal/bath/travel state
- known timetable does not imply all other fixed plans have been loaded
- one available interval does not cancel a separate hard busy interval

Missing/unknown state should remain dimension-specific.

## Soft availability and preference

Soft preference may rank safe candidate slots, but it must not create a slot outside authoritative availability.

Examples:

- preferred evening may rank evening slots that are already feasible
- observed study tendency may rank safe slots
- `before_sleep` preference does not override sleep itself
- a life annotation does not increase free minutes

Scheduler-facing preferred placements are applied only within safe candidate space; they do not widen hard availability.

## Source integrity

A required source is resolved as one of at least:

```text
loaded successfully
loaded and empty
unavailable / failed
not requested / not authoritative for this plan
```

Do not collapse these states into a single empty list.

## External calendars

Google/Apple/Outlook calendar integration is not a current Stable V5 production source. The prior adapter work is archived as superseded work under `docs/archive/work/superseded/`.

If an external source is added later, define auth, pagination, atomic loading, privacy, retry and provenance before connecting it to scheduler input. Arbitrary external event prose must not become trusted model instruction.
