# User Context Harness：段階実装work

Status: active implementation-planning record / runtime not implemented by this document
Updated: 2026-09-12
Owner Issue: #294

この文書は変更箇所、依存成果物、受入条件、移行・rollback、監査課題を所有する。仕様は [canonical architecture](../architecture/memory-and-conversation.md)、[policy](../policies/memory-lifecycle-and-surfacing.md)、[quality](../quality/regression-scenarios.md) を正とし、具体的なインターフェースは [supporting service design](../architecture/context-service-contract.md) を参照する。実行順序は [roadmap](../roadmap/current.md) のみを正本とする。Issue/PRは正本仕様を複製せず、着手状態と検証結果を追跡する。

本workは未完了の実装を追跡するためcurrent hierarchyに置く。全release unitが完了したら、継続する不変条件を担当canonical文書へ移し、完了記録を `docs/archive/work/closed/` へ移す。phase名だけを理由に安全性・忘却・計測を終盤まで後回しにしない。

## 1. 監査基準と確度

コードの基準はmain `2a89f214fe87460ba0e0b2c410e98c8794ff5980`。この文書の作成ではアプリコード、保存schema、workflow、provider、モデルを変更していない。以下の既存挙動はソース読解、懸念は静的な再現候補である。unit test、実API、browser、実機、複数端末の実行成功をこの文書だけで主張しない。着手時にcurrent mainとのdriftを再監査する。

設計基盤はPR #302でmainへ統合済み。#294の2026-09-11完了checkpointはdocsのみ、runtime未変更、旧docs branch削除を明記している。旧 `docs/issue-294-user-context-architecture` は再開しない。#232 / PR #235の自然言語memory UXと保護契約は既存foundationとして利用する。

### 既存read経路

[userPlanningContextPromptSelectionV2.ts](../../../../src/features/userPlanningContext/userPlanningContextPromptSelectionV2.ts) はactiveな記録からcore最大10件、relevant最大10件、補助recent fallback最大4件を選ぶ。関数自体は時刻順ソートせず、受け取った配列順を利用する。件数制限があることと、request全体のtoken予算が管理されることを同一視しない。

[weeklyPlanningStableV5SemanticContext.ts](../../../../src/features/weeklyPlanning/application/weeklyPlanningStableV5SemanticContext.ts) は既存Graphのtask/component/workloadからscopeキーを作る。今回のuserTextは記憶用scopeキー生成に直接使われず、選択結果のscope/relevanceTierはモデル投影時に除かれる。新しい話題の初回missと適用範囲の消失は、この接続点でcharacterizeする。

[weeklyPlanningEpisodicMemoryV5.ts](../../../../src/features/weeklyPlanning/semantic/weeklyPlanningEpisodicMemoryV5.ts) はactive Factのsourceを最大8episode、12KiBの標準上限で回収する。これは会話横断のepisode storeではないが、直近の会話より前の根拠を一切保持していないわけでもない。[weeklyPlanningSemanticPublicStateV5.ts](../../../../src/features/weeklyPlanning/semantic/weeklyPlanningSemanticPublicStateV5.ts) がこの根拠を再生成するため、新しい長期episodeを同じfieldへ混ぜない。

### 既存write経路

[userPlanningContextTypes.ts](../../../../src/features/userPlanningContext/userPlanningContextTypes.ts) はowner、origin、会話/turn出典、時刻、lifecycleを持つ。[userPlanningContextSpace.ts](../../../../src/features/userPlanningContext/userPlanningContextSpace.ts) と [userPlanningContextRepository.ts](../../../../src/features/userPlanningContext/userPlanningContextRepository.ts) にlocal側と共有側のmergeがあり、後者はFirestore transactionと共有revision、user_confirmed保護、revoked tombstoneを持つ。

