# External integrations

Status: current domain entry point

このdomainは、StudyPlannerが外部サービスからデータを取得・参照するときのprovider / adapter境界、利用条件、障害時の縮退、外部データと内部domain modelの分離を扱う。

現在の親Issueは [#187](https://github.com/kame447/StudyPlanner/issues/187) とする。

このdomainは教材・予定・週間計画そのものの意味や保存モデルを所有しない。外部サービス固有のレスポンス、認証、quota、利用規約、fallbackをStudyPlanner内部へ漏らさないための統合境界を所有する。

## Current work

- [`work/20260828-material-metadata-api-research.md`](work/20260828-material-metadata-api-research.md): 教材登録・教材タイプ拡張に使える外部APIの公式仕様、利用条件、採否を調査するactive work record

## Boundary

外部APIは候補データを返す情報源であり、StudyPlannerの正本ではない。

```text
external provider
  ↓ provider-specific adapter
normalized integration DTO
  ↓ review / mapping
StudyPlanner domain model
```

次を継続的な境界とする。

- provider固有responseをUIやdomain modelへ直接流さない
- 外部API停止時でも手入力など既存の主要導線を壊さない
- providerから得られない情報をAIやheuristicで「取得済み」にしない
- caching、保存、画像利用、商用利用はproviderごとの公式条件を確認する
- external metadataと教材の章・節・進捗構造を同じ責務にしない

現在は調査段階であり、runtime provider implementationの正仕様はまだ確定していない。採用APIと内部contractは、公式条件と実装検証を通した後にarchitecture documentへ昇格する。