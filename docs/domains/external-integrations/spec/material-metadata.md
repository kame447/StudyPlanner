# 教材メタデータ取得 要件

Status: canonical product/integration requirement
Updated: 2026-08-28
Owning Issue: [#187](https://github.com/kame447/StudyPlanner/issues/187)

## 1. 目的

教材登録時にユーザーへ「本の情報を一から入力させる」状態を減らし、教材を選んだ時点で表紙、正式名称、著者、出版社、版、総ページ数、取得可能な目次を確認できる状態を目指す。

外部APIをStudyPlannerの正本にはしない。StudyPlannerは内部の教材候補と共有書誌カタログを優先し、外部providerは不足情報を補完するために使用する。

初期対象はISBNを持つ一般書籍・参考書・問題集等とする。論文、動画、Web教材、Drive file等は別providerとして後続する。

## 2. ユーザー体験

教材追加画面は次の流れを基本とする。

```text
教材を追加
  ↓
ISBN / 教材名で検索
  ↓
候補カード
  ├─ 表紙（取得できる場合）
  ├─ 正式名称
  ├─ 著者
  ├─ 出版社
  ├─ 版
  └─ ISBN
  ↓ 候補を選択
詳細補完
  ├─ 総ページ数
  ├─ 目次 / 教材構成
  └─ 表紙
  ↓
登録内容を確認
  ├─ 教科
  ├─ ペース管理
  ├─ 現在位置
  └─ 目標日
  ↓
保存
```

検索を使わず、従来どおり手入力だけでも登録できる。検索結果なし、共有カタログ障害、NDL障害、表紙provider障害のいずれでも手入力導線を失わない。

## 3. 検索アーキテクチャ

```text
ISBN / 教材名
  ↓
StudyPlanner内蔵教材候補
  ├─ 正規化完全一致 → 即時候補
  └─ miss / 曖昧入力
       ↓
MaterialMetadata Worker
  ↓
共有書誌カタログ
  ├─ hit
  └─ miss
       ↓
NDL OpenSearch
  ↓
normalized candidate
  ↓
ISBNを持つNDL書誌を共有カタログへcache
```

内蔵教材候補には `src/data/naturalLanguageCatalog.json` をread-only snapshotとして再利用する。これは過去の `app_catalogs/natural_language_v1` をseedする元データでもあったが、旧Firestore documentそのものは教材検索の正本として使用しない。

既存カタログには「青チャート」「Focus Gold」「ターゲット1900」等の教材名だけでなく一般的な学習語も含まれるため、初期版では正規化完全一致だけをlocal hitとして扱う。部分一致や曖昧入力で外部書誌検索を短絡しない。

## 4. 候補選択後の詳細補完

候補を選択した時点で、検索とは別の `/material-metadata/details` 経路から詳細を補完する。

```text
選択候補
  ↓ ISBNがある
NDL SRU
  recordSchema=dcndl_v3
  dpid=iss-ndl-opac-national
  ↓
版 / extent / tableOfContents
  ↓
StudyPlanner candidateへ正規化

並行して
ISBN
  ↓
openBD
  ↓
書影URL（取得できる場合だけ）
```

内蔵候補のように初期候補がISBNを持たない場合は、選択時だけ候補タイトルをWorkerへ渡して共有カタログ / NDLで正式書誌を再解決する。これにより、内蔵検索の即応性と登録時の詳細情報を両立する。

## 5. NDLの責務

初期の書誌正本providerは国立国会図書館サーチとする。

検索対象は `dpid=iss-ndl-opac-national`、すなわち国立国会図書館全国書誌情報に限定する。

OpenSearchから取得する主な項目:

- title
- authors / creators
- publisher
- published year
- ISBN-10 / ISBN-13

候補選択後のSRU / DC-NDL v3から取得する主な項目:

- edition
- extentから判定できる総ページ数
- dcterms:tableOfContentsから取得できる目次

NDL由来のnormalized metadataは共有書誌カタログへ保存できる。raw XMLは保存しない。

NDL由来候補を表示するUIでは、国立国会図書館全国書誌情報を利用していることを利用者が確認できるようにする。

## 6. 表紙providerの責務

NDLの旧書影APIへ依存しない。

初期実装ではopenBDを表紙のbest-effort providerとしてのみ利用する。openBD由来情報を共有書誌カタログの正本へ昇格させない。

理由:

- openBDは書影を取得できる一方、利用目的が本の販促・紹介目的に限定される。
- データの変更・削除があり得る。
- キャッシュ時には変更反映・削除対応が必要になる。

したがって初期実装ではopenBDの画像データそのものを共有Firestoreへcacheしない。検索・詳細取得時に利用できる書影URLだけを候補へ一時的に付与する。

表紙取得に失敗しても教材登録は失敗させない。ユーザー自身の画像アップロードを常に利用可能にする。

## 7. 共有書誌カタログ

共有書誌カタログは「同じ本を毎回外部APIへ問い合わせない」ためのStudyPlanner内部基盤である。

初期共有カタログはISBNを安定IDとして扱う。

保存対象:

- internal catalog entry id
- title
- authors
- publisher
- published year
- edition
- ISBN-10 / ISBN-13
- normalized title
- page count（NDLから取得できた場合）
- table of contents（NDLから取得できた場合）
- integration内部のprovenance / cache timestamp

保存しないもの:

- provider raw response / XML
- openBDの画像バイナリ
- ユーザーの教科
- 学習進捗
- 目標日
- 学習速度
- ユーザー独自教材

ユーザー独自教材を共有書誌カタログへ自動投稿しない。共有書誌カタログへのwriteはserver-side integrationのみが担当する。

## 8. 書誌ページ数と学習総量を分離する

書誌上のページ数が取得できても、それを自動的にStudyPlannerの学習総量へ決定しない。

例:

- 一般参考書では `381ページ` をそのままページ単位の総量に使える場合がある。
- 金のフレーズのような単語帳では、書誌上のページ数より `1000語` の方が学習管理単位として自然な場合がある。
- 問題集では問題数・例題数を単位にした方が自然な場合がある。

初期UIでは書誌上のページ数を表示し、「ページ数をペース管理に使う」をユーザーが1タップで選択できる。勝手に進捗単位を変更しない。

将来、StudyPlanner独自の教材知識として推奨進捗単位・総問題数等を共有教材identityへ追加する。

## 9. 目次と教材内構造

NDLから目次を取得できた場合、教材登録時に内容をプレビューする。

ユーザーが保存すると、取得した目次を既存の「教材内構造」の初期項目として利用する。ユーザーは後から非表示・編集でき、構造を使わず教材全体だけで管理することもできる。

2026-08-28時点の初期実装では、既存の教材内構造機能がlocal preferenceとして実装されているため、自動投入された構造もまず同じ保存経路へ入る。共有教材identityとの永続リンクおよびcloud-synced構造への昇格は次段階とする。

教材本文のページ画像・本文そのものは共有書誌メタデータとして取得・保存しない。必要な場合は将来、ユーザーが所有する教材の目次撮影 / OCRを別機能として扱う。

## 10. 現在の登録UI

初期実装では既存の教材追加sheetを拡張する。

1. ISBN / 教材名検索
2. 表紙付き候補カード（取得できる場合）
3. 候補選択時に詳細取得
4. 選択した教材情報カードを表示
5. ページ数・目次を確認
6. ページ数を必要ならペース管理へ1タップ反映
7. 教科・現在位置・目標日等を確認
8. 保存

完全な独自教材は検索を使わず手入力できる。

カメラによるISBNバーコード読み取りは次段階とする。

## 11. Security / failure isolation

- 内蔵教材候補はbundled snapshotをread-onlyで扱う。
- 旧 `app_catalogs/natural_language_v1` は教材検索のsource of truthにしない。
- 外部検索APIはFirebase認証済みユーザーのみ利用可能とする。
- browserからNDLへ直接依存しない。
- 共有書誌カタログはbrowserから直接writeさせない。
- Workerのservice account経由でcacheする。
- request body / query lengthを制限する。
- NDL検索対象providerは全国書誌情報へ固定する。
- openBD failureは表紙なしへdegradeし、検索自体を失敗させない。
- NDL詳細取得failureは基本書誌候補へdegradeし、教材登録を失敗させない。
- 外部検索全体が失敗しても手入力保存は継続できる。

## 12. 今回の実装範囲

実装する:

- bundled教材候補の完全一致検索
- authenticated material metadata Worker
- NDL OpenSearch検索
- NDL SRU / DC-NDL v3詳細補完
- ISBN / normalized-title shared cache
- edition / page count / table of contents normalization
- openBD書影のbest-effort補完
- 表紙付き検索候補UI
- 選択後の詳細情報プレビュー
- ページ数の任意ペース反映
- 目次の既存教材内構造への初期投入
- manual registration fallback
- unit / browser regression tests

今回まだ実装しない:

- camera ISBN barcode scanning
- `StudyMaterial.catalogEntryId` の正式な永続リンク
- cloud-synced shared chapter / section model
- StudyPlanner独自の教材別推奨進捗単位DB
- shared aliases / registration counts / ranking
- 目次撮影OCR
- cover providerの多段fallback
- paper / YouTube / web / Drive providers

## 13. Acceptance criteria

- ISBNまたは2文字以上の教材名で検索できる。
- `青チャート` 等の既知教材名はbundled候補として即時検索できる。
- 部分一致・曖昧な内蔵候補で外部検索を誤って短絡しない。
- 候補選択時にISBNが判明すればNDL SRU / DC-NDL v3で詳細補完できる。
- NDL詳細からedition、page count、table of contentsを取得できるデータではnormalized candidateへ反映する。
- 表紙providerが利用できる場合は候補 / 登録画面で表紙を確認できる。
- openBDの書影情報を共有書誌カタログへcacheしない。
- 書誌上のページ数を自動的な学習総量として強制しない。
- ユーザー操作でページ数をページ単位総量へ反映できる。
- 取得した目次は教材内構造の初期値として利用でき、後から非表示・編集できる。
- NDL由来情報のUIに全国書誌情報利用のクレジットがある。
- provider failureでも手入力登録を継続できる。
- runtime code / tests / production build / browser regressionがgreenである。
