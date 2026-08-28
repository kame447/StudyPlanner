# 教材メタデータ取得 要件

Status: canonical product/integration requirement
Updated: 2026-08-28
Owning Issue: [#187](https://github.com/kame447/StudyPlanner/issues/187)

## 1. 目的

教材登録時の手入力を減らしつつ、外部APIの利用料・利用規約・障害へStudyPlannerの主要導線を依存させない。

初期対象はISBNを持つ一般書籍・参考書・問題集等とする。論文、動画、Web教材、Drive fileは別providerとして後続する。

## 2. ユーザー要件

教材追加画面では次を満たす。

- ISBNまたは教材名から既存の本を検索できる。
- 検索候補から選択すると教材名へ反映できる。
- 検索を使わず、従来どおり手入力だけでも保存できる。
- 外部API障害、共有カタログ障害、検索結果なしでも手入力導線を失わない。
- 検索候補を選んでも、教科、進捗単位、総量、現在位置、目標日等は自動決定しない。
- 表紙画像は当面ユーザーが自分で設定する。書誌APIの画像利用条件と混ぜない。
- NDL由来候補を表示する箇所では、国立国会図書館全国書誌情報を利用していることを利用者が確認できる。

## 3. 初期アーキテクチャ

```text
教材追加画面
  ↓ ISBN / 教材名
MaterialMetadata API
  ↓
共有教材カタログ
  ├─ hit → normalized candidate
  └─ miss
       ↓
    NDL Search
       ↓
 normalized candidate
       ↓
 ISBNを持つ候補だけ共有カタログへcache
       ↓
       UI
```

共有教材カタログはStudyplus型の「同じ本を毎回外部APIへ問い合わせない」ための基盤として使う。ただし初期段階では外部書誌のcacheであり、StudyPlannerの教材そのものの正本ではない。

## 4. Provider 方針

初期providerは国立国会図書館サーチを使用する。

理由:

- 日本国内の書籍との適合性が高い。
- API keyを要求しない。
- 国立国会図書館由来の書誌メタデータは利用条件が比較的明確である。
- Google Books等の有料化・利用規約をStudyPlannerの必須依存へ持ち込まなくてよい。

NDL Searchは複数機関のデータを横断して提供するため、初期実装では検索対象を `dpid=iss-ndl-opac-national`、すなわち「国立国会図書館全国書誌情報」に限定する。2026-08-28時点の公式provider一覧では、このデータは検索API利用可・営利利用可・CC BYとして案内されている。

他providerのデータを同じ条件だとみなしてcacheしてはならない。将来検索対象を拡張する場合は、providerごとに利用条件、保存可否、表示上のクレジット要件を再確認する。

NDL由来の候補を利用者へ表示する場合は「国立国会図書館全国書誌情報を利用」のクレジットを表示する。ライセンス要件が変更された場合は、実装より先にこの正仕様とprovider adapterを更新する。

provider名、query形式、XML形式はintegration layerの外へ漏らさない。

## 5. 共有カタログ

初期共有カタログはISBNを安定IDとして扱う。

保存対象:

- internal catalog entry id
- title
- authors
- publisher
- published year
- ISBN-10 / ISBN-13
- normalized title
- integration内部のprovenance / cache timestamp

保存しないもの:

- provider raw response
- providerのXML全文
- ユーザーの教科
- 学習進捗
- 章・節構造
- 目標日
- 学習速度
- ユーザー独自教材

ユーザー独自教材を共有カタログへ自動投稿しない。共有カタログの書き込みはserver-side integrationからのみ行う。

## 6. Cache / lookup

ISBN検索:

1. 共有カタログをISBNで確認する。
2. hitなら外部APIを呼ばない。
3. missならNDL Searchへ問い合わせる。
4. ISBNを持つnormalized candidateを共有カタログへcacheする。

タイトル検索:

1. normalized titleの完全一致を共有カタログから確認する。
2. hitなら外部APIを呼ばない。
3. missならNDL Searchへ問い合わせる。
4. ISBNを持つ結果のみcacheする。

部分一致・別名・人気順ランキング等の独自検索は初期対象外とする。

## 7. 責務境界

外部書誌が所有するのは「その本が何か」という候補情報までとする。

StudyPlannerが所有するもの:

- ユーザーが教材として登録するかどうか
- 教科
- aliases
- 進捗単位
- 総量
- 現在位置
- 章・節構造
- 学習速度
- 目標日
- スケジューリング

外部書誌のページ数や目次等が将来取得できても、それを自動的に学習総量や章構造の正本にしない。

## 8. Security / abuse

- 検索APIはFirebase認証済みユーザーのみ利用可能とする。
- browserからNDLへ直接依存せず、StudyPlanner workerでprovider boundaryを持つ。
- 共有カタログはbrowserから直接writeさせない。
- workerのservice account経由でcacheする。
- request bodyとquery lengthを制限する。
- NDL OpenSearchの検索対象providerは初期実装では全国書誌情報へ固定する。
- provider障害時は502等で検索だけを失敗させ、教材保存導線を壊さない。

## 9. 初期実装範囲

今回実装する:

- normalized material metadata contract
- authenticated worker endpoint
- NDL OpenSearch adapter
- 全国書誌情報に限定したNDL検索
- ISBN / exact normalized title shared cache
- 教材追加画面の任意検索UI
- 候補タイトルの教材名への反映
- NDL書誌利用のクレジット表示
- unit tests

今回実装しない:

- カメラによるISBNバーコード読み取り
- remote cover image取得
- StudyMaterialへのcatalogEntryId永続リンク
- shared aliases
- 人気順・登録者数ランキング
- 章・節構造DB
- Open Library fallback
- 論文 / YouTube / Web / Drive provider

`StudyMaterial`へのcatalog identity永続化は、検索導線が安定した後の次段階で行う。初期実装で既存の教材保存schemaを不用意に広げない。

## 10. Acceptance criteria

- ISBNまたは2文字以上の教材名で検索できる。
- NDL検索は `iss-ndl-opac-national` に限定される。
- ISBNの共有catalog hitでは外部providerを呼ばない設計になっている。
- exact titleの共有catalog hitでは外部providerを呼ばない設計になっている。
- provider responseはnormalized candidateへ変換される。
- ISBNを持たない結果は初期書籍catalogへ保存しない。
- UIは検索失敗時にも手入力可能である。
- 検索候補選択は教材名のみへ反映し、進捗設定を自動変更しない。
- NDL由来候補を表示するUIに全国書誌情報利用のクレジットがある。
- runtime code/tests/buildがgreenである。
