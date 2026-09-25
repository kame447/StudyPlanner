# External integrations

Status: current domain entry point

このドメインは、StudyPlanner が外部サービスを取得・参照・実行に利用する際の provider / adapter 境界、利用条件、障害時の縮退、および外部データ・実行状態と内部 domain model の分離を扱う。

現在の親Issueは [#187](https://github.com/kame447/StudyPlanner/issues/187) とする。

本ドメインは教材・予定・週間計画・ユーザー記憶そのものの意味や保存モデルを所有しない。外部サービス固有のレスポンス、認証、quota、利用規約、fallback を StudyPlanner 内部へ漏らさないための統合境界を所有する。

## Canonical requirements

- [`spec/material-metadata.md`](spec/material-metadata.md): 書籍教材の検索、共有catalog、provider fallback、manual fallbackの正仕様

## Supporting research

- [`work/20260828-material-metadata-api-research.md`](work/20260828-material-metadata-api-research.md): 教材登録・教材タイプ拡張に使える外部APIの公式仕様、利用条件、採否を調査した証拠。本文中の実装前記述はhistorical contextであり、現在のruntime要件を上書きしない。
- [`work/20260912-managed-agent-runtime-evaluation.md`](work/20260912-managed-agent-runtime-evaluation.md): Agents APIを、複数情報源を調べる学習相談の助言候補生成だけに限定する導入方針と有効化前の評価。Lunaでの対象構成、費用、待ち時間、安全性の実API試験と本番有効化は未実施。

学習相談の意味・提案・採用・通常planningへの接続は [#246の正仕様](../weekly-planning/spec/learning-consultation-and-advice.md) に従う。通常の計画解釈、renderer、承認・保存、User Contextの記憶生成・統合・要約をAgents APIへ移さない。外部調査が不要な相談まで一律に起動しない。

## Boundary

外部APIは候補データや実行結果を返すサービスであり、StudyPlannerの正本ではない。

```text
external provider
  ↓ provider-specific adapter
normalized integration DTO / validated candidate
  ↓ review / mapping / owning application validation
StudyPlanner domain model
```

次を継続的な境界とする。

- provider 固有の response を UI や domain model へ直接流さない
- 外部 API 停止時でも手入力など既存の主要導線を壊さない
- provider から得られない情報を AI や heuristic で「取得済み」にしない
- caching、保存、画像利用、商用利用は provider ごとの公式条件を確認する
- external metadata と教材の章・節・進捗構造を同じ責務にしない

書籍教材については、初期 provider を NDL Search とし、共有 catalog を ISBN 中心の server-side cache として実装する。runtime behavior は `spec/material-metadata.md` を正本とする。

相談agentのsession継続・完了を、正式なユーザー記憶・提案採用・予定承認・保存receiptと同一視しない。共有contextを使う場合は [User Contextの読取境界](../user-context/architecture/managed-execution-boundary.md) を満たす。助言候補は検証後にユーザーへ示し、採用されてから既存の計画処理へ渡す。
