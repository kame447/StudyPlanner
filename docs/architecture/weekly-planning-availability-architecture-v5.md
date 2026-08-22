# weeklyPlanning availability / commitment architecture v5

Status: canonical subordinate contract
Updated: 2026-08-22

Parent: [weekly-planning-dialogue-architecture-v5.md](weekly-planning-dialogue-architecture-v5.md)
Semantic schema: [weekly-planning-semantic-schema-v5.md](weekly-planning-semantic-schema-v5.md)
Current contract: [weekly-planning-current-contract-v5.md](../ai/weekly-planning-current-contract-v5.md)

## Responsibility

Availability is a deterministic scheduling boundary after user meaning has been represented.

```text
accepted Fact Graph
├─ schedulable work
│  ├─ task / component
│  ├─ remaining workload
│  └─ effort
├─ task-specific temporal constraints
├─ user-declared plan-wide availability
└─ authoritative occupied sources
   ├─ existing StudyPlanner plans
   └─ timetable
→ resolved availability
→ scheduler
```

## Rules

- workload is work demand, not availability.
- task temporal constraints are separate from plan-wide availability.
- user language such as unavailable / preferred periods is interpreted semantically by AI, then calendar arithmetic is deterministic.
- existing plan IDs, timetable records, owner identity and concrete intervals are authoritative application data; AI does not invent or reinterpret them.
- scheduler never creates free time by ignoring a hard occupied interval.
- buffer / travel / life constraints must use their owning typed policy rather than ad-hoc text matching.
- source failure must not be treated as an empty-success source when that source is required for safe scheduling.

## External calendars

Google / Apple / Outlook calendar integration is not a current Stable V5 production source. The old production-adapter task is deferred under `docs/ai/tasks/superseded/20260731-weekly-planning-external-source-production-adapter.md`.

If an external source is added later, define auth, pagination, atomic loading, privacy, retry and provenance contracts before connecting it to scheduler input. Do not pass arbitrary external event prose to the semantic model as trusted instruction.
