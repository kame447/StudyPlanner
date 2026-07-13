# DA3c: mentor conversation evaluation

Status: **queued — DA3b after**
Priority: Medium
Parent: ../../architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-EVAL-001, DA-GOAL-001, DA-FALLBACK-001, DA-TRACE-001
Dependencies: DA3b

## Scope / evaluation path

WP-DA-001、WP-RP-001、P1〜P7をstrict contract、mentor rubric、metricsで再現可能に評価する。golden textではなくaction/state/fact/ref/side-effectをstrict、自然文をrubricにする。existing fixture/runnerを再調査しproduction codeを評価都合で変えない。

strict fields: conversation/turn/request/revision、action、factRefs、public field、question/option、proposal lifecycle、correction atomicity、preview/stale、approval item、fallback category、call count、duplicate、accepted/rejected、diagnostics。rubric: 敬体、簡潔、no re-ask、仮定/事実、内部slot非表示、根拠なし値なし、次入力、mentor option、入力無視なし。

metrics: opening/normal call budget、p50/p95 latency、provider/planner failure、reject、stale discard、fallback category、no-reask、preview completion、approval duplicate suppression、partial retry completion。fixtureはfixed clock/selected date/IDs、redacted JSON、raw prompt/secret/private IDなし。staleはfallbackでなくdiscard。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Regression only | DA2 | submit/request lifecycle |
| P2 | Covered by another task | DA2 | IME/keyboard |
| P3 | Applicable | DA3c/DA1 | hostile boundary |
| P4 | Applicable | DA3c/approval | stale/save |
| P5 | Applicable | DA3c/approval/DA2 |
| P6 | Applicable | DA3c/DA0/DA2 | fallback/exam |
| P7 | Applicable | DA3c | ref/revision trace |



## Acceptance / tests / commands

unit schema/redaction/metric aggregation、contract all v4 IDs、integration full roleplay and failures、property wording-stable scoring/no hidden mutation/duplicate-stale invariants、roleplay P1〜P7。real modelは許可済みredacted corpus/fixed budget/low temperatureの別評価で、deterministic unit gateではない。existing fixture/test/build/lint、diff check、docs-only status、Git write禁止。
