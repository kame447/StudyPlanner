# Repository regression patterns

Status: current repository-wide regression knowledge
Updated: 2026-08-30

この文書は、StudyPlanner で過去に発生したバグや回帰を、個別症状の一覧ではなく、再発する原因クラス、責任境界、守るべき不変条件、検証方法として形式知化するための正本です。

この文書は各機能の仕様書を置き換えません。現在の挙動契約は必ず owning domain の canonical document を優先します。週間計画の具体的な契約は [`../domains/weekly-planning/`](../domains/weekly-planning/README.md)、client/server authority は [`../domains/client-runtime/`](../domains/client-runtime/README.md)、観測・集計は [`../domains/product-observability/`](../domains/product-observability/README.md) が owner です。GitHub、CI、connector、Actions などの運用障害と安全な回避策は [`tooling-operations-runbook.md`](tooling-operations-runbook.md) を owner とし、この文書では product/runtime defect と区別するために必要な境界だけを扱います。

## 監査範囲と読み方

2026-08-30 時点でリポジトリから取得できる PR 履歴を、作成順と逆順の両方向から横断監査しました。対象母集団には feature、refactor、test、docs、Dependabot も含め、PR #1 から #241 までの履歴に現れる defect、regression、post-merge audit finding、real-device finding、harness failure を確認しました。純粋な機能追加や依存更新は、それ自体をバグ知識として昇格していません。

再発性は厳密な件数統計ではなく、PR 横断で同じ根本原因がどれだけ独立に再出現したかを表す定性的な指標です。一つの PR が複数のバグを直す場合も、一つの logical task が複数の follow-up PR にまたがる場合もあるため、PR 件数をそのまま発生率として解釈しません。`非常に高い` は複数サブシステムや多数の follow-up で繰り返したもの、`高い` は複数 PR で明確に再発したもの、`反復あり` は少なくとも二つ以上の独立した証拠があるものです。

新しいバグを調査するときは、まず症状をこの文書の既知パターンへ当てはめます。ただし、似た症状だから同じ原因だと決めつけてはいけません。代表 PR と現在の owner contract を確認し、再現テストや trace、実機 evidence で原因を反証可能にしてから修正します。既知パターンに属する場合は、局所パッチよりそのパターンの invariant が壊れた地点を優先して直します。

## R1. Semantic / state authority drift

重要度: Critical。再発性: 非常に高い。