[weeklyPlanningTurnSideEffects.ts](../../../../src/features/weeklyPlanning/application/weeklyPlanningTurnSideEffects.ts) は記憶とGraphのprepare/rollback/complete、確定後通知を管理する。[UserPlanningContextContext.tsx](../../../../src/features/userPlanningContext/UserPlanningContextContext.tsx) は通知後の同期と自然言語設定保存を担当する。新しい処理がこの確定境界を飛び越えない。

### 最初に再現する懸念

通常記録とtombstoneが同じ200件の切り詰め対象であり、削除guardが押し出される場合を試す。stage時点のsnapshotを確定する経路と、生成中の設定編集/forgetの競合を試す。設定保存のAI displayTextと原発話sourceTextを分離できているかを確認する。local読取失敗・形式異常が空snapshotや暗黙deleteへ縮退する経路を、正当な空と区別する。これらは再現前に「確認済み本番bug」としてclose条件を作らない。

## 2. 作業単位の運用

UC-P0等はこのworkの識別子であり、GitHub Issue番号ではない。全phase分のbranch/PRを先行作成しない。同じrelease unitは一つのIssue owner、active branch、PRで修正・review・CI修復を続ける。別ownerが必要な本当に独立したrelease unitだけ、親#294とacceptance境界を結び付けたchild Issueを検討する。

実装の最初のwrite前には、[AGENTS.md](../../../../AGENTS.md)、対象コード配下のAGENTS、current owner Issueの最新checkpoint、open/closed PR、branch一覧、現在のbase/HEAD/diffを確認する。終了したdocs branchからruntimeを開始しない。

各unitは入力となる確定版、変更する境界、検証したexact HEAD、結果、未解決事項、次の一手をIssueに記録する。新しい文書が完成してもUC-P0の実測や本番検証を完了扱いにしない。

## 3. UC-P0：現状固定とbaseline

対応するcanonical milestoneはPhase 0。既存selector、identity、local/repository merge、tombstone、読取失敗、直近会話、既存Graph由来episode、最終renderer入力を固定する。既存 `userPlanningContextPromptSelectionV2.test.ts`、`userPlanningContextRepository.test.ts`、`userPlanningContextSpace.test.ts`、`weeklyPlanningTurnSideEffects.test.ts` を起点にする。追加テストの配置は着手時のtreeで確認し、存在しないテスト名を実行済み記録へ書かない。

fixtureには、Graphにまだない話題、同subjectの別教材、件数上限を超えたforget guard、stage中の設定編集、言い換えによるidentity、原文と表示文の相違、storage異常と正当な空を含める。既存 `weeklyPlanningSemanticPromptBudget.test.ts` を再利用し、memoryを含む最終requestのbytes/token見積り、呼出数、read時間、coverageを測る。測定値・p50/p95・母数・環境は未測定なら未測定とする。

本番挙動は変えない。到達点は呼出し箇所とproducer/consumer、fixture、測定値、再現したfailureと未再現の懸念が分かれ、次unitの受入条件が決まること。入力を小さくするために必須意味を削らない。

## 4. UC-P1A：非破壊的read boundary

前提はUC-P0の正常系比較と読取異常fixture。提案ファイルは `application/userContextReadContracts.ts`、`application/userContextReadService.ts` とV1 read adapter。既存repository revisionをread portに保持し、正当な空、no_match、partial、unavailableを区別する。

旧load関数をそのまま包んで例外を空にするのではなく、純粋decoder、日時投影、raw storageアクセスを分離する。形式不正のreadでremoveRawを呼ばず、隔離・修復を明示操作にする。正常入力は既存V2 selectorを利用し、semantic contextへ渡すlegacy shapeも維持する。

保存schema、provider、scope/evidenceの新しいモデル投影、AI呼出し、vector DBは変更しない。UIへstorage判断を直書きしない。完了条件は正常系の選択同値、保存副作用なし、読取異常時にdeleteや空上書きなし、revisionを追跡できること、consumer入口が一つであること。

