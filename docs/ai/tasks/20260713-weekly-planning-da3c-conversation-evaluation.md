# DA3c: mentor conversation evaluation

Status: **queued — DA3b after**
Priority: Medium
Parent: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
Requirement IDs: DA-EVAL-001, DA-GOAL-001, DA-FALLBACK-001
Traceability: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
Dependencies: DA3b → DA3c

## Scope / entry / exit

WP-DA-001、WP-RP-001、P1〜P7、canonical Requirement ID tableをstrict contract、mentor rubric、metricsで再現可能に評価する。golden textではなくaction/state/fact/ref/side-effectをstrict、自然文をrubricにする。existing fixture/runnerを再調査し、production codeを評価都合で変えない。

EntryはDA3b feasibility contract完了。Exitは必須15 Requirement IDが各1行でowner/task/statusと同期し、全caseがstrict/rubric/forbidden resultを持ち、redacted replayとmetric集計が再現可能なこと。

strict fields:

- conversation、turn、request、revision。
- action、responseParts、usedFactRefs、usedQuestionTopicIds、usedOptionIds。
- public field、formatter、question、option。
- proposal draft/record/pending/lifecycle。
- decision/correction union、atomicity、independent envelopes。
- preview、StaleAsyncResult、StalePreviewApprovalAttempt、approval item。
- fallback category、call count、duplicate、accepted/rejected、diagnostics。

rubric:

- 敬体、簡潔、no re-ask。
- 仮定/事実の区別、内部slot非表示。
- 根拠なし値なし、次入力が明確。
- mentor option、入力無視なし。

## Free text safetyの品質評価

DA1初期契約ではAI free textに数値、日時、件数、task/event/material titleを許可しない。DA3cはこの制限が不自然な反復、接続不良、過度な定型感を生まないかをrubric/metricsで評価する。

緩和が必要でもDA3cでvalidatorを直接緩めない。redacted evidence、失敗case、必要な最小例外をまとめ、別taskでfield/formatter/deterministic phraseの拡張を優先する。

metricsはopening/normal call budget、p50/p95 latency、provider/planner failure、reject、stale discard、stale preview rejection、fallback category、no-reask、preview completion、approval duplicate suppression、partial retry completion、text validation reject rate、mentor rubricである。

fixtureはfixed clock/selected date/IDs、redacted JSON、raw prompt/secret/private IDなし。StaleAsyncResultはfallbackでなくdiscard、StalePreviewApprovalAttemptはdeterministic rejectionとして別計測する。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Applicable as full regression | DA3c、DA2 | opening/submit/reset/stale/retry結果 |
| P2 | Applicable as full regression | DA3c、DA2 | IME/keyboard/multiline/focus/Tab結果 |
| P3 | Applicable | DA3c、DA1、DA1b | hostile boundary全case |
| P4 | Applicable | DA3c、approval | stale preview/save/idempotency |
| P5 | Applicable | DA3c、approval、DA2 | ledger/session-local migration |
| P6 | Applicable | DA3c、DA0、DA2 | fallback/exam/range |
| P7 | Applicable | DA3c | 必須15 Requirement IDと全trace |

## Acceptance / tests / commands

unitはschema、redaction、metric aggregation、Requirement ID uniqueness/completeness。contractはroleplay tableの全v4 IDとstatus同期。integrationはfull roleplay、interpreter/planner/stale failures、approval。propertyはwording-stable scoring、no hidden mutation、duplicate/stale invariants。

P7-REQUIREMENT-MATRIX-001はDA-GOAL-001、DA-SAFE-001、DA-INTERPRET-001、DA-ACTION-001、DA-TURN-001、DA-ASSUMPTION-001、DA-CORRECTION-001、DA-RESPONSE-001、DA-PREVIEW-001、DA-RELATIVE-001、DA-FEASIBILITY-001、DA-PERSISTENCE-001、DA-IDEMPOTENCY-001、DA-FALLBACK-001、DA-EVAL-001が各一行であることを検証する。

real modelは許可済みredacted corpus、fixed budget、low temperatureの別評価で、deterministic unit gateではない。existing fixture/test/build/lint、diff check、docs-only status、Git write禁止。
