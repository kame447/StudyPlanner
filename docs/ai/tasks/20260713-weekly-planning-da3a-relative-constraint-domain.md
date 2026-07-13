# DA3a: relative constraint domain

Status: **queued — DA2 after**
Priority: Medium
Parent: ../../architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-RELATIVE-001
Dependencies: DA2

## Scope / exact types / path

「授業後に移動10分」「バイト後に帰宅して夕食」をtyped domainへ下ろし、resolverがabsolute busy intervalへ展開する。現行life constraint adapter、busy interval、schedulerを再調査する。AI placement、cycle/self、complex recurrence、save、UI、migration、scheduler全面改修はnon-goal。

```ts
type RelativeRelationKind = "before" | "after" | "during_buffer";
type RelativeConstraint = {
  relationId: string;
  anchorFactRef: string;
  relation: RelativeRelationKind;
  offsetMinutes: number;
  durationMinutes?: number;
  sourceFactRefs: string[];
  stateRevision: number;
  confidence: Confidence;
};
type ResolvedRelativeConstraint = {
  relationId: string;
  anchorEventId: string;
  startTime: string;
  endTime: string;
  sourceFactRefs: string[];
  stateRevision: number;
};
```

anchorはauthorized public fact、source non-empty、revision一致。offset/durationはfinite/range内。candidate→validate→resolve→scheduler。unknown/private/stale anchor、NaN/Infinity、負/過大値、self/cycle、ambiguous anchorはreject/clarificationでpartial applyしない。existing plans/timetableとのconflictはdeterministic diagnostic。

ConcurrencyはDA2 token、session-local。source/titleはuntrusted JSON。## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Regression only | DA2 | async relation request |
| P2 | Covered by another task | DA2 | IME/keyboard |
| P3 | Applicable | DA3a | hostile boundary |
| P4 | Covered by another task | approval | stale/save |
| P5 | Not applicable | future persistence | no migration |
| P6 | Applicable | DA3a/DA2 | fallback/exam |
| P7 | Applicable | DA3a | ref/revision trace |



## Acceptance / tests / commands

unit type/resolver/validator、contract public anchor/revision、integration existing schedule、property graph no-cycle/self/bounds、roleplay WP-DA turn2/10、P3/P6。real model fixture replay only。absolute intervalとdiagnosticがdeterministicでAIがplacementを決めないこと。既存scripts、diff check、status、Git write禁止。
