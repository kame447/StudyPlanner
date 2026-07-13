# 週間計画対話レビュー index

Status: **historical index; v4 queue normalized**
最終更新: 2026-07-13
Current DoR: ../../architecture/weekly-planning-dialogue-architecture-v4.md

## Current state

queue は Gate P4（verification only）→ DA0 open → DA1 → DA1b → Draft approval idempotency → DA2 → DA3a → DA3b → DA3c queued。P4 を closed/adopted/migration complete と表現せず、旧 D1/D2/D3、P5〜P9、T6 を current item としない。

## Evidence map

| 資料 | 扱い |
| --- | --- |
| weekly-planning-spec.md | product goal と §12/§13 の最上位仕様 |
| weekly-planning-dialogue-architecture-v4.md | state/action/response/turn/preview/queue の DoR |
| weekly-planning-dialogue-architecture.md | v3 historical/superseded |
| weekly-planning-dialogue-design-review.md | historical evidence |
| weekly-planning-deferred-backlog.md | historical backlog |
| weekly-planning-roleplay-test-plan.md | P1-P7、traceability、strict/rubric |
| 旧 task 名 | rename explanation または superseded/history の参照だけ |

## 七視点監査で解消した矛盾

action/factRef grounding、assumption/correction、async stale、untrusted strings、approval idempotency、localStorage migration、non-exam preview bridge を v4 と DA0〜DA3c に割り当てた。D1/D2/D3 の名称衝突、P4 next、T6 open、P5〜P9 current の表現を current queue から除去した。
