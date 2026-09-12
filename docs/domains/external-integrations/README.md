# External integrations

Status: current domain entry point

このドメインは、StudyPlanner が外部サービスを取得・参照・実行に利用する際の provider / adapter 境界、利用条件、障害時の縮退、および外部データ・実行状態と内部 domain model の分離を扱う。

現在の親Issueは [#187](https://github.com/kame447/StudyPlanner/issues/187) とする。

本ドメインは教材・予定・週間計画・ユーザー記憶そのものの意味や保存モデルを所有しない。外部サービス固有のレスポンス、認証、quota、利用規約、fallback を StudyPlanner 内部へ漏らさないための統合境界を所有する。

## Canonical requirements

- [`spec/material-metadata.md`](spec/material-metadata.md): 書籍教材の検索、共有catalog、provider fallback、manual fallbackの正仕様

## Supporting research

- [`work/20260828-material-metadata-api-research.md`](work/20260828-material-metadata-api-research.md): 教材登録・教材タイプ拡張に使える外部APIの公式仕様、利用条件、採否を調査した証拠。本文中の実装前記述はhistorical contextであり、現在のruntime要件を上書きしない。
- [`work/20260912-managed-agent-runtime-evaluation.md`](work/20260912-managed-agent-runtime-evaluation.md): Agents APIの公式情報と限定的な採否検証。公開仕様の調査のみで、実API実験・provider採用・本番導入は未実施。プロダクトの正本と忘却はuser-context、同期はclient-runtimeの責務を維持する。

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

managed executionを利用する場合も、provider sessionの継続・完了を正式なユーザー記憶・承認・保存receiptと同一視しない。[User Contextの委譲境界](../user-context/architecture/managed-execution-boundary.md) を満たすadapterだけを比較する。一般的な実行機構の委譲と、プロダクトauthorityの委譲は別である。
