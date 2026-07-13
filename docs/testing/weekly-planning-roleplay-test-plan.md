# 週間計画対話 roleplay / contract test plan

Status: **v4 audit test specification**
最終更新: 2026-07-13
Parent: ../architecture/weekly-planning-dialogue-architecture-v4.md

Scenario bundle: WP-DA-001（七視点監査の P1〜P7 roleplay/contract suite）

## 共通契約

golden text 完全一致は要求しない。strict assertion は action、factRef、field、state、stateRevision、requestId、turnId、proposal、correction、topic、option、preview、stale、fallback、call count、duplicate、accepted/rejected、diagnostics。rubric は敬体、簡潔、再質問なし、無関係な一括質問なし、内部 slot 非表示、仮定/事実区別、根拠なし値なし、次入力明確、mentor options、入力無視なし。

## P1 novice

opening 一回（StrictMode 含む）、空入力、double submit、長文/multiline、in-flight mode/reset/preview close/history clear/unmount、provider error resend、stale preview、old response、fallback continuation、次の一問を確認する。

## P2 field operator / keyboard

Enter=送信、Shift+Enter=改行、Ctrl+Enter/Meta+Enter=送信（採用キーは実装 task で固定）。IME composition 中は送信しない。focus restore、tab order、paste/multiline、disabled/in-flight、button と keyboard の同一 turn/request を検証する。

## P3 malicious actor / hostile output

unknown action/ref/field、private/stale ref、unauthorized topic/option/preview、invalid proposal/correction/revision、duplicate ID、oversized input/output、enum外、NaN/Infinity、負/0/過大 duration、circular/self relation、prompt injection、HTML/script/markdown command、fact mismatch、delayed/partial response、AI save/delete/repository action、fallback の extra call、rules/AI merge、invalid candidate completion を全て reject し partial apply しない。task/subject/material/title/memo、assumption reason、sourceText/segment、timetable label、preview title、rejected/correction source は untrusted JSON data。system prompt 命令へ連結せず、escaped text のみ表示する。

## P4 data integrity / approval

sourceDraftBlockId、userId、approvalOperationId、stateRevision を検証。partial save、crash/retry、duplicate click、repository/UI failure、optimistic rollback、stale preview、other user/week を検証し completed retry の重複を禁止する。

## P5 migration / localStorage

schemaVersion、非JSON/破損/未知 field、上限、migration count、corruption fallback、F5、日本語、emoji、surrogate、control char、user/week mismatch を検証。conversation/request/pending proposal は session-local、reload で自動再実行/保存しない。既存 draft block localStorage は維持する。

## P6 regression / fallback

provider absent/exception/timeout/invalid JSON/schema、empty candidates、interpreter/planner/validator failure、fallback next turn、mode switch、exam/non-exam、pending/confirmed/explicit、clarification+accepted、preview edit/close/stale、F5、save/discard、opening budget、registry fallback、existing schedule、no-reask、rejected not accepted、uncommitted assumption、exam scheduler、approval、normal mode を検証。fallback は accepted/rejected/pending を保持し stale offer/内部エラーを出さず、extra AI call なし。

## P7 traceability

| Requirement ID | primary spec | v4 section | task | test layer | strict assertion / rubric | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DA-GOAL-001 | §1,§5,§6 | goal | DA2/DA3b | P1/P6/eval | no re-ask; concise next topic | queued | |
| DA-SAFE-001 | §12,§13 | safety | DA1/DA2 | P3/P6 | no AI state/save/repo action | queued | |
| DA-INTERPRET-001 | §5 | non-exam | DA0 | P3/P6 | typed candidate; no merge | open | |
| DA-ACTION-001 | §12 | response | DA1/DA2 | P3/P6 | allowed action/topic/option | queued | |
| DA-TURN-001 | §12 | turn | DA2 | P1/P3/P6 | request/turn/revision stale reject | queued | |
| DA-ASSUMPTION-001 | §5 | lifecycle | DA1b | P3/P6 | no hard apply; transitions | queued | |
| DA-CORRECTION-001 | §5,§7 | lifecycle | DA1b | P3/P6 | target/revision/atomicity | queued | |
| DA-RESPONSE-001 | §12 | response | DA1 | P2/P3/P6 | fact-only values; fallback | queued | |
| DA-PREVIEW-001 | §10 | preview | DA0/approval | P4/P6 | id/revision/stale | open | |
| DA-RELATIVE-001 | §9 | DA3a | DA3a | P3/P6 | no cycle/self/AI placement | queued | |
| DA-FEASIBILITY-001 | §2,§6 | DA3b | DA3b | P1/P6 | required/available/unscheduled | queued | |
| DA-PERSISTENCE-001 | §10,§13 | persistence | approval/DA2 | P4/P5 | schema/user/week/migration | queued | |
| DA-IDEMPOTENCY-001 | §10 | approval | approval | P4/P6 | duplicate/crash/partial retry | queued | |
| DA-FALLBACK-001 | §12 | fallback | DA1/DA2 | P3/P6 | budget/no merge/no loop | queued | |
| DA-EVAL-001 | §1,§5 | evaluation | DA3c | P1-P7 | rubric + metrics | queued | |

## 実行・証跡

unit/contract/integration/property/roleplay/real-model evaluation の結果に request/turn/revision、fallback reason、candidate diagnostics、preview/approval IDs を redacted JSON で記録する。P7 status は queue と同期し、DA0 完了までは DA1 以降を open にしない。git add/commit/push は行わない。