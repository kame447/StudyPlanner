# Codex 実装ルール

Status: superseded / historical filename retained for compatibility
Updated: 2026-08-16

この文書は current implementation source of truth ではない。Codex 固有の運用前提と旧 V4 architecture を含んでいたため、現在の Stable V5 / PR #130 の実装判断には使用しない。

週間計画の current document set は [weekly-planning-docs-index.md](weekly-planning-docs-index.md) を入口とし、設計判断は [weekly-planning-current-contract-v5.md](weekly-planning-current-contract-v5.md)、現在位置は [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md)、実行順序は [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md) を優先する。

PR #130 の作業範囲と会話品質監査は [tasks/20260814-weekly-planning-conversation-quality-luna-audit.md](tasks/20260814-weekly-planning-conversation-quality-luna-audit.md) を参照する。2026-08-16 の decision-ownership 敵対的監査は [audits/20260816-pr130-decision-duplication-adversarial-audit.md](audits/20260816-pr130-decision-duplication-adversarial-audit.md) を参照する。

この historical file に書かれていた「task 外へ scope を広げない」「検証専用依頼ではコードを変更しない」「Git 操作は明示された scope に従う」といった一般的な安全原則は有用だが、architecture の正本としてこのファイルを復活させない。

現在の原則は、特定の agent 名ではなく repository の current contract と roadmap に従うことである。
