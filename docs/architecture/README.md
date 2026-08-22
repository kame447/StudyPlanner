# Architecture documentation index

Updated: 2026-08-22

この directory は実装責務を説明する補助 architecture 文書を置く。週間計画の最上位 contract と現在位置は `docs/ai/` を正とし、architecture 文書が current contract / code / tests と衝突する場合は architecture 文書側を更新する。

## Current weekly-planning documents

- `weekly-planning-dialogue-architecture-v5.md`
  - Stable V5 の turn / dialogue / planning boundary の概要
- `weekly-planning-semantic-ownership-boundary-v5.md`
  - AI semantic interpretation と deterministic application の責務境界
- `weekly-planning-semantic-schema-v5.md`
  - SemanticDocument → Fact Graph → planning material の説明
- `weekly-planning-semantic-schema-registry.md`
  - semantic schema / type registry
- `weekly-planning-availability-architecture-v5.md`
  - availability / occupied sources / scheduler input boundary
- `weekly-planning-conversation-trace.md`
  - current trace schema / diagnostic boundary

最上位参照:

- `../ai/weekly-planning-current-contract-v5.md`
- `../ai/weekly-planning-current-contract-status.md`
- `../ai/strategy/weekly-planning-roadmap.md`

## Historical

`weekly-planning-dialogue-architecture-v4.md` は historical record であり current architecture ではない。V4 roleplay scenario は `../testing/weekly-planning-roleplay-test-plan.md` に historical evidence として残る。

古い migration task、branch、PR を architecture 文書から current execution owner として参照しない。未完了作業は `../ai/tasks/README.md` と open Issue で追跡する。