rollbackはschemaを戻さずadapter/caller接続を戻せる構成とする。ただし異常readの非破壊化は保持し、旧暗黙delete経路を復活させない。最初のruntime PRはこの単位へ限定する。

## 5. UC-P1B：共通mutationとstaging整合

対応はcanonical Phase 1。UC-P1Aのread/decoderを前提に、local stageとrepositoryから同じ純粋mutation policyを使う。`userPlanningContextSpace.ts`、`userPlanningContextRepository.ts`、`weeklyPlanningTurnSideEffects.ts` と新policyが主な接点。最初はV1表現内で扱い、identity全面移行と同じPRにしない。

operation ID、owner、source、expected revisionを検証し、古いsnapshotの丸ごと上書きではなく最新状態への操作適用へ寄せる。prepare/rollback/completeと既存atomic turnの保証を保持し、途中の生成結果や取消しを正式記憶にしない。

この段階の保証は同一runtimeのstage/prepareと共通policyまで。reload・複数端末を跨ぐ永続operation receiptはUC-P1Cのschema/旧client対策と一体にする。旧clientに消され得るmetadataだけを先行追加して「永続冪等」と呼ばない。

完了条件はstage後の編集/forgetを上書きせず、同一操作の重複適用を防ぎ、失敗・取消し・rollbackでGraphと記憶が不整合にならないこと。rollbackでも新しい編集・削除を失わない。単にテストassertionを弱めて既存競合guardを外さない。

## 6. UC-P1C：schema・証拠・tombstone・同期移行

canonical Phase 1と#164の共同境界。前提は共通policyと、#164が決めるauthoritative write protocol。stable identity、原発話と表示文の分離、永続operation receipt、protected tombstone、memoryEpochを一つの互換性計画として扱う。新schemaの名称/保存先を、この文書だけで既存V2 UIと同一視しない。

新形式のread互換を導入し、owner/revision条件付きのidempotent migrationを行い、write authorityを切り替える。旧clientが新metadataや削除状態を消せないRules/transaction/protocol条件を決める。local replica、共有正本、outboxを別truthにせず、無期限dual-writeを行わない。

失敗時の再開、migration再実行、旧端末からの書込、2端末の同時訂正、offline→reload→reconnect、response loss→retry、200件上限後の再抽出を試す。元発話が不明の記録へ引用やspanを捏造せず、元authorityと証拠欠落を別に扱う。

完了条件はsource/retrievalのforgetと、適用対象の共有経路のanti-resurrectionが実行済み証拠で確認されること。unit testだけで共有forget完了としない。rollbackは新しいtombstone/protocolを読める状態を維持し、古いbinaryへ戻すだけの手順にしない。#164のWASM検討等は前提に含めない。

## 7. UC-P2A：bounded retrievalの接続

対応はcanonical Phase 2〜3の読取部分。前提は必要なidentity/forget/競合契約と、#152の対応trust-boundary検証。初期実装はembeddingなし、AI rerankerなし。read serviceでeligibility、current-state conflict、順位、予算を分け、scope/origin/valid time/sourceを保持するprojectionへ接続する。

まず同じsnapshotへ旧V2と新selectorを走らせるshadow比較を行い、ID、採否理由、欠落、bytes、時間だけを観測する。shadowは別providerへ実データを二重送信する許可ではない。fixtureと同意済みpilotを区別する。

完了条件は別owner/scope/revokedの除外、現在値のshadowingなし、no_matchを無関係情報で埋めないこと、最終request予算遵守、記憶なしでも通常計画が成立すること。予算と品質の閾値はbaselineを測った後、変更結果を見る前に固定する。

pilotの比較で採用が決まったら旧selectorのproduction正経路を撤去する。rollbackは既存の安全なbaselineへ戻し、owner/forget guardを迂回しない。semantic retrievalの必要性が未証明ならvector DBを追加しない。

## 8. UC-P2B：必要時だけの追加読取

