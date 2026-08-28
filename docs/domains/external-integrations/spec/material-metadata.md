# 教材メタデータ取得 要件

Status: canonical product/integration requirement
Updated: 2026-08-28
Owning Issue: [#187](https://github.com/kame447/StudyPlanner/issues/187)

## 1. 目的

教材登録時の手入力を減らし、StudyPlannerが主要教材を初回から検索できる状態を作る。同時に、外部APIの障害・料金・利用条件へ教材登録導線を依存させない。

教材検索は次の4層で構成する。

1. StudyPlanner同梱の高信頼 curated material seed
2. StudyPlanner同梱の broad discovery seed
3. StudyPlanner共有書誌カタログ
4. NDL Search / NDL SRU を使った外部書誌検索

どの層でも見つからない場合、または外部連携が失敗した場合でも手入力登録を維持する。

## 2. 1000件以上の初期検索カバレッジ

初期教材候補は `src/data/material-catalog/` に置く。

2026-08-28時点で、初期検索インデックスは1000件以上を必須とする。構成は「実教材・実シリーズとして確認済みのcurated core」と「広い検索範囲を持つdiscovery seed」に分ける。

### 2.1 Curated core

300件以上を目安に、次のような実教材・実シリーズを保持する。

- 数学: チャート系、Focus Gold、1対1対応、問題精講、プラチカ、大学への数学、マセマ、旺文社全レベル問題集等
- 英語: ターゲット、システム英単語、LEAP、鉄壁、DUO、速単、金/銀/黒フレ、ポラリス、全レベル問題集、英文法・英文解釈・長文教材等
- 国語: 現代文、現代文ポラリス、古文単語、古文ポラリス、古典文法、漢文の主要教材
- 理科: 物理、化学、生物、地学の主要参考書・問題集、チャート式理科、有機化学ポラリス
- 地歴公民: 日本史、世界史、地理、政治経済、倫理
- 共通テスト/過去問: 情報I、赤本/青本、共通テスト実戦系、チャート式共通テスト数学
- 中学: 自由自在、最高水準問題集等
- 英語資格: TOEIC、英検、IELTS、TOEFL
- 情報処理資格: ITパスポート、基本情報、応用情報、情報処理安全確保支援士、NW/DB等
- その他資格: 簿記、FP、宅建、行政書士、社労士、漢検、数検
- 大学/専門: プログラミング、ネットワーク、統計、経済、法学等の代表教材

人気教材の漏れ監査にはAmazon.co.jpのカテゴリ別売れ筋ランキングを発見シグナルとして使用する。ランキング値そのものは日々変動するため保存しない。

2026-08-28時点で確認した代表カテゴリ:

- 大学受験入試問題集: category `503762`
- 英語の単語・熟語: category `503680`
- TOEIC 単語・熟語: category `893344`
- ITパスポート: category `502780`
- 英語検定: category `520868`
- 高校数学教科書・参考書: category `3238621`

Amazonランキングで上位確認した教材のうち、既存seedに不足していたものは `amazon-popular.json` に分離して追加する。例として Distinction 2000、データベース3300/4800、キクタン、究極の英単語、英文熟考、The Essentials、ぐんぐん読める英語長文、TOEIC公式/特急系、主要ITパスポート教材等を含む。

Amazonランキングは売上数の正確な公開値ではなく、最近の利用実績を強く反映する相対指標である。そのため、順位そのものをStudyPlannerの永続データやランキング機能へ転用しない。

### 2.2 Broad discovery seed

1000件規模のカバレッジを安全に作るため、実在する1冊と断定するには粗い検索語は `resolutionRequired: true` の discovery candidate として保持する。

対象例:

- 高校/大学受験: 科目 × 基礎/標準/重要問題/全レベル/一問一答/講義/演習
- 共通テスト: 科目 × 実戦問題集/実戦模試/総合問題集/過去問/予想問題
- 中学/高校受験: 5教科 × 主要教材形式
- 英検: 5級〜1級 × パス単/過去問/総合対策/予想問題/ライティング/面接等
- TOEIC: スコア帯・Part・技能 × 参考書/問題集/特急/ドリル/完全攻略等
- 情報処理資格: ITパスポート〜高度区分、CCNA、AWS、Azure等
- その他資格: 簿記、FP、宅建、行政書士、社労士、会計/法律/技術資格等
- 高校入試: 47都道府県の過去問/予想問題
- 大学入試: 主要大学の赤本/過去問検索identity

Discovery candidateは検索時には即表示できるが、正式なISBN・版・出版社等を持つ「書誌正本」とはみなさない。選択後にNDL detailsで実在する書誌へ解決する。

この分離により、1000件化のために架空のISBN・ページ数・版を固定することを禁止する。

## 3. Seed entry

seed entryは少なくとも次を持つ。

- stable internal seed id
- search title
- subject hint
- material kind
- aliases
- discoveryの場合 `resolutionRequired: true`

ISBN、版、ページ数、目次、表紙を不確かな状態でseedへ固定しない。それらは候補選択後に書誌providerから解決する。

現行シリーズの追加は、出版社公式カタログ等でシリーズの存在を確認したものを `verified-series.json` に分離する。Amazonランキングで人気確認した教材は `amazon-popular.json` に分離する。広域検索identityは `coverage-discovery.ts` で生成する。

## 4. alias とシリーズ

ユーザーが実際に使う呼び方をaliasとして保持する。

例:

- 金フレ → `TOEIC L&R TEST 出る単特急 金のフレーズ`
- シス単 → `システム英単語`
- ネクステ → `Next Stage 英文法・語法問題`
- 鉄壁 → `鉄緑会東大英単語熟語 鉄壁`

同じaliasが複数の実教材へ対応する場合、1件へ勝手に決めない。

例: `青チャート` は 数学I+A / 数学II+B+C / 数学III+C の複数候補を返す。

シリーズ名そのものを検索した場合も、`series-aliases.json` に定義した具体的な巻・レベルを複数候補として返す。

初期seed検索は正規化完全一致を基本とする。部分一致だけで教材identityを確定しない。

## 5. 旧 naturalLanguageCatalog の扱い

`src/data/naturalLanguageCatalog.json` は自然言語理解用の既存資産であり、正式教材DBではない。一般語・著者名・学習行為も混在するため、教材検索の第一正本にしない。

curated/discovery seedにない既存候補を失わないため、長い完全一致語だけlegacy fallbackとして利用できる。このfallbackも `resolutionRequired: true` とし、書誌正本とはみなさない。

例:

- `微分` → built-in教材hitにしない
- `関正生` → built-in教材hitにしない
- `経済セミナー` → legacy exact candidateとして表示可能、選択後に詳細確認

旧Firestore `app_catalogs/natural_language_v1` を教材DBとして復活させない。過去にbrowserからseed/updateできた期間があるため、教材identityのsource of truthとして扱わない。

## 6. 検索フロー

```text
教材追加画面
  ↓ ISBN / 教材名 / alias / シリーズ名
curated material seed / series aliases
  ├─ exact hit → 高信頼候補を即表示
  └─ miss
       ↓
broad discovery seed
  ├─ exact hit → 検索候補を即表示（resolutionRequired）
  └─ miss
       ↓
legacy long exact candidate
  ├─ hit → 検索候補表示（resolutionRequired）
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

## 7. Provider 方針

日本語書籍の書誌正本は国立国会図書館サーチを第一providerとする。

検索対象は初期実装では `iss-ndl-opac-national`（国立国会図書館全国書誌情報）へ限定する。

検索候補はNDL OpenSearch、詳細情報はNDL SRU / DC-NDL v3を利用する。provider固有XMLはintegration layerで正規化し、UI/domainへ直接漏らさない。

NDL由来情報を表示するUIでは全国書誌情報利用のクレジットを表示する。

表紙はNDL書影APIへ依存しない。取得できるISBNについてopenBDの書影をbest-effortで利用するが、openBD由来表紙をStudyPlanner共有Firestoreの永続書誌正本へ保存しない。

Amazonランキングは書誌providerとして利用しない。人気教材の発見・漏れ監査だけに利用し、Amazonの商品情報・ランキング順位をStudyPlanner共有書誌正本へコピーしない。

## 8. 共有書誌カタログ

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
- Amazonランキング順位/価格/レビュー値
- ユーザーの教科
- 現在進捗
- 目標日
- 学習速度
- ユーザー独自教材

共有catalog writeはserver-side integrationだけが行う。

## 9. StudyPlanner側の責務

外部書誌が提供するページ数や目次は「本の事実」であり、「どう学習するか」の決定ではない。

そのためページ数を取得しても、自動で `総量 = ページ数` にしない。ユーザーが「ページ数をペース管理に使う」を選んだ場合のみ反映する。

例:

- 一般参考書 → ページ管理が適切な場合がある
- 金のフレーズ → ページより単語数での管理が自然
- 問題集 → ページより問題数が自然な場合がある

目次が取得できた場合は教材内構造の初期項目として使えるが、ユーザーは後から編集・非表示にできる。

## 10. Security / failure isolation

- curated/discovery seedはrepository同梱read-onlyデータとする
- browserから共有catalogへwriteさせない
- external metadata endpointはFirebase認証済みユーザーのみ利用可能
- request body/query lengthを制限する
- provider障害は教材検索だけを失敗させ、手入力登録を壊さない
- high-confidence curated hitではWorker / NDLを呼ばず候補表示できる
- discovery hitは候補表示後、選択時に書誌解決を試みる
- ISBN / shared exact-title cache hitではNDL OpenSearchを再度呼ばない

## 11. UI要件

検索結果カードは取得済み範囲で次を表示する。

- 表紙またはplaceholder
- 教材名/検索identity
- 教科hint / 教材種別
- 著者
- 出版社
- 版
- 出版年
- ページ数
- ISBN

`resolutionRequired` の候補は「検索候補・選択後に実在する版とISBNを確認」と明示し、高信頼curated候補と同じ確度に見せない。

シリーズaliasが複数冊へ対応する場合は複数カードを表示し、ユーザーに選択させる。

## 12. Acceptance criteria

- 初期検索インデックスが1000件以上ある
- curated coreが300件以上ある
- seed idが重複しない
- 12以上のsubject/category領域を初期カバーする
- Amazon人気監査で不足していた主要教材がcurated coreへ追加されている
- `金フレ` が外部APIなしで正式候補へ解決する
- `Distinction 2000` 等の人気教材がbuilt-inで検索できる
- `ターゲット 1900` の空白差を吸収する
- `青チャート` がI+A / II+B+C / III+Cの複数候補を返す
- `現代文ポラリス` 等のシリーズ名が具体的な複数レベルを返す
- `東京大学 赤本`、`英検準1級 過去6回全問題集` 等の広域候補が `resolutionRequired` として検索できる
- `微分` や `関正生` を教材として即確定しない
- ISBNと未知タイトルは共有catalog/providerへフォールスルーする
- provider障害でも手入力登録できる
- TypeScript / unit / browser regression / UI quality / UI regression / production buildを通す

## 13. Deferred

- Amazonランキングの定期自動監査（規約に沿う正式API/許諾経路を確保した場合のみ）
- カメラISBNバーコード読み取り
- `StudyMaterial.catalogEntryId` のクラウド永続リンク
- 共有aliasの利用実績ベース学習
- 登録者数ランキング
- 共有章構造のクラウド正本化
- 論文 / YouTube / Web / Drive provider
