# 週間計画AI 自走会話改善ループ

Status: superseded
Original date: 2026-08-01
Superseded: 2026-08-11

このtaskは、固定scenarioと決定論的user driverを中心に実API会話を自動評価する旧方針を扱っていた。

現在は次へ置き換えられている。

- AI会話品質を固定scenario oracleで自動採点しない。
- 実API会話は一turnずつ実行し、開発エージェントがtranscriptと内部状態をレビューする。
- 明確な問題があれば原因層を修正し、同じ地点から再実行する。
- 自動テストは決定論的なschema、state、Fact Graph、scheduler、preview、approval、save等だけを保証する。

後継:

- `docs/ai/tasks/20260810-weekly-planning-human-reviewed-conversation-improvement-loop.md`
- `docs/ai/testing/weekly-planning-test-philosophy.md`
- `docs/ai/tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md`

固定5scenario、固定発話順、machine-generated conversation quality PASSを今後のcanonical test方針へ戻さない。
