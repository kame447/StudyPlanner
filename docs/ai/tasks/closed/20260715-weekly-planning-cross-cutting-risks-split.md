# 週間計画の横断的リスク分割 completion record

Status: closed
Completed: 2026-07-16
Source: `20260715-weekly-planning-cross-cutting-risks.md`

## 目的

conversation trace実装中に確認された構造、security、scalability上の9論点を、独立した責務と完了条件を持つtaskへ分割した記録である。

## 分割先

| task | 移管した論点 |
| --- | --- |
| `20260716-weekly-planning-entrypoint-request-ownership.md` | session identity、request ownership、stale result、複数tab、reset/close/unmount |
| `20260716-weekly-planning-trace-privacy-and-lifecycle.md` | opt-in、raw content、redaction、TTL、account deletion、admin access、export |
| `20260716-weekly-planning-approval-persistence-and-idempotency.md` | localStorage ledger、別端末、multi-tab、transaction、partial retry |
| `20260716-weekly-planning-trace-scalability-and-schema-migration.md` | pagination、query cost、index、archive、versioned decoder |
| `20260716-weekly-planning-controller-ui-responsibility-split.md` | NaturalLanguageAssistant責任集中、conversation/preview controller、view component |

## 維持する境界

- client直書きtraceはdebug/evaluation候補であり、監査、課金、security判定の根拠にしない。
- trace保存失敗でplanning処理を失敗させない。
- privacy decision未確定のままproduction enablementを完了扱いにしない。
- 各taskを一つのproduction変更へ再統合しない。

## 完了確認

- [x] 9論点を5責務へ分割した
- [x] 各taskにPriority、Entry conditions、触らない範囲、受け入れ条件、Exit conditionsを付与した
- [x] 元trackerをcurrent queueから閉じられる状態にした
