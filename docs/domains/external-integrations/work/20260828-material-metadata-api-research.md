# 教材メタデータAPI調査

Status: active research record
Updated: 2026-08-28
Owning Issue: [#187](https://github.com/kame447/StudyPlanner/issues/187)

## 目的

Issue #187で挙げた外部API候補のうち、教材登録と教材タイプ拡張に直接関係するものだけを公式仕様・公式利用条件から再評価する。

今回の対象は書籍、論文、動画、Web教材、ユーザー所有ファイルである。祝日、Google Calendar、WakaTime、GitHub activityなど、教材メタデータ取得そのものではない連携は対象外とする。

この調査ではruntime codeを実装しない。採用順と責務境界を決め、次の実装PRでproviderを安全に実装できる状態にする。

## 現在のStudyPlannerとの接続点

現在の`StudyMaterial`は、教材名、科目、表紙、別名、進捗単位、総量、現在位置、目標日、1単位あたりの見積時間などを保持する。一方、ISBN、著者、出版社、出版日などの一般書誌情報はまだ永続modelに存在しない。

したがって外部API導入時に、返却された書誌responseをそのまま`StudyMaterial`へ保存することはしない。検索候補をnormalized DTOへ変換し、ユーザーが候補を確認した後、StudyPlannerが必要とする最小限の情報だけを保存する。

外部API障害、quota超過、検索結果なしの場合でも、現在の手入力による教材登録は常に利用可能でなければならない。

## 評価観点

候補APIは同じ概念レベルで、次の観点から比較する。

- 日本語教材・一般書籍・学術資料など対象資料への適合性
- タイトル、著者、出版社、ISBN、ページ数、表紙など取得可能項目
- タイトル検索とISBN検索の可否
- authentication / API key / OAuth
- quota、rate limit、production利用時の制約
- 商用利用、有料アプリ、表示義務、保存・cache、画像利用の条件
- provider停止時のfallbackの作りやすさ
- StudyPlanner内部へprovider固有仕様を漏らさずadapter化できるか

## 書籍API

### 国立国会図書館サーチ API

判定: 日本語の紙書籍・教材について第一候補。

国立国会図書館サーチはSRU、OpenSearch、OpenURLによる検索APIを提供している。現在の外部提供インタフェース仕様は第1.4版、2026-03-31更新である。SRU等から国立国会図書館サーチの書誌メタデータを検索でき、書籍を対象に絞ることもできる。

日本国内で出版された書籍を教材登録する用途との適合性が高く、ISBNやタイトルを入口に、日本語の書誌情報を取得するprimary provider候補とする。

利用条件はデータプロバイダごとに異なるため、「NDL Search全体の結果なら何でも同じ条件で保存できる」と扱ってはいけない。公式のAPI提供対象データプロバイダ一覧には、営利・非営利それぞれの利用可否とライセンスが明示されている。実装時は利用条件が明確な国立国会図書館由来の書誌データ、またはopen dataとして提供される範囲にprovider queryを限定する方針を優先する。

検索APIの返却はDC-NDL等を基礎としたXMLであり、Google BooksのJSONよりadapter実装は少し重い。ただしこれはintegration layer内で吸収できる技術的コストであり、日本語教材への適合性と利用条件の明確さを優先する。

表紙画像は書誌メタデータと別の責務として扱う。NDLのThumbnail APIは別条件があるため、BookMetadataProviderを採用しただけで表紙利用まで許可されたとみなさない。

公式資料:

- https://ndlsearch.ndl.go.jp/help/api/specifications
- https://ndlsearch.ndl.go.jp/help/api
- https://ndlsearch.ndl.go.jp/en/help/api/provider
- https://ndlsearch.ndl.go.jp/metadata_in_ndlsearch

### Google Books API

判定: 機能面は強いが、現時点ではprimary providerにしない。利用条件を解決した場合のglobal secondary候補。

Volumes APIはタイトル検索を行え、title、subtitle、authors、publisher、publishedDate、ISBN等のindustryIdentifiers、pageCount、categories、imageLinks、languageなどをJSONで取得できる。公開データへのrequestにもAPI key等の識別子が必要である。

StudyPlannerとの技術的な相性は良い。特にJSON、ページ数、ISBN、複数サイズの画像URLを一度に取得できる点は実装しやすい。

一方、Google Books API固有の利用規約には、Googleとの別契約または書面許可がない限り、アプリケーションの使用料をユーザーへ請求できないという条項が現在も掲載されている。StudyPlannerが将来有料プランを持つ可能性を考えると、このAPIを教材登録の中核依存にするとproduct monetizationへ制約を持ち込む。

そのため、無料運用を前提に安易にprimary providerへ固定しない。実装前に「StudyPlannerの課金形態でこの条項がどう適用されるか」を確認し、条件が解消した場合のみsecondary providerとして採用する。

公式資料:

- https://developers.google.com/books/docs/v1/reference/volumes
- https://developers.google.com/books/docs/v1/reference/volumes/list
- https://developers.google.com/books/docs/v1/using
- https://developers.google.com/books/terms

### Open Library

判定: global fallback候補。低頻度のユーザー起点検索に限定する。

Open Libraryは書籍・著者のpublic APIを提供し、書籍検索やISBN lookupに利用できる。教育・図書探索などhuman-facingな低頻度利用を想定しており、2026年時点の公式usage guidelineでは、第三者サービスの高トラフィックbackendとして使うことを想定していない。

rate limitは通常1 request/second、アプリ名と連絡先をUser-Agent等で明示するidentified requestは3 requests/secondとされている。教材追加時にユーザーが検索する程度なら適合するが、全教材を継続同期するbackendにはしない。

Open Libraryはデータベース全体にInternet Archive自身が新たな権利を主張しないとしている一方、個別contributionやjurisdictionに既存権利があり得ることも明記している。metadataとcoverを一括して無制限に永続利用できると決め打ちせず、必要な項目だけを取得する。

第一候補の日本語書誌providerで見つからない海外書籍などに対するfallbackとして位置付ける。

公式資料:

- https://openlibrary.org/developers/api
- https://openlibrary.org/developers
- https://openlibrary.org/developers/licensing
- https://openlibrary.org/data

### openBD

判定: 現時点では採用しない。

openBDは日本語書籍向けとして非常に魅力的で、書誌、書影、ページ数、出版社情報、内容紹介や目次等を提供できる。

しかし公式利用規約は、書誌・書影・内容紹介・書評情報などを「本の販促・紹介目的」に限って使用できるとしている。また、取得データを任意に改変しないこと、cacheする場合は変更をできるだけ早く反映すること、削除要請へ従うことを求めている。

StudyPlannerの主目的は書籍販売や紹介ではなく、ユーザー自身の学習教材として登録し進捗・予定へ利用することである。目的適合性が曖昧な状態で採用しない。将来、運営主体へ利用目的を提示して明示的に確認できた場合のみ再評価する。

公式資料:

- https://openbd.jp/
- https://openbd.jp/spec/
- https://openbd.jp/terms/

### Rakuten Books API

判定: StudyPlannerの教材メタデータproviderとしては採用しない。

Books Book Search APIはタイトル、著者、出版社、ISBN等から楽天ブックスの商品情報を検索でき、日本語書籍のretail coverageは魅力的である。

一方、楽天ウェブサービスの利用規約は、Web Serviceを使用した部分から楽天サイトへのlinkを要求し、明示許可がない限り特定の人だけがアクセスできる環境での利用を禁止している。また、楽天アフィリエイト以外の方法でWeb Serviceを利用して収入を得ることや、取得情報の用途・保存等にも制約がある。

StudyPlannerは認証された個人ユーザーが自分の教材を管理するアプリであり、この利用形態と規約の相性が悪い。商品購入導線を主目的としないため、書誌情報providerへ採用しない。

公式資料:

- https://webservice.rakuten.co.jp/documentation
- https://webservice.rakuten.co.jp/guide
- https://webservice.rakuten.co.jp/guide/rule

## 学術資料API

### OpenAlex

判定: 論文を教材として扱う段階で有力。書籍providerとは分離する。

OpenAlexはworks、authors、sources、institutions、topics等を検索できる。2026年8月時点ではusage-based pricingへ移行しており、無料API keyには1日$1相当のusage budgetが付く。keyなしでも試用できるが、production scaleではfree API keyを使う前提で設計する方がよい。

single entityのID/DOI取得は無料、list/filterは1,000 callsあたり$0.10、full-text searchは1,000 callsあたり$1という現在の料金体系が示されている。料金やbudgetは変更可能性が高いため、値をdomain contractへ埋め込まずprovider configuration / operational documentationとして扱う。

OpenAlexは教科書検索へ混ぜず、将来の`AcademicWorkMetadataProvider`候補とする。

公式資料:

- https://help.openalex.org/api/
- https://help.openalex.org/api/authentication/
- https://help.openalex.org/access/pricing/
- https://help.openalex.org/access/example-costs/

### Crossref

判定: OpenAlexの補完、DOI中心の検証provider候補。

Crossref REST APIは登録なしでpublic accessでき、`mailto`やUser-Agentを付けるpolite accessが推奨されている。DOIを中心としたpublication metadataの確認に向く。

2025年12月からrate limitが改定されているため、固定の昔のrate assumptionを実装へ持ち込まない。response headerを尊重し、429時のbackoffとcacheを持つ。

役割は「論文探索そのもの」より、DOIを持つ候補のbibliographic verification / complementとする。

公式資料:

- https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/
- https://www.crossref.org/blog/announcing-changes-to-rest-api-rate-limits/

## 動画教材

### YouTube Data API

判定: YouTube URLを教材として登録する機能を実装するときの候補。初期の書籍検索とは分離する。

`videos.list`からtitle、channel、description、thumbnail、duration等を取得できる。`videos.list`は1 callあたりquota cost 1 unitである。2026年にはYouTube Data APIのquota体系が一部granular quotaへ移行しているため、古い「全method共通の10,000 unitだけ」という前提を固定しない。

ユーザーが貼ったYouTube URLからvideo IDを抽出し、`videos.list`でmetadataを取得する用途なら比較的軽い。検索そのものを大量に行う機能とは分ける。

動画時間を何回の学習sessionへ分けるかはYouTube APIではなくStudyPlannerのdomain側が決める。

公式資料:

- https://developers.google.com/youtube/v3/docs/videos/list
- https://developers.google.com/youtube/v3/docs/videos
- https://developers.google.com/youtube/v3/getting-started

## Web教材

判定: URL登録時は、まずOpen Graph / HTML metadataの自前取得を検討する。

Webページのtitle、description、thumbnail、site name程度であれば、最初からMicrolink等の外部SaaSを追加する必要性は低い。server-side fetchのsecurity boundary、SSRF対策、timeout、content-type、response size上限を用意した上で、自前取得とSaaS利用を比較する。

この領域は第三者ページの本文を学習内容として自動保存する責務ではない。まずはURLの表示用metadata取得に限定する。

## Google Drive上のPDF・講義資料

判定: 将来候補。書誌検索APIではなく、ユーザー所有ファイルを選択するimport integrationとして分離する。

Google Drive APIはfile metadataを取得できるが、ユーザーファイルへアクセスするためOAuth scopeが必要になる。`drive.readonly`等は広い権限を持ち、scopeによってはverification / security assessmentが必要になる。

実装する場合は、可能な限りユーザーがStudyPlannerで明示的に選んだファイルだけへアクセスできる権限モデルを優先する。Drive全体の同期を教材登録MVPへ持ち込まない。

公式資料:

- https://developers.google.com/identity/protocols/oauth2/scopes#drive
- https://developers.google.com/workspace/drive/api/guides/about-sdk

## 採用方針

初期の「書籍を検索して教材登録を楽にする」機能では、次の順序へ見直す。

```text
Japanese printed books
  NDL Search
      ↓ not found / global book
  Open Library
      ↓ optional only after terms decision
  Google Books

Manual registration
  always available
```

Google BooksをIssue #187で仮置きしていたprimaryから外す主因は機能不足ではなく、将来の有料化へ影響し得る利用規約である。openBDとRakuten Booksは日本語書籍データが強いが、StudyPlannerの利用目的・認証型アプリとの規約適合性が弱いため初期採用しない。

論文、動画、Webページ、Drive fileは書籍と同じprovider chainへ混ぜない。material typeごとにintegration interfaceを分離する。

## 推奨内部境界

書籍については、UIや`StudyMaterial`がNDL等の固有responseを知る構造にしない。

概念上は次の境界を置く。

```text
BookMetadataProvider
  search(query / isbn)
      ↓
BookMetadataCandidate[]
  title
  subtitle?
  authors[]
  publisher?
  publishedDate?
  isbn10?
  isbn13?
  pageCount?
  language?
  source
  sourceRecordId
  coverCandidates[]
      ↓ user review
StudyMaterialDraft mapping
```

`BookMetadataCandidate`はintegration DTOであり、外部responseの完全コピーではない。providerごとの不要fieldや販売情報を内部domainへ持ち込まない。

表紙画像はmetadataから独立したcapabilityとして扱えるようにする。metadata sourceとcover sourceが同じである必要はない。画像のhotlink、cache、永続保存は各providerの条件を個別に確認する。

検索候補は自動確定しない。同名書籍、版違い、改訂版があるため、タイトル・著者・出版社・出版日・ISBN等を表示し、ユーザーが選択してから教材へ保存する。

## 章・節・目次との境界

書誌APIが返すページ数や一部の目次情報を、StudyPlanner教材構造の正本にしない。

```text
bibliographic metadata
  external book / academic API

material learning structure
  user input
  OCR / document analysis
  future StudyPlanner material database
```

章・節が不要な教材も登録できる現在の方針を維持する。外部APIで目次が取得できる場合でもoptional suggestionとし、階層構造を必須にしない。

## 次の実装単位

この調査をmergeした後、書籍教材登録の実装を行う場合は、まずNDL Searchだけで小さなvertical sliceを作る。

対象は「教材追加でタイトルまたはISBNを検索 → normalized候補表示 → ユーザー選択 →既存の教材登録へ反映」までとする。provider failure時は即座に手入力へ戻れるようにする。

Open Library fallbackはprimary adapterのcontractが固まった後に追加する。Google Booksは利用条件のproduct decisionが解決するまでruntime dependencyへ入れない。論文・YouTube・Driveはbook lookupと同じPRへ混ぜない。

## この調査PRの完了条件

- 教材関連候補だけを公式資料から再評価している
- 書籍providerの初期採用順が説明できる
- Google Books、openBD、Rakuten Booksの利用条件上のriskを明示している
- academic / video / web / Driveをbook providerから分離している
- current `StudyMaterial`とのdata gapを確認している
- raw external responseをdomain modelへ直接保存しない境界を定義している
- manual registrationを外部API failure時のfallbackとして維持している
- runtime codeや永続schemaはこのPRでは変更していない
