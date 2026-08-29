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
- 検索候補から登録した `StudyMaterial` が教材catalog identity・元タイトル・取得済みISBNを保持する
- catalog linkは教材表示名を編集しても維持する
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
- `StudyMaterial` / `StudyMaterialDraft` に `catalogEntryId`、`catalogTitle`、`catalogIsbn10`、`catalogIsbn13` を追加
- 検索候補から登録するとstable catalog identity、選択時タイトル、取得済みISBN、curated aliasをユーザー教材へ保存
- built-in候補は `seed:<id>` をstable identityとして維持し、NDLで得たISBNは別フィールドに保持
- 既存教材編集ではcatalog linkを保持し、編集画面に「教材DBに紐付け済み」を表示
- E2Eで `金フレ` を検索→保存→再度編集し、catalog linkが残る経路を追加
- 旧教材・手入力教材にはmigrationで架空のcatalog linkを付与しない

## Cover provider boundary

- NDL: 書誌、版、ページ数、目次の正本。2026-03-31終了の旧書影APIには依存しない
- openBD: ISBNが解決できた教材の書影をbest-effort表示する。書影URLは検索/登録時に利用するが、共有書誌catalogへ永続保存しない
- Google Books: 現時点では必須依存へ追加しない
- JPRO: 固定IP・事業者申請等を前提とするため、即時の無料公開fallbackとして追加しない
- 将来、より高い書影収録率が必要なら契約型providerを別integrationとして検討する

## Previous verified checkpoint

HEAD `fbb60f628f72c2fafbe7122057d0e42441cefc79` ではcatalog link追加前の教材検索・表紙実装について次がterminal successだった。

- CI run `33196273394`: success
- Browser Regression run `33196273395`: success
- UI Regression Matrix run `33196273392`: success
- UI Quality Automation run `33196273398`: success
- Admin Overview Render run `33196273425`: success
- latest main at verification: `b053a677c00fea642a040831fd2161760567a382`
- branch: behind 0
- unresolved review threads: 0

## Current checkpoint / next action

catalog link永続化の実装・unit・E2E・canonical spec更新まで同じbranch / PRに追加済み。

前回green HEADとの差分監査では、catalog link関連の6ファイルだけが変更対象であることを確認した。途中で混入した時限削除エラーメッセージの無関係な文言差分は除去済み。

次に、最新HEADで CI / Browser Regression / UI Regression Matrix / UI Quality Automation / Admin Overview Render をterminal successまで確認する。失敗時はproduction defect / contract / harnessを分類し、テストを弱めず修正する。全green後にPR本文とIssue #187の既存checkpoint commentをexact HEADへ同期する。

## Remaining production-rollout work

PR #221 のコード検証後も、production rollout前の実環境確認として次を残す。

- deployed Worker経由の認証済みISBN検索smoke
- deployed Worker経由の認証済みタイトル検索smoke
- Workerから共有Firestoreへ書き込むservice-account権限の実環境確認

上記はdeployment credential / 実環境認証境界の検証であり、ローカルunitやbrowser harnessでは代替しない。現在利用できるGitHub操作ツールには新規 `workflow_dispatch` 実行機能がないため、既存Live Account workflowをこの会話から開始できない。

## Deferred product scope

- camera ISBN barcode scanning
- shared alias learning / registration count / ranking
- shared chapter/section cloud source of truth
- JPRO等の契約型書影provider導入判断
- paper / YouTube / web / Drive providers
