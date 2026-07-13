# 週間計画対話設計レビュー（historical evidence）

Status: **historical / superseded by v4**
最終更新: 2026-07-13
Current DoR: ../../architecture/weekly-planning-dialogue-architecture-v4.md

## 保持する観察

- fixed missing-slot order は accepted state を再質問し、会話をフォームへ戻す。
- AI は single semantic interpreter、scheduler/availability/fact/preview/save は deterministic core に残す。
- 既知予定、複数条件、短答、訂正、仮定、容量不足を state-grounded に扱う。
- golden text でなく action/state/factRef/diagnostics と会話 rubric を評価する。

## 監査で追加した契約

non-exam preview bridge、assumption/correction lifecycle、response fact allow-list、turn/request envelope、stale invalidation、全 user strings の untrusted 扱い、approval idempotency、localStorage migration を DA0〜DA3c に割り当てた。本文書の v3/D1-D3/P4-P9/T6 は履歴であり current queue ではない。
