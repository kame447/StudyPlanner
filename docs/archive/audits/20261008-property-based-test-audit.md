# StudyPlanner テスト構造監査と生成的検査への移行提案

Status: historical audit snapshot / recommendations, not implementation completion
Audited: 2026-10-08 JST
Audited main: `22847120386987329e2f034d6062d59694ef1180`
Tracking: [Issue #382](https://github.com/kame447/StudyPlanner/issues/382)

本書は上記コミットの調査結果を固定する証跡である。現在の移行順序、担当、着手範囲と完了状態はIssue #382を正とする。継続的な構造判断は[repository refactoring patterns](../../work/refactoring-patterns.md)、週間計画の検証方針は[test philosophy](../../domains/weekly-planning/quality/test-philosophy.md)、保存・表示の責務は[client-runtimeの復旧契約](../../domains/client-runtime/architecture/planner-read-projection-recovery.md)を参照する。本アーカイブの提案を現行仕様や実装済みの保証として扱わない。

## 1. 結論と調査範囲

必要なのは「固定テストを全部ランダムテストにすること」ではなく、「守る性質と、その性質を破る故障を対応付け、適切な境界で検査すること」である。少数の有限条件は全列挙し、値や構造はプロパティベーステストで広げ、非同期の競合は状態モデルと完了順の生成で探索する。UI、永続化、実Worker、Firestore、実モデルの意味解釈は、それぞれを実際に通る代表検査を維持する。

本監査では全ソースの機械的棚卸し、23個のfast-check利用ファイルの分布と設定、代表的なpropertyの中身、状態管理の実装、保存復旧のhookテスト、ブラウザハーネス、CIとmutation設定、既存Issue/PRを確認した。高リスクの代表箇所を精読したもので、852個の狭義のテストファイルを一つずつ完全レビューしたとは主張しない。

既存propertyの二箇所では、検査対象の観測値を明らかに退化した結果へ差し替えても検査が成功することを隔離コピーで確認した。これは、そのpropertyの保証不足の証拠であり、productionで同じ不具合が発生している証拠でも、全テストがその故障を見逃す証拠でもない。

## 2. 計測方法と前回答の補正

Git管理されたTypeScript/JavaScript系ファイルを対象とし、依存物、build成果物、画像、Markdown、lockfileを行数比較から除いた。空行とコメントは含む。9月30日終端の祖先`c6cf5debcf`ではテスト名・テストディレクトリに分類したコードが120,921行、それ以外が161,963行だった。監査SHAではそれぞれ156,754行と172,741行であり、純増は35,833行と10,778行である。

この「それ以外」はproduction bundleのコード量ではない。testUtils、評価補助、開発スクリプトなどを含み得る。前回答の「本体17.3万行」「本体比91%だから肥大化を疑う水準」という表現は粗すぎた。テスト対本体の行数比に正常・異常を決める根拠はなく、比率だけによる評価を撤回する。責務、測定分類、故障検出能力で判断する。

同じ広い分類のテスト関連ファイルは899個である。一方、src、workers、shared、scripts、tests配下でファイル名が`.test.`または`.spec.`を含む狭い分類は852個、150,956行だった。この差にはfixture、support、configurationなどが含まれる。前回答の4,392はit/testの静的呼出箇所の概算であり、実行件数ではない。it.each、ループ、ブラウザproject、skip、property内部の試行は別途扱う。本監査では現行mainのfull suite総実行件数を再測定していない。

`usePlannerDataState.*`の狭義テストは21ファイル、7,078行だった。保存・読込・復旧の順番を個別に扱う保守負荷を調査する根拠にはなるが、21ファイルを直ちに不要とする根拠にはならない。

再測定時はGit treeとblobを直接読み、拡張子をts/tsx/js/jsx/mjs/cjs/mts/cts、広いテスト分類をtest/tests/__tests__/e2eディレクトリまたは.test./.spec.名に固定する。未マージPR、作業中worktree、node_modulesのコピーを混ぜない。行数、テスト定義数、実行数、生成試行数、列挙状態数、故障検出数を同じ指標として扱わない。

## 3. 既にある基盤を再利用する

監査SHAのpackage-lockと隔離検証で使ったインストールを照合し、fast-check 4.10.0、Vitest 3.2.7、TypeScript 5.9.3、Vite 6.4.3を確認した。Nodeはv24.20.0、OSはdarwin。非optionalの未インストールとインストール済みversion不一致は0件だった。lockfileのSHA-256は`0cc1f34fa1ead88aab107a9cd1f91e00575d514d45406a5ec452d98b71bfdbb5`である。新規ライブラリやmajor upgradeから始める必要はない。

fast-checkの直接importは23ファイル、fc.assertとfc.property/asyncPropertyの静的呼出箇所はそれぞれ53箇所だった。パラメータ化された呼出や休眠機能・旧入口も含むので、53箇所すべてが現行productionの独立保証だとは数えない。

保存再試行、snapshot import、数量検証、component階層、参照所有権、候補manifest、会話状態、配置、空き時間、prompt境界、provenance、数値攻撃、メール匿名化に既存propertyがある。weeklyPlanningSessionState.property.test.tsには操作配列を畳み込む検査もあり、「状態列テストが一切ない」という評価は誤りである。一方、調査したコードではfast-checkのcommands、modelRun、asyncModelRun、scheduledModelRun、scheduler/schedulerForの利用を確認できなかった。保存復旧は主として人が選んだ順序とdeferred promiseを使っている。

[数量検証](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/src/features/weeklyPlanning/semantic/weeklyPlanningQuantitativeValueValidationV5.test.ts#L34-L130)は良い再利用例である。生成値をcanonical graphの値と直接比較し、round-trip一致だけに依存していない。壊すfieldを一つずつ選び、JSON変換でNaN/Infinity/undefinedが変形する前も検査し、元の代表例をexamplesに保持する。PR #409で行われた整理を未導入としてやり直さない。

PR #473では読込spyの共通準備が既に集約され、各テストの期待getter集合は独立に残されている。既存の改善を無視して別の汎用ハーネスを重ねない。

## 4. 確認済み所見A：配置propertyが空出力を排除できない

[placementProperties.test.ts](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/src/features/weeklyPlanning/scheduling/placementProperties.test.ts#L133-L260)はallowPartialPlacement=trueで生成し、所要時間の保存、枠の妥当性、既存予定との非重複、まとまり、小さすぎる枠の回避、決定性を検査する。[時間保存helper](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/src/features/weeklyPlanning/testUtils/weeklyPlanningTestHelpers.ts#L223-L243)は「配置済み時間＋未配置時間＝要求時間」と「枠の時間総和＝配置済み時間」を検査する。

これは必要な安全性だが、全作業を未配置にしても時間保存は成立する。空の枠列へのforEach、重複判定、細切れ判定も成功し得る。配置できる入力で少なくとも一つの枠が作られるという前進性を、このsuiteの全体は要求していない。

隔離コピーで元のsuiteを実行し、5件すべて成功した。次にrunScenarioの戻り値だけを、blocks=[]、placedMinutes=0、unplacedMinutes=要求時間の総和、hardViolationCount=0へ差し替えた。productionの配置処理や他のテストは変更していない。この故障観測値でも同じ5件がすべて成功した。検証後、隔離コピーのテストは元のGit blobへ復元した。

これはStrykerのmutation scoreではない。観測結果の退化に対するoracle感度のprobeであり、production mutantを全suiteへ投入した測定ではない。ただし、生成回数を増やすだけではこの盲点が塞がらないという判断には十分である。

改善は二つの契約に分ける。任意入力では時間保存、非負、正の枠長、hard constraint、task別の過不足、入力非破壊を検査する。別に、配置可能性を構成から保証できる単純な入力族を作り、その族に限って全要求の配置と非空出力を必須にする。総空き時間が多いだけでは、原子作業、分割禁止、期限、休憩などの条件を満たすとは限らない。

小さい離散時間格子なら、テスト専用の総当たり参照実装で実行可能性を独立に求められる。productionの候補生成、得点関数、validatorを正解計算へ流用しない。heuristic schedulerに一般的な最適性を勝手に要求せず、現行契約が保証する単純な実行可能族と安全性に限定する。

現状のpropertyは日本語を組み立ててassessWeeklyPlanningRequestなどの変換helperからfixtureを作る。一方、Stable V5の[planning evaluation](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/src/features/weeklyPlanning/application/weeklyPlanningStableV5PlanningEvaluation.ts#L178-L262)はaccepted graphからcompileGenericSchedulerInputへ進む。移行時はtyped graphから実際のproduction配置境界へ届くsuiteを用意し、旧helperのgreenだけでStable V5全経路を保証しない。旧suiteの廃止はproduction利用・保存互換責務を確認してから判断する。

## 5. 確認済み所見B：状態更新の成否を実装自身に判定させている

[revision property](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/src/features/weeklyPlanning/weeklyPlanningSessionState.property.test.ts#L250-L273)は、実行結果が同じ参照ならrevision不変、別参照ならrevisionが1増える、と検査する。その操作が本来受理されるべきかは独立に判定していない。

元の該当propertyを単独実行して1件成功、同ファイルの他4件は名前filterによる非実行だった。次にそのproperty内のreducer呼出結果だけをcurrentへ差し替え、同じpropertyが1件成功することを確認した。fixture生成や他のpropertyまでno-op化したわけではない。「reducer全suiteが全面no-opを見逃す」と一般化しない。

改善では、必須の受理遷移と拒否遷移を独立した仕様表または小さい参照モデルで定義する。受理なら期待したデータ変更、revision増分、後続状態を検査し、拒否なら参照・内容・永続書込が不変であることを検査する。next===currentを受理可否の正解に使わない。全拒否、全受理、revision固定の故障をそれぞれ検出できることを確認する。

同ファイルの[stale identity検査](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/src/features/weeklyPlanning/weeklyPlanningSessionState.property.test.ts#L141-L207)は、不一致mask7種類とturn終端3種類、approval終端2種類からなる。21通りと14通り、合計35通りを直接全列挙できる。random抽選でこの有限集合を何度も引くより、全組合せを明示的に一度ずつ検査する方が保証を説明しやすい。IDやrevision値の広がり、合法な長い操作列は別のpropertyで担う。35という数はこの限定matrixの大きさであり、reducer全状態数ではない。

## 6. 重点移行先：保存・読込・復旧の状態モデル

[PlannerDataReadAuthority](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/src/domain/plannerDataReadAuthority.ts#L40-L115)はowner/epoch、受理済みprojection revision、full-read health、repair concernを所有する。[PlannerMutationReconciliation](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/src/domain/plannerMutationReconciliation.ts#L60-L207)はtracked mutationと再読込の調整を所有する。既に298行・209行の独立した境界があり、property導入のために2,130行のhook全体を先に作り直す必要はない。

参照モデルには現在のownerとepoch、最後に受理したreadのidentity、full-read health、未解決repair対象、pending操作を持たせ、durable stateと表示projectionを分ける。productionのprivate counterや分岐をコピーせず、「このownerのどのreadが表示を置換してよいか」「どの集合をまだ確認していないか」「保存は実際に何回成立したか」を独立した小さい台帳で表す。

生成操作は読込開始、成功・失敗応答、書込開始、durable commit、成功・失敗ack、owner変更、明示retry、Undo、reset、unmountを対象境界ごとに限定する。durable commitとack受信を別イベントとする。ackの到着順をbackend commit順と取り違えるモデルでは、今回増えている回帰の本質を扱えない。

最初はowner二人、ID二つ、同時pending二つまでに絞り、実APIの入力制約に沿った短い操作列を有界全列挙する。操作アルファベットと深さ、到達状態数を記録し、その外側の長い列と多数の値をfast-checkのcommandsで生成する。二つのrunnerを設ける場合も独立モデルとcommand契約は再利用し、大規模な独自テストフレームワークを作らない。

拒否される操作をcheckやpreで全部除外しない。合法操作による前進性の探索と、stale・旧owner・重複操作を意図的に投入して拒否を観測する探索を分ける。preconditionで飛ばした操作や空の列を大量に生成しても、重要な状態を検査したことにはならない。

非同期順序は既存deferred gateを接続口にし、schedulerで制御するpromise境界を明示する。schedulerがブラウザ・ネットワーク・Firestoreの全順番を制御するわけではない。commandのcheck/runが未解放の別scheduled taskを待ってdeadlockしない設計にする。Reactのcommit/effectに必要なactはhookアダプタで管理する。

### 6.1 独立モデルで維持する性質

旧owner/epochのackやread結果は、別ownerへの切替後だけでなくA→B→Aでも現在の表示を変えない。新しい表示が受理された後に古い保存ackが返ってきても、その古いpayloadで上書きしない。epochは同名ownerへの再入を区別する世代である。

retryは必要な読込だけを行い、完了済みsave/link/restoreや進捗加算を再実行しない。保存成功後の表示更新失敗を保存失敗へ誤分類しない。逆にPlan Undoのdispatch後の失敗など、影響なしと証明できない失敗をno-opと決めつけない。普通の成功ack契約と、不確実な複合write契約を同じ期待値へ潰さない。

repair対象の五グループはActual/StudyMaterial、MonthEvent、Plan/Todo、DayNote、Timetableである。五つのbitの全32maskと二つの要求のunion全1,024組は、純粋な対象選択検査として全列挙できる。空要求の扱いは現行APIに従って明示する。全1,024組を毎回ブラウザで再現しない。

ActualとStudyMaterial、PlanとTodo、Timetableの三collectionは、それぞれの契約で一体としてpublishする。Subjectの追加読込はmaterial/subject claimによる条件付き依存であり、五グループだけでは表せない。この条件は別軸にする。失敗したunionの一部分だけをreadyにしたり、読んでいないcollectionを修復済みにしたりしない。

無関係なfull-read失敗はtargeted repair成功だけでは治らない。異なる資源への操作を不必要に同一資源としてserializeせず、同一資源への競合は適切に拒否または直列化する。latched failureの状態で無関係なwriteのたびに自動retryしない。retry連打は一つの許可された試行に集約する。

前進性も観測する。現在ownerで必要なwriteがsettleし、対象readがすべて成功し、より新しい操作がないという公平性・停止条件の下では、必要なデータをpublishしてreadyへ戻る。常時stale、常時busy、全拒否の実装を合格させない。一方、応答が永久に返らない環境でも必ず完了する契約は作らない。

### 6.2 hook・repository・browserの境界

[reconciliationのhookテスト](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/src/hooks/usePlannerDataState.reconciliation.test.tsx#L11-L75)は実hookとcreatePlannerRepositoryを使うがstorage gatewayはメモリfixtureである。[Plan Undoのhookテスト](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/src/hooks/usePlannerDataState.planUndoRecovery.test.tsx#L6-L100)は既存local repository fixtureを使い、getter期待集合も明示する。mockがあるというだけで両者を同一視しない。

domainモデルで広い操作順を探索し、代表列を実hookとnative local repositoryへ移す。Firestoreの認可・transaction・複数clientの重複防止は別境界であり、local queueや単一module instanceの成功を代わりにしない。Issue #51の複数端末保証をモデル設計だけで完了扱いしない。

hookでは準備・adapter・独立expected stateの重複を先に調べる。接続口が既にあるdomainまで一括再設計するより、小さいproperty導入を先行する。PBTのためにproduction lifecycle変更が必要なら、別の実装根拠と受入条件を提示する。

## 7. 承認・保存・復元の移行先

[ApprovalRetry.integration.test.ts](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/src/features/weeklyPlanning/application/weeklyPlanningApprovalRetry.integration.test.ts#L18-L180)は既にbatch途中失敗、commit後の応答消失、ledger喪失、finalization失敗、restoreを検査する。書込回数と永続plan数も見るため、単なるmock呼出検査として削除しない。生成部分は主にcount・失敗位置・booleanの組合せであり、複数回の失敗とretry/reload/取消/owner切替が任意順で続く探索は別途必要になる。

短いモデルにはpreview identity、revision、未承認/承認中/回復中/完了、operation identity、durable plan集合、失敗段階を持たせる。二重承認、途中reload、応答消失後retry、ledger喪失、stale previewを生成する。同一operationの効果が一度だけ成立することと、未承認または古いpreviewでは効果ゼロであることを併せて検査する。

retry回数を増やしても同一operationのdurable planが増えないというmetamorphic relationを使う。ただし新しいユーザー操作まで同じoperationとみなさず、別preview・owner・revisionを区別する。大きいbatchや保存サイズ上限の代表例は維持し、全探索を最大500件のbatchとの直積にはしない。

## 8. データ構造・日付・Jev・traceへの配分

schema、Fact Graph、参照所有権ではvalid graph generatorと一箇所破損generatorを分ける。IDを一貫して置換した場合の意味の保存、無関係fact追加による独立hard constraintの不変、入力非破壊、明示的に可換な操作だけの順序独立性を検査する。訂正・revision・意思決定のturn順は一般に可換ではない。

日付・空き時間・繰り返しでは日跨ぎ、月末、閏日、週開始曜日、除外日、固定予定、hard constraintとpreferenceを区別する。日付の平行移動を使うならrequest clock、既存予定、期限など関連contextも移す。曜日やtimezoneの影響がある入力に無条件のシフト不変性を要求しない。hard availabilityに制約を追加して利用可能集合が広がらないことと、heuristic配置の結果自体の単調性を混同しない。

候補階層化は既存manifest propertyを活用する。候補がちょうど一度到達可能、menu上限、noneの扱い、不正・別ターンの選択拒否をtyped構造で検査する。上限64などは現在の候補契約を確認し、独立した境界例と全候補到達性を検査する。production出力をそのまま期待集合にして候補欠落を見逃さない。

日本語の言い換えを生成しても意味が同じだと自動認定しない。typed document以降の安全性propertyとJev/Lunaの意味解釈評価を分ける。#333の人手gold、#335の置換単位の安全性、#305の固定roster・費用・holdout契約は維持する。正解ラベルのない生成文を大量に投げても意味精度の網羅的保証とは呼ばない。

traceの新field、outbox retry、Worker preparation、document size、truncation、privacyには[domain AGENTS](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/src/features/weeklyPlanning/AGENTS.md)の実永続化gateがある。共有fixture化やPBT移管でこのgateを落とさない。文字列長ではなく実際の符号化byte数を検査し、必要な本文を全削除しても「上限内」で通る退化oracleを避ける。

## 9. 共通化・統合・削除の判定

同じ準備処理、clock、repository fixtureの複製は共通化候補である。一方、機能ごとの期待値まで巨大helperへ隠すと、実装修正と同時に正解まで変わる。setup、観測手段、期待結果を分け、共有するのは安定した接続口だけにする。

Issue #156のcompleted-progressとremaining-effortの実API検査には、store作成、runtime session初期化、application turn実行・記録の共通部分がある。ただし二つの会話が保証する完了進捗と残作業量は異なる。runnerを再利用してもscenarioの入力・観測・期待状態・goldは個別に読めるままにする。既に共通化された部分の再移動を成果としない。

各候補に「契約ID、実production入口、既存test、故障型、現在の検証境界、移管先property/列挙/実integration、残す代表例、削除条件」を記録する。維持、同境界内統合、propertyへ保証移管、外部境界として分離、真に廃止された責務として削除を区別する。古さ、長さ、skip、Issue番号、似た語があることだけで削除しない。

削除・統合は、元実装でのgreen、代表故障でのred、新検査でも同じ故障を検出できること、正の成功経路も通ることを確認してから行う。最小反例は既存corpusへ昇格し、発見ごとに巨大な新規ファイルを増やさない。保守箇所の減少、ケース数の減少、実行時間の減少は別々に報告する。

## 10. E2Eを残す範囲と組合せ検査

[復旧ブラウザsuite](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/tests/e2e/planner-reconciliation-recovery.spec.mjs#L1-L43)は実App/hook/applicationとlocal repositoryを使う一方、外部通信を止めたlocal harnessである。[専用config](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/tests/e2e/playwright.planner-recovery.config.mjs#L1-L16)はViteでharnessを起動する。この成功をproduction build、公開サイト、実Firebase、実LLMを全て通るオンラインE2Eと呼ばない。実built moduleのMIME/load/reload検査は別に残す。

ブラウザでは入力から会話継続、preview、承認、保存、reload後表示までの代表フローを維持する。保存後の表示復旧、入力・添付保持、画面移動、実module failure、keyboard/focus、touch/drag、short viewport、scroll lockはpure propertyへ置き換えられない。

desktop/mobile、theme、viewport、入力方法を無差別に全直積する前に、各因子がどの故障へ影響するかを分ける。低リスクの視覚的組合せには制約付きpairwise等を候補とし、必要なt-way組合せの被覆を記録する。高リスクの操作順、owner境界、保存冪等性、三因子以上の既知バグはpairwiseへ削減しない。Chromium/Firefox/WebKitの固有境界も維持する。

## 11. seed、縮小、探索被覆と実行費用

既存propertyには固定seedが多く、一部に未指定seedがある。統一的な状態列replayや探索クラス集計は、調査したコードとworkflowでは確認できなかった。固定seedは再現性に有効だが、毎回の探索範囲も固定される。既知反例を必須examplesに置き、固定seedの短いgateと、seedを記録する探索runを分ける。

反例にはGit SHAとdirty入力差分、lockfile hashに加え実installed dependency identity、Node/OS、command、seed、path、生成入力、実行操作列、scheduler制御境界を保存する。commandsの縮小では必要なreplayPathも残す。ローカルとCIで同じ最小反例を再現できることを受入条件とする。認証情報や実ユーザーデータをartifactへ含めない。

探索クラスには成功/拒否、空/非空、same/different owner、A→B→A、same/disjoint resource、commit前/後の失敗、read前/中/後のwrite、対象単独/union、通常/境界値を含める。重要クラスが0件なら生成回数が多くても十分としない。必須exampleまたは層別generatorへ割り当て、randomの偶然で毎回失敗するcoverage gateにはしない。

初期予算案はpure propertyを一契約100〜300試行、状態モデルを50〜100列・最大20操作程度から測るというものだ。実測前の開始点であり全suiteへの一律命令ではない。有界全列挙、必須境界例、故障検出を先に満たし、準備、テスト本体、縮小、build、artifact待ちを別々に計測して調整する。全件を1万回に増やすだけの変更は避ける。

実行頻度の正本は[AGENTS.md](../../../AGENTS.md#verification-cadence)であり、「30分以内のgreenなら省略」という時間だけの基準へ戻さない。実装中はfocused feedback、統合ownerは同じ内容に対して最終full verificationを担当する。共有generator/fixture/clock/runner変更では関連testだけのgreenを全体証拠にしない。実APIは明示的費用契約の下だけで実行する。

## 12. mutationと故障注入の配分

[通常Stryker設定](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/stryker.config.mjs)は二つのsemantic module、[Issue #152設定](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/stryker.issue152.config.mjs)は五つのsecurity関連moduleを対象とする。#152の広いrunは通常PRの既定から外されている。Vitest/Stryker互換性は#328で追跡し、本件でmajor upgradeしない。

[Test Intelligence](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/.github/workflows/test-intelligence.yml#L1-L38)には週次、手動、限定pathのPR実行がある。「mutationが一切自動実行されない」「全PRの変更箇所がmutation検証済み」のどちらも誤りである。現行対象に保存復旧の核心は含まれていない。

最初の単位では空配置、全拒否、owner fence欠落、revision固定、retryでの書込再実行、union一部欠落、旧readのpublish、失敗後の常時staleなど、明示的なdomain故障を限定して検査する。その後、小さいmodule単位のStrykerへ拡張する。全リポジトリmutationを毎回実行する設計にはしない。

killed、survived、no coverage、timeout、compile/runtime error、ignoredを区別する。ツール上timeoutがdetectedへ入っても、目的のassertionが故障を見つけた証拠とは区別する。等価mutantの除外理由を残し、分母だけを減らしてscoreを上げない。既知の危険な故障が生き残る限り、総合scoreの高さで完了としない。

## 13. 実装順序と完了条件

第一単位は、配置の空出力とrevisionのno-opを見逃さない独立oracle、および有限35組の全列挙である。productionを変えず、既存の代表例を残す。元コードが通り、意図した退化故障が落ち、故障を戻すと通るところまでを同じ単位で確認する。

第二単位はread authority/coordinatorの短いモデルと有限target unionである。owner/epoch、失敗、union、quiescence、前進性を独立モデルへ対応付ける。既存deferred回帰は即削除せず、同じ危険列を探索・縮小・再現できることを確認する。

第三単位は代表列の実hook/native local repositoryへの接続である。callback lease、React commit、read-only retry、保存失敗と表示失敗の分離を検証する。共通化はこの段階で繰り返される安定したfixtureに限定し、期待値は各契約で読めるままにする。

続いて承認/保存/reload、typed graph/日付/候補階層へ広げる。最後に下位検査が代替できると証明された同一境界の重複を統合する。ブラウザ固有の故障や外部境界は残す。テスト数や行数の削減率を先にノルマ化しない。

各単位の完了には、契約とproduction入口、独立oracle、生成/列挙範囲、正の成功例、代表故障の検出、最小反例replay、保証移管先、exact-contentの適用可能な検証結果が必要である。現在の順序とcheckpointはIssue #382で更新し、本アーカイブを進捗台帳として編集し続けない。

## 14. 実行した検証と未実施事項

監査SHAをGit archiveで一時directoryへ展開し、同SHAを検証していたworktreeのnode_modulesを参照した。manifestとinstalled package versionを照合した上でVitestをworker一つで実行した。元の作業tree、productionコード、既存テスト、依存、workflowは変更していない。

配置suiteのコマンドは `node node_modules/vitest/vitest.mjs run --config vite.config.mjs src/features/weeklyPlanning/scheduling/placementProperties.test.ts --maxWorkers=1 --minWorkers=1 --reporter=json --outputFile=<report>` である。元の結果は5 passed / 0 failed、空配置probeも5 passed / 0 failedで、双方exit 0だった。

revision検査は対象を `src/features/weeklyPlanning/weeklyPlanningSessionState.property.test.ts` に変え、`-t 'increments revision'`を指定した。元とno-op probeはそれぞれ1 passed / 0 failed / 4 filtered pending、双方exit 0だった。filteredの4件を実行済みと数えない。二つの一時編集は監査SHAのGit blobへ復元した。

本件の公開差分はMarkdownのみとする。doc-only例外に従いbuild/full testを監査完了の必須条件にはせず、exact diff、参照先、文書の責務分離を検査する。将来の実装で必要なfull verifyやbrowser gateを免除する意味ではない。今回full suite、E2E、Stryker、実API、実端末検証は実行していない。未知の不具合がないこと、全入力の網羅、速度改善はまだ主張しない。

## 15. 一次資料と採用理由

[fast-check model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/)は、小さい独立モデル、command列、seed/path/replayPathを確認するために参照した。[race conditions](https://fast-check.dev/docs/advanced/race-conditions/)は制御した非同期境界の完了順を探索する機構と、commandが別scheduled taskの完了に依存しない制約の根拠である。どちらも実ブラウザやFirestoreの全順序を保証するものとして扱わない。

[Stryker mutant states and metrics](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)は未検出、timeout、errorの分類を確認した。[NIST SP 800-142](https://csrc.nist.gov/pubs/sp/800/142/final)は相互作用の次数に応じた組合せ検査を参照した。pairwiseを完全網羅と呼ばず、限定した視覚因子の削減候補としてのみ提案する。

web資料は2026-10-08に確認した。実装時はrepositoryのlocked versionでAPIの存在と挙動を再確認する。ランダム生成は全列挙ではなく、有限の全列挙でも集合・深さの外側の証明ではない。「網羅的」の主張には必ず検査範囲を添える。