前提はUC-P2Aで新しい話題のmissが再現すること。既存semantic ownerへneeds_contextを追加し、`weeklyPlanningStableV5SemanticTurn.ts` とnormalizer/pipeline境界を検証する。generic semantic経路のみを対象とし、focused authorization・approval・saveへ入り込ませない。

中間出力はread-onlyで、最終semantic_resultだけを一度適用する。1turn最大1回の追加読取、request全体の呼出数/deadline、現行semantic repair上限を検証する。二回目の要求、abort、timeout、重複response、不明scope、存在しないID、生成中のrevision更新を試す。

完了条件は必要な初回話題を追加情報で解決でき、不要なturnの呼出数が増えず、無限loop・二重commit・過去記憶のcurrent-turn factへの昇格がないこと。providerのschema envelope互換はadapterと実APIで確認する。無効化すればUC-P2Aの経路へ戻る。

embeddingの比較はこの経路の安定後に別release unitとする。rerankerと同時に導入せず、モデル名の印象ではなくmiss/誤採用/費用/latencyの差を根拠にする。

## 9. UC-P3：会話横断episodeとworking-memory projection

対応はcanonical Phase 2のepisodeとPhase 5のprojection。既存Graph由来episodeとtraceは残す。#47の共有session revision、#164の永続処理authorityをconsumeし、#294専用の別conversation databaseを作らない。

最初のrelease unitで確定イベントと永続outbox、jobのclaim/retry/epoch検査を実装し、AI抽出を無効にしたままfailure injectionを通す。次のunitでbounded EpisodeCandidate抽出、最後に最近の会話とsummary投影を接続する。job基盤、prompt、圧縮、UIを一括PRにしない。

worker停止/再開、重複配送、source訂正、forget中の生成、出力なし、provider failure、古いsummary、reloadを試す。既存 `episodicMemory` の後段再生成と衝突しない別fieldを使い、最終promptまで追跡する。

完了条件は二重記録・復活がなく、summaryの有無でpending questionや承認対象が変わらず、抽出障害で成功済み保存を巻き戻さないこと。基盤がない段階で「後で実行されるはず」の自動抽出をreleaseしない。無効化後も確定イベントとforget guardを失わない。

## 10. UC-P4：surface policyとrenderer

canonical Phase 4。安全でboundedなretrievalが前提。最初はignore/use_silentlyだけを導入し、既存action contractを維持する。続くunitでcallbackと不確実性による確認を追加する。

`weeklyPlanningStableV5DialogueContracts.ts`、prompt、validation、既存rendererのテストを変更候補とし、全記憶の再選択や自由なstate更新をrendererへ委譲しない。currentTurnGroundingのACKを優先し、surface historyは実表示/commit後に記録する。

完了条件は不要な反復・突然のsensitive recallを抑え、今回の訂正ACKを欠落させず、キャンセル出力を言及済みにせず、契約違反時に既存fallbackへ戻ること。自然さより先にevidenceとactionの整合を判定する。rollbackはcallback機能を停止しても現在の対話と計画条件を保つ。

## 11. UC-P5：必要性を評価したconsolidation/reflection

canonical Phase 5。UC-P2/P3の運用で重複・矛盾・古い情報がどれだけ残るかを測り、統合やprojection更新の必要性を判断する。品質条件を満たす簡単な処理で十分なら、常設AI reflectionは採用しない。その判断と満たした条件を記録し、親DoDを黙って省略しない。

AIは統合候補だけを返す。assistant自身の過去の提案を再読し、ユーザーの恒常的な好みへ昇格する循環を禁止する。観測/集計は#47、正式memory mutationは共通policyへ通す。original source、revision、epoch、根拠強度を保持する。

完了条件は元根拠への追跡、訂正/forgetでの失効、再計算、重複防止、生成前後のepoch一致。reflectionを止めても明示設定と正式な保存結果は失われない。summary/indexのretention cleanupを、原証拠の無断削除と混同しない。

## 12. UC-P6：ユーザー操作とforgetの全経路

