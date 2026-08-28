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
- 検索で得た外部表紙URLとユーザーアップロード画像を別フィールドで永続化する
- 最新mainからbehind 0
- CI / Browser Regression / UI Regression Matrix / UI Quality Automation が最新実装HEADでterminal success

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
- 検索で得た外部表紙は `StudyMaterial.coverImageUrl`、ユーザーが選んだ画像は `coverImageDataUrl` として分離して保存
- 外部表紙URLをData URL欄へ混在させない回帰テストを追加

## Cover provider boundary

- NDL: 書誌、版、ページ数、目次の正本。2026-03-31終了の旧書影APIには依存しない
- openBD: ISBNが解決できた教材の書影をbest-effort表示する。書影URLは検索/登録時に利用するが、共有書誌catalogへ永続保存しない
- Google Books: 現時点では必須依存へ追加しない
- JPRO: 固定IP・事業者申請等を前提とするため、即時の無料公開fallbackとして追加しない
- 将来、より高い書影収録率が必要なら契約型providerを別integrationとして検討する

## Verified implementation checkpoint

実装HEAD `5c5972f25842657d445b860376db5be54e08ce15` で次を確認済み。

- CI run `33195696047`: success
  - TypeScript checks
  - unit tests
  - Firestore rules regression
  - production build
  - PR diff check
- Browser Regression run `33195696107`: success
- UI Regression Matrix run `33195695931`: success
- UI Quality Automation run `33195695967`: success
- Admin Overview Render run `33195695933`: success
- latest main at verification: `b053a677c00fea642a040831fd2161760567a382`
- branch: behind 0
- unresolved review threads: 0

このcheckpoint更新自体はdocumentation-only commitなので、更新後HEADでもrepository policyに従って必要workflowのterminal stateを確認する。

## Remaining production-rollout work

PR #221 のコード・回帰検証は完了。production rollout前の実環境確認として次だけ残す。

- deployed Worker経由の認証済みISBN検索smoke
- deployed Worker経由の認証済みタイトル検索smoke
- Workerから共有Firestoreへ書き込むservice-account権限の実環境確認

上記はdeployment credential / 実環境認証境界の検証であり、ローカルunitやbrowser harnessでは代替しない。

## Deferred product scope

- camera ISBN barcode scanning
- `StudyMaterial.catalogEntryId` のcloud-persistent link
- shared alias learning / registration count / ranking
- shared chapter/section cloud source of truth
- JPRO等の契約型書影provider導入判断
- paper / YouTube / web / Drive providers