代表 evidence: [#3](https://github.com/kame447/StudyPlanner/pull/3), [#68](https://github.com/kame447/StudyPlanner/pull/68), [#107](https://github.com/kame447/StudyPlanner/pull/107), [#109](https://github.com/kame447/StudyPlanner/pull/109), [#154](https://github.com/kame447/StudyPlanner/pull/154), [#157](https://github.com/kame447/StudyPlanner/pull/157), [#196](https://github.com/kame447/StudyPlanner/pull/196), [#204](https://github.com/kame447/StudyPlanner/pull/204), [#222](https://github.com/kame447/StudyPlanner/pull/222), [#225](https://github.com/kame447/StudyPlanner/pull/225), [#235](https://github.com/kame447/StudyPlanner/pull/235)。

最も危険な再発パターンは、同じ意味や状態を複数の層がそれぞれ「正しいもの」として再構成することです。過去には、AI が解釈した期間を deterministic parser が再解釈する、renderer が出した日本語から pending question を逆算する、semantic/compiler が解決した temporal facts を scheduler placement が raw graph から再解釈する、全期間の preview model より現在表示中の 7 日だけを保存対象として扱う、active timetable term を downstream へ渡さず別の文脈で候補を作る、といった形で現れました。

根本原因は、source of truth と projection、interpretation と execution、machine state と presentation の境界が曖昧になることです。表示上は同じ値に見えても、再解釈可能な raw input と canonical state は同じ責任を持ちません。

不変条件は、一つの概念には一つの authoritative owner を置き、下流はその owner が生成した typed/canonical representation を消費するだけにすることです。Stable V5 では raw language の意味解釈は AI、formal binding / lifecycle / readiness / scheduler / preview / approval / persistence は deterministic code が owner です。renderer の日本語、現在表示している page、read model、cache は projection であり、authoritative state へ逆流させません。

回帰テストでは、単一関数の出力だけでなく、owner が作った typed state が downstream で再解釈されず保持されることを検証します。architecture guard で raw semantic expression や rendered text が禁止された層へ入らないことも固定します。移行時に旧経路を削除するときは、旧経路が暗黙に担っていた semantic invariant を同等の typed contract が完全に引き継いだことを確認してから削除します。

## R2. Correction lifecycle と dependent state の残留

重要度: Critical。再発性: 高い。

代表 evidence: [#87](https://github.com/kame447/StudyPlanner/pull/87), [#88](https://github.com/kame447/StudyPlanner/pull/88), [#109](https://github.com/kame447/StudyPlanner/pull/109), [#146](https://github.com/kame447/StudyPlanner/pull/146), [#147](https://github.com/kame447/StudyPlanner/pull/147), [#149](https://github.com/kame447/StudyPlanner/pull/149), [#151](https://github.com/kame447/StudyPlanner/pull/151), [#157](https://github.com/kame447/StudyPlanner/pull/157), [#204](https://github.com/kame447/StudyPlanner/pull/204), [#235](https://github.com/kame447/StudyPlanner/pull/235)。

訂正や置換で parent fact だけを更新し、そこから導出された remaining work、effort、deadline、recurrence、uncertainty、preview、memory projection などが旧状態のまま残ると、表面上は訂正できたように見えても後段で古い値が復活します。planning window の新値を追加して旧値を active のまま残したケース、progress correction 後に stale derived remaining が残ったケース、workload replacement 時に依存 Fact の移行規則が effort だけ bespoke だったケースが典型です。

不変条件は、replace / remove / supersede / revoke / tombstone を一つの lifecycle transaction として扱い、依存状態を明示的な policy で carry、invalidate、rebind、reject のいずれかに分類することです。暗黙に「たぶん同じ対象だから引き継ぐ」と判断してはいけません。correction target は canonicalization 前に machine-addressable な public/local ID で解決可能でなければならず、free-text mention から deterministic code が対象を推測しません。

semantic repair も局所的でなければなりません。無効な correction reference を直すために、同じ turn で既に valid な task や別 clause を消してはいけません。repair budget が一回に制限される経路では、schema parse の最初のエラーだけで止まらず、machine-readable に同時検出できる independent invariant violation を最初の repair request へ集約します。

回帰では、訂正直後だけでなく、その後の readiness、scheduler、preview、save、reload まで旧値が復活しないことを確認します。100% 完了から 90% へ戻すような reversible correction、percentage から exact quantity への representation change、active window の複数残留など、derived state が再生成されるケースを含めます。

## R3. Typed dimension の混同と overloaded sentinel

重要度: Critical。再発性: 高い。

代表 evidence: [#140](https://github.com/kame447/StudyPlanner/pull/140), [#148](https://github.com/kame447/StudyPlanner/pull/148), [#150](https://github.com/kame447/StudyPlanner/pull/150), [#154](https://github.com/kame447/StudyPlanner/pull/154), [#157](https://github.com/kame447/StudyPlanner/pull/157), [#195](https://github.com/kame447/StudyPlanner/pull/195)。

「同じ workload に effort がある」という粗い判定で `duration_per_unit` と `session_duration` を同一視したり、`targetFactId = null` を「task がない」と「requested work がすべて完了」の両方に使ったり、`scope_total` と実際に schedule する remaining work を混同したりすると、型として区別できる情報を boolean や null へ潰した地点でバグが発生します。pending proposal の有無を全 workload 共通の状態として扱い、別 task の proposal まで抑止したケースも同じ構造です。

不変条件は、意味的に独立な軸を typed discriminant として残すことです。effort は measurement kind、progress は quantity role、pending question は target + requested measurement、missing work は reason、proposal は target scope を持ちます。`any exists`、単一 boolean、null で複数状態を表現しません。

検証では、同じ target に異なる measurement が同時に存在するケース、複数 sibling target があるケース、zero / absent / complete / unknown が分かれるケースを table-driven または property-based に生成し、独立軸が互いを上書きしないことを確認します。

## R4. Temporal reference context drift

重要度: Critical。再発性: 高い。

代表 evidence: [#24](https://github.com/kame447/StudyPlanner/pull/24), [#26](https://github.com/kame447/StudyPlanner/pull/26), [#99](https://github.com/kame447/StudyPlanner/pull/99), [#120](https://github.com/kame447/StudyPlanner/pull/120), [#199](https://github.com/kame447/StudyPlanner/pull/199), [#202](https://github.com/kame447/StudyPlanner/pull/202), [#204](https://github.com/kame447/StudyPlanner/pull/204), [#225](https://github.com/kame447/StudyPlanner/pull/225)。

`today`、`tomorrow`、`this_week`、`next_week`、曜日、計画 horizon、ユーザー設定の週開始曜日は、基準時刻を失うと下流で別の日付へ化けます。#202 では request date で一度正しく解決した hard bound を recurrence / final placement が horizon start を基準に再解決したため、一日ずれや week-start の喪失が起こりました。#204 では temporal meaning が horizon、distribution、placement に分散していたため、removed / superseded constraint の復活や sibling leakage まで生じ得る状態でした。

不変条件は、relative temporal semantics を owning boundary で一度だけ解決し、request clock、request date、timezone、weekStartsOn、target scope、hard/soft の区別を typed context として保持することです。scheduler は absolute/compiled constraint を実行し、raw temporal expression を再解釈しません。task-level constraint の component 継承と component-level constraint の sibling isolation は同じ target policy で扱います。hard bounds が矛盾するときは fail closed にします。

検証では、request date と horizon start が異なるケース、日曜開始など weekStartsOn が既定値と異なるケース、removed / superseded temporal fact、task→component inheritance、component sibling isolation、deadline と earliest/latest の矛盾、planning term 外の timetable event を必須にします。

## R5. Idempotency、revision、stale result、concurrency の境界不足

重要度: Critical。再発性: 高い。

代表 evidence: [#82](https://github.com/kame447/StudyPlanner/pull/82), [#88](https://github.com/kame447/StudyPlanner/pull/88), [#94](https://github.com/kame447/StudyPlanner/pull/94), [#96](https://github.com/kame447/StudyPlanner/pull/96), [#109](https://github.com/kame447/StudyPlanner/pull/109), [#119](https://github.com/kame447/StudyPlanner/pull/119), [#121](https://github.com/kame447/StudyPlanner/pull/121), [#220](https://github.com/kame447/StudyPlanner/pull/220), [#222](https://github.com/kame447/StudyPlanner/pull/222), [#235](https://github.com/kame447/StudyPlanner/pull/235)。

同じ request ID の再処理で AI、canonicalizer、scheduler、preview を再実行する、no-op turn で semantic revision を増やす一方 idempotency history は消える、reload 後に logical conversation の physical session が変わる、古い repair job が新しい dirty revision を clear する、archive 中に entry が増えたのに旧件数まで export 済みとして隠す、といったバグは、処理の「一回性」と「どの version に対する結果か」が machine contract に含まれていないときに発生します。

不変条件は、side effect より前に idempotency key を確認し、mutation / async result / repair / archive / approval を expected revision または expected count と結びつけることです。stale result は現在状態へ commit せず、duplicate request は expensive core executor を再実行しません。no-op は意味 state の revision を増やさなくても、dedupe history や authorization など別軸の durable workflow state を失わないようにします。

検証は double submit、retry、reload、repository/runtime recreation、cancel 後の遅延結果、stale expected revision、archive 中の追加 entry、same request ID を含む sequence test で行います。単発 unit test より、ordering を変えた stateful test が有効なパターンです。

## R6. Persistence / schema / restore / trace の end-to-end contract 欠落

重要度: Critical。再発性: 非常に高い。

代表 evidence: [#68](https://github.com/kame447/StudyPlanner/pull/68), [#70](https://github.com/kame447/StudyPlanner/pull/70), [#72](https://github.com/kame447/StudyPlanner/pull/72), [#82](https://github.com/kame447/StudyPlanner/pull/82), [#94](https://github.com/kame447/StudyPlanner/pull/94), [#95](https://github.com/kame447/StudyPlanner/pull/95), [#96](https://github.com/kame447/StudyPlanner/pull/96), [#104](https://github.com/kame447/StudyPlanner/pull/104), [#106](https://github.com/kame447/StudyPlanner/pull/106), [#110](https://github.com/kame447/StudyPlanner/pull/110), [#121](https://github.com/kame447/StudyPlanner/pull/121), [#122](https://github.com/kame447/StudyPlanner/pull/122), [#222](https://github.com/kame447/StudyPlanner/pull/222)。

「producer には field がある」「単体では save できる」だけでは persistence contract は成立しません。過去には renderer prompt context を AI request へ追加したのに turn diagnostic へ伝播する field がなく trace から欠落した、query が mixed old/new format の entry を取りこぼした、module memory にしか continuity state がなく reload で session が分裂した、network failure を admin UI が正常な 0 件として表示した、複数 bootstrap owner が同じ Planner data を二重 hydrate した、といった形で現れました。

不変条件は、write schema、storage key/document ID、transaction、outbox/retry、read/query、redaction、restore、projection/export までを一つの contract chain として考えることです。構造 ID と user content の redaction 責任を分け、server/path が authority の ID は client payload より path を正本にします。新 field は request producer の unit test だけでなく、persistent outbox や server preparation を通って read/export 側まで残ることを確認します。

検証では、実際の repository boundary を含む integration test を優先します。初回 append failure→reload→retry、large entry pagination、legacy/current mixed data、malformed schema、ownership mismatch、duplicate sequence、reload after save を通し、partial success や transport error を正常な empty state として扱わないことを固定します。

## R7. Mobile viewport / overlay / scroll / gesture / focus ownership

重要度: High。再発性: 非常に高い。

代表 evidence: [#186](https://github.com/kame447/StudyPlanner/pull/186), [#191](https://github.com/kame447/StudyPlanner/pull/191), [#192](https://github.com/kame447/StudyPlanner/pull/192), [#194](https://github.com/kame447/StudyPlanner/pull/194), [#197](https://github.com/kame447/StudyPlanner/pull/197), [#199](https://github.com/kame447/StudyPlanner/pull/199), [#201](https://github.com/kame447/StudyPlanner/pull/201), [#205](https://github.com/kame447/StudyPlanner/pull/205), [#206](https://github.com/kame447/StudyPlanner/pull/206), [#207](https://github.com/kame447/StudyPlanner/pull/207), [#208](https://github.com/kame447/StudyPlanner/pull/208), [#210](https://github.com/kame447/StudyPlanner/pull/210), [#211](https://github.com/kame447/StudyPlanner/pull/211), [#238](https://github.com/kame447/StudyPlanner/pull/238)。

モバイル UI の再発バグは単なる CSS の見た目問題ではなく、viewport と interaction surface の owner が曖昧なことが主因です。`position: fixed` の子が transformed ancestor に入って viewport ではなく scrolled surface を基準にした、z-index を上げても ancestor の overflow / stacking context から抜けられなかった、overlay を閉じる途中で pointer shield を先に外した、sheet 内 scroll と background scroller と body rubber-band が同時に動いた、drag 中に timeline auto-scroll と bottom-sheet swipe が競合した、といった形で繰り返しています。

不変条件は、modal/sheet/drag interaction ごとに viewport owner、scroll owner、gesture owner を一つに決めることです。全画面 overlay は必要なら `document.body` portal へ出し、祖先の transform/opacity/overflow が fixed positioning と stacking context を変えないことを確認します。sheet が open から closing を終えるまで background scroll と hit testing を一貫して lock し、drop、cancel、unmount の全 exit path で lock を解放します。同じ touch sequence を page scroll、timeline auto-scroll、sheet dismiss、card drag が同時所有しません。

入力欄については iOS Safari の zoom 判定が focus acquisition 前の computed font size を見ることを前提に、mobile/coarse pointer の text control は focus 前から 16 CSS px 以上にします。`user-scalable=no` や `maximum-scale=1` で accessibility を犠牲にしません。成功送信後の無条件 `.focus()` のような programmatic focus も、mobile UX の owner を奪うため原則禁止です。

検証は 360 / 390 / 402px の狭幅だけでなく、600 / 768px 付近の breakpoint も含め、bounding box、`scrollWidth <= clientWidth`、hit test、background scroll position、gesture中の transform、close lifecycle を測ります。単なる screenshot や z-index 数値比較だけでは不十分です。

## R8. Test harness / browser model / real-device gap の誤分類

重要度: High。再発性: 非常に高い。

代表 evidence: [#78](https://github.com/kame447/StudyPlanner/pull/78), [#81](https://github.com/kame447/StudyPlanner/pull/81), [#185](https://github.com/kame447/StudyPlanner/pull/185), [#191](https://github.com/kame447/StudyPlanner/pull/191), [#192](https://github.com/kame447/StudyPlanner/pull/192), [#194](https://github.com/kame447/StudyPlanner/pull/194), [#197](https://github.com/kame447/StudyPlanner/pull/197), [#206](https://github.com/kame447/StudyPlanner/pull/206), [#211](https://github.com/kame447/StudyPlanner/pull/211), [#228](https://github.com/kame447/StudyPlanner/pull/228), [#240](https://github.com/kame447/StudyPlanner/pull/240)。

green test と実機正常は同義ではなく、red test と product defect も同義ではありません。#194 では focus 後だけ 16px を測る browser regression が green でも、iOS は focus acquisition 前に zoom 判定するため実機では失敗しました。#192、#197、#208 でも Chromium が通った後に iPhone が viewport/scroll 問題を再現しました。一方 #191、#197、#211 では stale locator、scrollbar gutter の誤測定、既知の Schedule sheet 自体を dismiss できない新規 mouse harness など、production を変えるべきではない harness defect が見つかっています。

不変条件は、失敗した gate を production defect、stale/incorrect contract、harness/environment defect、infrastructure/transient failure に分類してから編集することです。新しい harness が疑わしい場合は、既知の reference control に同じ操作を適用して harness 自体を検証します。GitHub Actions が step 0 件で終了した場合は code failure でも success でもなく missing evidence とします。threshold、timeout、assertion を根拠なく緩めて green にしてはいけません。

実機が automation の仮定を反証した場合、その観測を一回限りの手動確認で終わらせず、可能な範囲で geometry、hit testing、pre-focus state、WebKit behavior、scroll ownership の deterministic regression へ昇格します。iOS/WebKit 固有の gap が既知になった領域では Chromium-only を merge evidence として十分とみなしません。

## R9. Migration / version skew / rollout ordering

重要度: High。再発性: 高い。

代表 evidence: [#70](https://github.com/kame447/StudyPlanner/pull/70), [#78](https://github.com/kame447/StudyPlanner/pull/78), [#95](https://github.com/kame447/StudyPlanner/pull/95), [#154](https://github.com/kame447/StudyPlanner/pull/154), [#222](https://github.com/kame447/StudyPlanner/pull/222), [#239](https://github.com/kame447/StudyPlanner/pull/239)。

client、Worker、Firestore schema/rules、AI contract、saved data、CI/deploy tool が同時に更新されないシステムでは、新旧の一時的共存が通常状態です。旧 Worker と新 Worker の trace format が混在して query が欠落した、Stable V5 が必要とする request/output budget と deployed Worker limit がずれた、renderer の旧 semantic cue を削除した時点で typed question intent が全経路をカバーしていなかった、strict Firestore rule を compatible writer より先に deploy すると legacy client が profile create できない、といった問題がありました。

不変条件は、versioned contract、compatibility window、cutover order、rollback/fallback condition を明示することです。新 reader は必要な期間だけ旧保存形式を読めても、旧 runtime semantic authority を復活させてはいけません。strict validator/rule は compatible writer が先に live になってから締めます。旧 contract を削除する前に、同等 invariant を担う typed replacement が全 runtime state をカバーしていることを証明します。

Worker/API/deploy tooling の具体的な failure signature と workaround は [`tooling-operations-runbook.md`](tooling-operations-runbook.md) に記録し、この文書へ複製しません。

## R10. Scope isolation と sibling leakage

重要度: High。再発性: 高い。

代表 evidence: [#140](https://github.com/kame447/StudyPlanner/pull/140), [#148](https://github.com/kame447/StudyPlanner/pull/148), [#150](https://github.com/kame447/StudyPlanner/pull/150), [#157](https://github.com/kame447/StudyPlanner/pull/157), [#204](https://github.com/kame447/StudyPlanner/pull/204), [#225](https://github.com/kame447/StudyPlanner/pull/225)。

一つの task/component/workload/term について成立する条件を global `any` や親 scope のまま評価すると、別の sibling へ漏れます。pending capacity proposal が一件あるだけで unrelated workload の proposal を抑止したケース、component-level preferred window が sibling component へ漏れ得たケース、active timetable term が downstream へ伝わらず期間外授業が制約になったケースが代表です。

不変条件は、状態や制約に target identity と scope を持たせ、global suppression は本当に global invariant の場合だけ使うことです。task→component の継承は explicit policy、component→sibling の伝播は禁止を既定とします。duplicate 判定も「同じ target」「同じ typed dimension」「同じ evidence/lifecycle」のどこまで一致すべきかを contract 化します。

検証では最低二つの sibling target を用意し、片方の proposal、constraint、effort、completion、term selection を変更しても他方が変化しない negative integration を入れます。

## R11. Partial read / stale read model / unknown を empty or zero に変換する

重要度: High。再発性: 高い。

代表 evidence: [#96](https://github.com/kame447/StudyPlanner/pull/96), [#220](https://github.com/kame447/StudyPlanner/pull/220), [#222](https://github.com/kame447/StudyPlanner/pull/222), [#234](https://github.com/kame447/StudyPlanner/pull/234)。

取得失敗、部分取得、stale snapshot、canonical timestamp 未 backfill を `[]` や `0` として表示すると、障害が「データが存在しない」という正常状態に見えます。#96 では大量 trace entry の fetch failure が空 timeline/Raw JSON として見える問題があり、#222 では stale active-user snapshot や registration timestamp 不完全時に誤った current metric を出さないよう fail-closed / unknown 表現へ修正されています。

不変条件は、empty、zero、unknown、stale、partial、error を machine state と UI で区別することです。bounded read が途中で欠落した場合は部分 timeline を正常結果にせず、read model revision/date が current request と一致しない場合は stale として隠すか明示します。集計の source of truth と read model を混同しません。

検証では、途中 page 欠落、cursor 非進行、total count 変化、stale revision、legacy incomplete data、server error を注入し、正常な 0 件と異なる UI/typed result になることを確認します。

## R12. Accessibility semantics と visual DOM の乖離

重要度: High。再発性: 反復あり。

代表 evidence: [#170](https://github.com/kame447/StudyPlanner/pull/170), [#172](https://github.com/kame447/StudyPlanner/pull/172), [#173](https://github.com/kame447/StudyPlanner/pull/173), [#228](https://github.com/kame447/StudyPlanner/pull/228)。

視覚的に calendar grid や clickable row に見えても、ARIA role の required parent/child hierarchy、nested interactive control、keyboard focus contract、pointer/touch contract が一致していなければ accessibility regression になります。`aria-selected` を button role に載せる、gridcell/columnheader を row なしで配置する、row 全体の button の中へ overflow menu button を入れる、といった問題が実際に発生しました。

不変条件は、見た目の component hierarchy と accessibility tree を別々に監査し、WAI-ARIA の role contract に沿う構造を作ることです。axe の critical finding を属性削除や threshold 緩和で隠さず、正しい parent/child role を構成します。pointer 契約を変更するときも keyboard Enter/Space の既存 operability を独立に維持します。

検証は axe に加えて、role count/hierarchy、roving tabindex、arrow/Enter、nested interactive absence、text clipping geometry を確認します。DOM nesting 変更後は CSS border/grid layout の visual regression も同時に確認します。

## R13. Build / deploy / runtime contract の責任混在

重要度: High。再発性: 反復あり。

代表 evidence: [#72](https://github.com/kame447/StudyPlanner/pull/72), [#78](https://github.com/kame447/StudyPlanner/pull/78), [#81](https://github.com/kame447/StudyPlanner/pull/81), [#95](https://github.com/kame447/StudyPlanner/pull/95), [#239](https://github.com/kame447/StudyPlanner/pull/239)。

production bundle、repository typecheck、test source、Worker validation、provider request budget、deployment credential mechanism は異なる責任です。#81 では Pages の `npm run build` が production bundle 生成と全 test source の typecheck を一つにしていたため、bundle に含まれない test-only type error でも deploy が停止しました。#72 では planning range と audit timestamp に同じ UTC-only validator を使い、正しい domain date を拒否しました。#239 では WIF 自体は成功していても Firebase CLI が federated ADC を受け付けず、deploy mechanism を Rules API へ変更する必要がありました。

不変条件は、品質 gate を弱めるのではなく責任ごとに分離することです。deploy build は deployable artifact の生成責任、typecheck/test は CI quality gate、Worker/API は shared contract、deployment transport は現在の credential mode を実際に受理する interface を owner とします。local success や authentication success だけで production deploy success を推論しません。

具体的な GitHub/CI/connector failure の再試行・fallback・permission は [`tooling-operations-runbook.md`](tooling-operations-runbook.md) を参照します。

## R14. Independently green な変更の integration-only regression

重要度: High。再発性: 反復あり。

代表 evidence: [#191](https://github.com/kame447/StudyPlanner/pull/191), [#222](https://github.com/kame447/StudyPlanner/pull/222), [#228](https://github.com/kame447/StudyPlanner/pull/228), [#240](https://github.com/kame447/StudyPlanner/pull/240)。

各 branch が単独で green でも、main に組み合わさったときだけ壊れることがあります。#240 では #221 と #234 が個別に UI Quality を通過していた一方、両方が main に入ると aggregate raw CSS budget だけが超過しました。post-merge adversarial audit で初めて wiring や interaction contract の不足が見つかったケースもあります。

不変条件は、additive resource、shared contract、cross-feature CSS/DOM、global state、rules/schema のように合成で変化するものは branch-local green だけで完了とみなさないことです。merge 前は latest main との exact diff と merge ref、必要なら merge 後 main の gate を確認します。budget が古い前提を表している場合は、圧縮サイズや largest asset など他の guard と evidence を比較し、単に production CSS を削るか threshold を上げるかを先入観で決めません。

## 新しいバグを形式知へ取り込む基準

この文書には、単発の症状や一度しか使わない workaround を追加しません。既存パターンの別症状であれば、代表 evidence と invariant を必要な範囲だけ更新します。既存パターンでは説明できない新しい root-cause class が確認され、再発時の調査コストが高い、core data/state を壊し得る、複数 feature に波及する、または同型が二度以上現れた場合に新パターンとして追加します。

新規 defect の修正では、最初に reproduction evidence を取り、現在の owner contract を特定し、owner boundary の regression を先に置くことを基本とします。cross-layer defect なら unit test だけで完了せず、必要な repository / browser / Worker / persistence boundary まで通します。AI の stochastic behavior が原因候補なら deterministic invariant と real-model observation を分け、特定の日本語文面を唯一の正解として固定しません。real device が automation を反証した領域は、その差を今後の verification matrix へ残します。

修正完了時には、症状が消えたことだけでなく、該当パターンの invariant が exact final HEAD で守られているかを確認します。新たな CI/tool integration failure を発見しただけなら、この文書ではなく [`tooling-operations-runbook.md`](tooling-operations-runbook.md) を更新します。