canonical Phase 6。既存「AIが覚えていること」の追加/編集/削除UIを発展させ、別管理画面を重複作成しない。内容、出典、訂正、忘却、共有反映待ち、利用停止をdesktop/mobileで理解できる形にする。

「記憶として使わない」「共有状態へ反映済み」「アカウントデータの物理削除」を区別する。offline端末と送信済みprovider情報の限界を明示し、完了していない同期を完了表示しない。通常auditは不要な本文を保持せずID/結果に縮退する。

基本forgetは前段から必須であり、このphaseまで削除保証を先送りしない。ここではsource、retrieval、summary、cache/index、job、生成途中の回答、旧端末、offline/reloadを跨ぐ全経路と操作性を完成させる。rollbackでもrevoked状態を利用可能へ戻さない。

## 13. UC-P7：縦断評価とproduction rollout

canonical Phase 7。複数session、日付変更、教材progress更新、訂正、forget、助言の一時採用、別教材への話題転換を組み合わせる。同一modelでharness比較を先に行い、その後で同一bundle/action/出力予算のrendererをblind比較する。

wrong owner、revoked revival、current-state shadow、未承認保存は独立したrelease blockerであり、平均点や日本語の自然さで相殺しない。有限のfixture集合で0件だった結果を、全入力に対する数学的保証と書かない。母数、引分け、評価者不一致、既存caseの退行も記録する。

#213へcoverage、selected/rejected件数、追加読取、prompt bytes/推定token/実usage、latency、fallback、policy/provider versionを渡す。raw prompt、response、原発話、memory本文を通常analyticsへ流さず、未知のusage/costはunknownを維持する。障害調査は#45/#89等のrestricted診断経路を使う。

rolloutはdisabled→shadow→許可されたpilot→拡大。各機能を止められることと、owner/forget/server authorizationを停止できないことを検証する。exact HEADのunit/integration、実API、browser、同期、production evidenceをIssueに残す。文書完成や一回の良い会話で#294をcloseしない。

## 14. 受入シナリオと評価データ

current-stateのシナリオでは、過去200語、本棚350語、今回400語への訂正を同時に用意する。現在値は350語、400語はownerへの更新候補、200語は必要時のhistoryと区別し、記憶サービスによる保存済み偽装がないことを試す。

scope/timeでは教材Aの希望をBへ適用せず、「今週だけ」と「今後も」を区別する。期限経過から受験・合格・失敗を創作しない。明示設定を弱い推定で上書きしない。

並行実行では端末Aのrevision Nからの遅延抽出と、端末BのN+1訂正を競合させる。forget後にactive件数上限を超え、古い会話再抽出、旧client再接続、summary/cache/index利用を通して同じidentity/source系列が復活しないことを検査する。

evidenceでは原文「短く区切りたい」と表示文「毎日15分」を分け、根拠のない頻度/数値の追加をuser_statedとして保存しない。正しいspanがあるだけでは意味の過剰一般化を検知できないため、semantic評価を別に持つ。

助言ではassistantの「朝に勉強しましょう」とuserの「今週はそれで」を使い、現在のadoption以外に影響を出さず、恒常的な朝型preferenceや最終予定保存を作らない。

追加読取ではGraphにない新しい話題を参照し、一回で終了、不明時の確認、abort/timeout後の無更新を確認する。圧縮では直近より前の経緯を保持してもpending targetとapproval revisionは正式状態のままとし、圧縮失敗/増大/古いsummaryでも変わらないことを試す。

securityでは記憶本文、教材名、episodeにrole風文字列、閉じタグ、Unicode境界、保存命令を含める。権限・承認・current-turn factへ昇格しないことを#152のcorpusへ集約し、禁止語表をproduction意味判定にしない。

fixtureはcase ID、固定clock、source snapshot/revision、turn列、必須/禁止の根拠ID、許可surface mode、期待/禁止mutationを持つ。property-based testは既存fast-checkを利用し、同一操作再送、順序変更、無関係記録の追加で不変条件を検査する。日本語全文一致ではなく、必要情報と禁止主張を評価する。

