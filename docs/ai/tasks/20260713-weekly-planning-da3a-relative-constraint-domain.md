# DA3a: relative constraint domain

Status: **queued — DA2 after**
Priority: Medium
Parent: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
Requirement IDs: DA-RELATIVE-001
Traceability: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
Dependencies: DA2 → DA3a

## Scope / entry / exit

「授業後に移動10分」「バイト後に帰宅して夕食」をtyped domainへ下ろし、resolverがabsolute busy intervalへ展開する。現行life constraint adapter、busy interval、schedulerを再調査する。

EntryはDA2 request/snapshot contract完了。Exitはpublic anchor、revision、bounds、self/cycle、ambiguous anchor、deterministic resolutionがunit/property/integration testsで固定されること。

~~~ts
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
~~~

anchorはauthorized public fact、source non-empty、revision一致とする。offset/durationはfinite/range内。candidate→validate→resolve→schedulerの順を守る。unknown/private/stale anchor、NaN/Infinity、負/過大値、self/cycle、ambiguous anchorはreject/clarificationでpartial applyしない。existing plans/timetableとのconflictはdeterministic diagnosticとする。

ConcurrencyはDA2 token、session-local。source/titleはuntrusted JSON。AI placement、complex recurrence、save、UI、migration、scheduler全面改修はnon-goalである。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Regression only | DA2 | async relation request |
| P2 | Regression only | DA2 | IME/keyboard/focus |
| P3 | Applicable | DA3a | hostile anchor/bounds/graph |
| P4 | Covered by another task | approval | stale/save |
| P5 | Not applicable | future persistence | no migration |
| P6 | Applicable | DA3a、DA2 | fallback/exam |
| P7 | Applicable | DA3a | anchor/source/revision trace |

## Acceptance / tests / commands

unitはtype/resolver/validator、contractはpublic anchor/revision、integrationはexisting scheduleとWP-DA turn 2、propertyはno-cycle/self/bounds。roleplayはWP-DA turns 2、10、P3-STALE-REF-001、P6-PLANNER-FAILURE-001。real-modelはfixture replayのみ。absolute intervalとdiagnosticがdeterministicでAIがplacementを決めないこと。既存scripts、diff check、status、Git write禁止。
