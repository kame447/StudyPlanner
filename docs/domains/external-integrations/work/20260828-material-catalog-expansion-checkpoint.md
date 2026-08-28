# 教材カタログ1000件拡張 checkpoint

Updated: 2026-08-29
Issue: #187
Branch: `research/material-metadata-apis`
PR: #221

## Definition of done

- 初期教材検索インデックスが正規化後のユニークidentityで1000件以上
- 高信頼curated coreが300件以上
- Amazonカテゴリ別売れ筋を人気教材漏れ監査のシグナルとして利用し、順位自体は保存しない
- broad discovery candidateは `resolutionRequired` として高信頼教材と区別
- 高信頼built-in候補は検索時に書誌/表紙をbest-effort補完する
- 選択時にNDL書誌解決を試み、ページ数・版・目次・表紙を再確認する
- openBD書影が壊れている場合はplaceholderへ戻し、教材登録を壊さない
- provider障害時も手入力登録可能
- 最新mainからbehind 0
- CI / Browser Regression / UI Regression Matrix / UI Quality Automation が最新HEADでterminal success

## Completed implementation

- `amazon-popular.json` にAmazon人気監査で不足していた教材を追加
- `coverage-discovery.ts` で高校/大学受験、共通テスト、中学、英検、TOEIC、情報処理資格、その他資格、47都道府県高校入試、主要大学過去問を広域seed化
- built-in catalogをcurated + discoveryへ分離
- discovery / legacy candidateへ `resolutionRequired` を付与
- 検索UIで未解決候補を明示
- unit testでユニーク1000件以上 / curated 300件以上を固定
- E2Eで `東京大学 赤本` discovery表示を追加
- built-in高信頼候補の上位4件を逐次details解決し、ISBNが得られればopenBD書影を検索結果カードにも反映
- NDLへの自動補完は並列化せず逐次実行し、外部providerへの同時アクセスを避ける
- openBD書影URLを共有Firestore書誌正本へ永続copyしない既存境界を維持
- 表紙画像が404等で読み込めない場合は検索結果カードを本アイコンへフォールバック
- Worker unit testで `認証 → NDL ISBN検索 → openBD表紙補完 → coverImageUrl返却` を固定
- UI unit testで取得済み表紙の表示とbroken-image fallbackを固定

## Cover provider boundary

- NDL: 書誌、版、ページ数、目次の正本。2026-03-31終了の旧書影APIには依存しない
- openBD: ISBNが解決できた教材の書影をbest-effort表示する。書影URLは検索/登録時に利用するが、共有書誌catalogへ永続保存しない
- Google Books / 楽天Books: 現時点では課金/表示/収益化条件との相性からcover fallbackとして追加しない
- 将来、より高い書影収録率が必要ならJPRO等の契約型providerを別integrationとして検討する

## Current checkpoint

- 最新main `f2aa3d59178c8c6ba6046eb78b6b71c905514314` を通常の2-parent mergeで取り込み済み
- main同期直後HEAD: `1fa3ed02c688b9ec7ecd10d47282d171a37784bc`
- cover enrichment実装・テストを同じbranch / PRへ追加済み

## Next action

最新cover HEADのrequired workflowを完走する。失敗時はproduction defect / contract / harnessを分類し、テストを弱めず修正する。全green後にPR本文とIssue checkpointを最終HEADへ同期する。
