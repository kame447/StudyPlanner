# 教材カタログ1000件拡張 checkpoint

Updated: 2026-08-28
Issue: #187
Branch: `research/material-metadata-apis`
PR: #221

## Definition of done

- 初期教材検索インデックスが1000件以上
- 高信頼curated coreが300件以上
- Amazonカテゴリ別売れ筋を人気教材漏れ監査のシグナルとして利用し、順位自体は保存しない
- broad discovery candidateは `resolutionRequired` として高信頼教材と区別
- 選択時にNDL書誌解決を試みる
- provider障害時も手入力登録可能
- 最新mainからbehind 0
- CI / Browser Regression / UI Regression Matrix / UI Quality Automation が最新HEADでterminal success

## Completed implementation

- `amazon-popular.json` にAmazon人気監査で不足していた教材を追加
- `coverage-discovery.ts` で高校/大学受験、共通テスト、中学、英検、TOEIC、情報処理資格、その他資格、47都道府県高校入試、主要大学過去問を広域seed化
- built-in catalogをcurated + discoveryへ分離
- discovery / legacy candidateへ `resolutionRequired` を付与
- 検索UIで未解決候補を明示
- unit testで1000件以上 / curated 300件以上を固定
- E2Eで `東京大学 赤本` discovery表示を追加

## Verification history

直前の291件HEADでは UI Quality Automation / bundle budget / TypeScript checks はsuccess。UI Regression Matrixはmain側ダークテーマ変更に対する古いhome dark baselineでのみfailureし、その後mainでbaselineが更新された。

## Next action

最新mainのvisual baseline更新を通常mergeで取り込み、最新HEADの全required workflowを完走する。失敗時はテストを弱めず原因を修正する。
