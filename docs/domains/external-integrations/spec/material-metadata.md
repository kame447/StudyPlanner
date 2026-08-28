# 教材メタデータ取得 要件

Status: canonical product/integration requirement
Updated: 2026-08-28
Owning Issue: [#187](https://github.com/kame447/StudyPlanner/issues/187)

## 1. 目的

教材登録時の手入力を減らし、StudyPlannerが主要教材を初回から検索できる状態を作る。同時に、外部APIの障害・料金・利用条件へ教材登録導線を依存させない。

教材検索は次の3層で構成する。

1. StudyPlanner同梱の curated material seed
2. StudyPlanner共有書誌カタログ
3. NDL Search / NDL SRU を使った外部書誌検索

どの層でも見つからない場合、または外部連携が失敗した場合でも手入力登録を維持する。

## 2. 初期教材カタログ

正式な初期教材候補は `src/data/material-catalog/` に置く。

2026-08-28時点のseedは253エントリを持ち、次を含む。

- 数学: チャート系、Focus Gold、1対1対応、問題精講、プラチカ、大学への数学、マセマ等
- 英語: ターゲット、システム英単語、LEAP、鉄壁、DUO、速単、金/銀/黒フレ、英文法・英文解釈・長文教材等
- 国語: 現代文、古文単語、古典文法、漢文の主要教材
- 理科: 物理、化学、生物、地学の主要参考書・問題集
- 地歴公民: 日本史、世界史、地理、政治経済、倫理
- 共通テスト/過去問: 情報I、赤本/青本、共通テスト実戦系
- 中学: 自由自在、最高水準問題集等
- 英語資格: TOEIC、英検、IELTS、TOEFL
- 情報処理資格: ITパスポート、基本情報、応用情報、情報処理安全確保支援士、NW/DB等
- その他資格: 簿記、FP、宅建、行政書士、社労士、漢検、数検
- 大学/専門: プログラミング、ネットワーク、統計、経済、法学等の代表教材

seed entryは少なくとも次を持つ。

- stable internal seed id
- canonical search title
- subject hint
- material kind
- aliases

ISBN、版、ページ数、目次、表紙を不確かな状態でseedへ固定しない。それらは候補選択後に書誌providerから解決する。

## 3. alias とシリーズ

ユーザーが実際に使う呼び方をaliasとして保持する。

例:

- 金フレ → `TOEIC L&R TEST 出る単特急 金のフレーズ`
- シス単 → `システム英単語`
- ネクステ → `Next Stage 英文法・語法問題`
- 鉄壁 → `鉄緑会東大英単語熟語 鉄壁`

同じaliasが複数の実教材へ対応する場合、1件へ勝手に決めない。

例: `青チャート` は 数学I+A / 数学II+B+C / 数学III+C の複数候補を返す。

初期seed検索は正規化完全一致を基本とする。部分一致だけで教材identityを確定しない。

## 4. 旧 naturalLanguageCatalog の扱い

`src/data/naturalLanguageCatalog.json` は自然言語理解用の既存資産であり、正式教材DBではない。一般語・著者名・学習行為も混在するため、教材検索の第一正本にしない。

curated seedにない既存候補を失わないため、長い完全一致語だけlegacy fallbackとして利用できる。ただし短い一般語・人名を教材として即確定しない。

例:

- `微分` → built-in教材hitにしない
- `関正生` → built-in教材hitにしない
- curated seedに存在する `英文法ポラリス` → built-in教材hit

旧Firestore `app_catalogs/natural_language_v1` を教材DBとして復活させない。過去にbrowserからseed/updateできた期間があるため、教材identityのsource of truthとして扱わない。

## 5. 検索フロー

```text
教材追加画面
  ↓ ISBN / 教材名 / alias
curated material seed
  ├─ exact hit → 1件または複数候補を即表示
  └─ miss
       ↓
legacy long exact candidate
  ├─ hit → 候補表示
  └─ miss
       ↓
MaterialMetadata API
       ↓
共有書誌カタログ
  ├─ ISBN / exact normalized title hit → 候補表示
  └─ miss
       ↓
NDL Search 全国書誌情報
       ↓
normalized candidate
       ↓
ISBNを持つNDL由来書誌を共有catalogへcache
```

候補を選択した後は、ISBNまたは候補タイトルでdetails endpointを呼び、取得可能なら次を補完する。

- 著者
- 出版社
- 出版年
- 版
- ISBN
- ページ数
- 目次
- 表紙（openBDで取得できる場合のみ）

## 6. Provider 方針

日本語書籍の書誌正本は国立国会図書館サーチを第一providerとする。

検索対象は初期実装では `iss-ndl-opac-national`（国立国会図書館全国書誌情報）へ限定する。

検索候補はNDL OpenSearch、詳細情報はNDL SRU / DC-NDL v3を利用する。provider固有XMLはintegration layerで正規化し、UI/domainへ直接漏らさない。

NDL由来情報を表示するUIでは全国書誌情報利用のクレジットを表示する。

表紙はNDL書影APIへ依存しない。取得できるISBNについてopenBDの書影をbest-effortで利用するが、openBD由来表紙をStudyPlanner共有Firestoreの永続書誌正本へ保存しない。

## 7. 共有書誌カタログ

共有書誌カタログは「同じ本を毎回外部providerへ問い合わせない」ためのcacheであり、ユーザー教材そのものではない。

保存対象:

- internal catalog entry id
- title
- authors
- publisher
- published year
- edition
- ISBN-10 / ISBN-13
- page count（NDL由来で取得できた場合）
- table of contents（NDL由来で取得できた場合）
- normalized title
- provider provenance / cache timestamp

保存しないもの:

- raw provider response / XML全文
- openBD由来表紙の永続copy
- ユーザーの教科
- 現在進捗
- 目標日
- 学習速度
- ユーザー独自教材

共有catalog writeはserver-side integrationだけが行う。

## 8. StudyPlanner側の責務

外部書誌が提供するページ数や目次は「本の事実」であり、「どう学習するか」の決定ではない。

そのためページ数を取得しても、自動で `総量 = ページ数` にしない。ユーザーが「ページ数をペース管理に使う」を選んだ場合のみ反映する。

例:

- 一般参考書 → ページ管理が適切な場合がある
- 金のフレーズ → ページより単語数での管理が自然
- 問題集 → ページより問題数が自然な場合がある

目次が取得できた場合は教材内構造の初期項目として使えるが、ユーザーは後から編集・非表示にできる。

StudyPlannerが最終的に所有するもの:

- 教材を登録するか
- 教科
- aliases
- 進捗単位
- 総量
- 現在位置
- 教材内構造の利用有無
- 目標日
- 学習速度
- スケジューリング

## 9. Security / failure isolation

- curated seedはrepository同梱read-onlyデータとする
- browserから共有catalogへwriteさせない
- external metadata endpointはFirebase認証済みユーザーのみ利用可能
- request body/query lengthを制限する
- provider障害は教材検索だけを失敗させ、手入力登録を壊さない
- curated seed hitではWorker / NDLを呼ばない
- ISBN / shared exact-title cache hitではNDL OpenSearchを再度呼ばない

## 10. UI要件

検索結果カードは取得済み範囲で次を表示する。

- 表紙またはplaceholder
- 教材名
- curated seedの場合は教科hint / 教材種別
- 著者
- 出版社
- 版
- 出版年
- ページ数
- ISBN

シリーズaliasが複数冊へ対応する場合は複数カードを表示し、ユーザーに選択させる。

候補選択後は詳細カードを表示し、ページ数・目次等を確認してから登録できる。

## 11. Acceptance criteria

- curated seedが250件以上ある
- seed idが重複しない
- 12以上のsubject/category領域を初期カバーする
- `金フレ` が外部APIなしで正式候補へ解決する
- `ターゲット 1900` の空白差を吸収する
- `青チャート` がI+A / II+B+C / III+Cの複数候補を返す
- `微分` や `関正生` を教材として即確定しない
- ISBNと未知タイトルは共有catalog/providerへフォールスルーする
- built-in検索が失敗しても手入力登録できる
- provider障害でも手入力登録できる
- TypeScript / unit / browser regression / production buildを通す

## 12. Deferred

- カメラISBNバーコード読み取り
- `StudyMaterial.catalogEntryId` のクラウド永続リンク
- 共有aliasの利用実績ベース学習
- 登録者数ランキング
- 共有章構造のクラウド正本化
- 論文 / YouTube / Web / Drive provider
