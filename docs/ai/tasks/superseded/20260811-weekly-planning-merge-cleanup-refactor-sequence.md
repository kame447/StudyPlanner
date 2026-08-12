# 週間計画 merge後整理・挙動不変リファクタ実行順序

Status: superseded
Original date: 2026-08-11
Superseded: 2026-08-12

この文書は、Stable V5 merge直後に「legacy削除 → 挙動不変リファクタ → 7視点監査 → 新規改善」の順で進めるために作成したhistorical execution planである。

現在のactive taskは次である。

- [20260812-weekly-planning-legacy-concept-migration-and-real-api-audit.md](../20260812-weekly-planning-legacy-concept-migration-and-real-api-audit.md)

## 当時の目的

- Stable V5を唯一のproduction runtimeとする。
- legacy interpreter/parser/runtime modeを削除する。
- production挙動を変えない状態で境界を整理する。
- cleanup後に7視点監査を行ってから新規改善へ進む。

## 当時の禁止事項

- cleanupと新規scheduler policy変更を同じ段階で混ぜない。
- semantic ownershipをdeterministic parserへ戻さない。
- fixed scenarioやAI文面を通常CIのquality oracleにしない。

## superseded理由

legacy cleanupとStable V5境界整理は進行し、PR #120では既にhuman grounding、effort binding、scheduler policy、旧pipeline思想の選別移植、実API監査を行う段階へ移った。

そのため「現在はPhase 4 behavior-preserving refactorであり、新規改善は未着手」という本書の進捗表現は現状と一致しない。

ただし、次の原則は引き続き有効である。

1. Stable V5を唯一のproduction runtimeとする。
2. AIは意味理解、deterministic coreはformal state/readiness/schedulingを担当する。
3. CIが赤い状態で次の実装単位へ進まない。
4. historical compatibility layerとlegacy runtimeを混同しない。
5. 大きな変更は対象回帰→full CI→実API観測の順で検証する。

詳細な当時の作業履歴はGit historyを参照し、現在の実行順序はactive taskとcanonical roadmapを正とする。