## 15. 検証手順

実装時の基本コマンドは現行package.jsonの `npm run typecheck`、`npm run test:run -- src/features/userPlanningContext`、`npm run test:weekly-ai:conversation:foundation`、`npm run verify` を再確認して使う。既存episode・prompt-budget・formal-turn testsも変更責務に応じて実行する。これらは手順であり、この文書作成時の成功記録ではない。

保存/Rules変更はmemory専用owner/revision/operation/旧client/transaction concurrency testsを既存Emulator基盤へ追加する。現行 `test:firestore-rules` のprofile-registration検証だけではmemory protocolの成功証拠にならない。

実APIは現在のmainにあるdispatch/observation経路を利用し、通常PR pushへ有料API実行を追加しない。baselineと候補のmodel/prompt/bundle/出力予算/repair条件を固定し、引継ぎはexact HEADとterminal resultへ結び付ける。Firestore Rulesの本番変更が必要な場合は既存OIDC/WIF workflowとread-backを利用し、静的鍵を追加しない。

文書だけのPRはexact diff、canonical pathの維持、Markdown相対リンク、current-reference整合を検証する。アプリのbuild/testを未実行なら未実行と書き、source上の設計を実装の検証結果へ置き換えない。自動開始されたPR CIが必要な場合はterminal結果まで確認する。

## 16. Issue間の統合判断

#294はapp-wide read/write memory、retrieval、episode、surfacing、forgetのownerとして再利用する。#47は共有会話/Fact Graphとoutcome観測・集計・個別最適化を保持し、共通contextをconsumerとして使う。別profile/episode/検索正本を作らず、#47全体を統合closeしない。

#164はlocal replica、共有authority、操作ID/revision、offline queue、旧client、migration/rollbackを提供する。read adapterは既存repositoryで進められるが、新しい共有write/forgetの有効化には該当契約が必要。WASM等の全体完了を一括依存にしない。

#152とDraft PR #174はstored/indirect injection、provenance、durable poisoning、rendererのsecurity評価を維持する。今回の文書branchへ既存security差分を取り込まず、別security Issue/PRを作らない。再開時にcurrent mainへ整合させ、変更経路の検証を行う。古いHEADの成功はcurrent-mainの証拠ではない。

#246はTurnPurpose、ActiveInteraction、advice proposal/review/adoption/promotionのownerを保持し、共通contextとfreshnessをconsumeする。#269/#270は既にmainのbaselineであり、availabilityやatomic formal-turnを再実装しない。助言生成をdurable memory生成と同一視しない。

#213は軽量telemetry、AI usage/versioned pricing、bounded admin read modelを提供する。memory側に別cost calculatorや管理画面を作らず、#160を再開しない。#187の教材identity/進捗と#190の明示学習方式設定は、それぞれのownerから現在値を読む。

#45のtrace privacy/lifecycle、#89のproduction recovery、#51の複数端末承認、#128の保存済みpreview互換は別の完了条件を持つ。接点を関連付けるが#294完成を理由にcloseしない。予定はscheduling domainのcompleted #278 baselineを使い、#278を再開しない。

#212は開発エージェントのskills/workflows用research backlogであり、利用者向けアプリruntimeとは別である。Codexを参考にするという理由で統合しない。

## 17. 文書整備とruntimeの状態を分ける

2026-09-12の整備は、既存#294の管理情報を更新し、supporting設計・本work・既存roadmapと入口を接続する文書変更である。新しい親Issueや全phase用のplaceholder PRは作らない。最新branch/PR/HEADと文書検証の結果は#294のcheckpointを参照する。

文書PRをマージしても、UC-P0の実測、UC-P1A以降のコード、#152の再検証、本番への投入が完了したとは扱わない。次のruntime unitは現時点のmainとactive ownerを再確認した上で、roadmapに従って着手する。
