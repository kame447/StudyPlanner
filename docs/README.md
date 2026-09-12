# StudyPlanner Documentation

文書の配置ルールおよび統制は [DOCUMENT_DICTIONARY.md](DOCUMENT_DICTIONARY.md) に従います。

## 閲覧順序 (Read order)

リポジトリでの作業時の推奨閲覧順序：

1. [`AGENTS.md`](../AGENTS.md)
2. [`PROJECT_MAP.md`](../PROJECT_MAP.md)
3. 本インデックス / ドキュメント辞書 ([DOCUMENT_DICTIONARY.md](DOCUMENT_DICTIONARY.md))
4. 担当ドメインの README (`domains/<responsibility>/README.md`)
5. 正本仕様 (canonical contract) / 現在の Issue / 進行中タスク記録 (active work record)

## ドメイン一覧 (Domains)

- [Scheduling](domains/scheduling/README.md) — アプリ全体の scheduled-event authority / `ScheduleOccurrence` projection / canonical な `ScheduleEvent` 永続化。Issue #278 の移行は完了済みであり、今後の変更は新しい product requirement を所有する Issue から開始します。
- [Weekly planning](domains/weekly-planning/README.md) — Issue #246 の「学習相談 → AI助言 → user adoption → 既存planning」に関する planned requirement は [`learning-consultation-and-advice.md`](domains/weekly-planning/spec/learning-consultation-and-advice.md) が正本です（runtime 実装は未完了）。
- [User context](domains/user-context/README.md) — アプリ全体の durable user context、semantic / episodic memory、retrieval、lifecycle / forget、会話への表出（conversation surfacing）。Current owner: Issue #294
- [Client runtime](domains/client-runtime/README.md)
- [Reporting](domains/reporting/README.md)
- [Product observability](domains/product-observability/README.md)
- [External integrations](domains/external-integrations/README.md) — 書籍教材 metadata の正仕様は [`material-metadata.md`](domains/external-integrations/spec/material-metadata.md)。外部実行サービスの採否もこのdomainで扱い、各product domainのauthorityは移しません。

## User Contextの実装準備

#294の既存canonical文書を正本とし、[read/writeサービスの詳細設計](domains/user-context/architecture/context-service-contract.md) はその補助設計、[段階実装work](domains/user-context/work/20260912-context-harness-delivery.md) は変更箇所・受入条件・rollbackの作業記録です。[実行順序](domains/user-context/roadmap/current.md) に従い、文書の導入とruntimeの完成を区別します。開発エージェント向けskills/orchestrationの#212とは別scopeです。

## 情報収集を伴う学習相談へのAgents API利用

2026-09-13に合意した用途は、複数の情報源を調べて根拠付きの助言候補を作る学習相談の前段だけです。[限定導入work](domains/external-integrations/work/20260912-managed-agent-runtime-evaluation.md) に利用範囲と本番有効化前の評価を置き、[学習相談の正仕様](domains/weekly-planning/spec/learning-consultation-and-advice.md) の検証・提案・ユーザー採用・通常planningへの接続を使います。[User Contextの読取境界](domains/user-context/architecture/managed-execution-boundary.md) は、相談へ渡す記憶とその訂正・忘却の扱いだけを補足します。

通常の計画解釈・renderer・scheduler・承認・保存、および長期記憶の抽出・統合・定期要約はAgents APIへ移しません。外部調査のない短い相談まで一律に呼び出す方針ではありません。Lunaでの対象構成、総費用、待ち時間、根拠と安全性の試験は未実施で、本番API切替も行っていません。User Contextの実装順をこのAPI評価待ちにしません。

## 横断タスク・運用 (Cross-cutting work)

- [Work documentation](work/README.md)

## 履歴・アーカイブ (History)

- [Archive](archive/README.md)

`archive/` は過去の経緯や監査の証跡であり、現在の実装指示ではありません。現行の設計・判断は、`ai/`、`testing/`、`strategy/`、`design/` のような対象者・ツール別のフォルダではなく、担当ドメイン配下に配置します。
