# User Context Current Roadmap

Status: canonical current execution order
Updated: 2026-09-13
Owner Issue: #294

全体の責務は [architecture](../architecture/memory-and-conversation.md)、継続する規則は [policy](../policies/memory-lifecycle-and-surfacing.md)、品質条件は [quality](../quality/regression-scenarios.md) を正とする。実装インターフェースは [supporting service design](../architecture/context-service-contract.md)、変更箇所と受入条件は [実装work](../work/20260912-context-harness-delivery.md) を参照する。

## Current phase

Phase 0のcanonical documentation導入はPR #302で完了している。2026-09-11のIssue checkpointでdocs-only merge、旧docs branch削除、本番runtime未変更を確認した。旧 `docs/issue-294-user-context-architecture` をactiveとして扱わず、再作成もしない。

残っているのは現行foundationのcharacterizationとbaseline実測、および後続runtime実装である。2026-09-12〜13のsupporting設計・work・管理情報の整備は、この実測や実装を完了にしない。現在のbranch/PR/HEADと検証結果はIssue #294とそのactive PRの最新checkpointを参照する。

週間計画のproduction queueでは [weekly-planning roadmap](../../weekly-planning/roadmap/current.md) の#152 / Draft PR #174を先に扱う。#294の監査・docs整備は先行できるが、新しいmemory情報を本番入力へ出す経路は対応するsecurity/provenanceの検証を消費する。別のsecurity branchを作らない。

## Execution discipline

実コードを調べ、既存保証をcharacterizeし、一つの責務境界を導入して検証し、consumer/producerを移し、縦断動作を確認する。最初にvector DBへ置き換えたり、userPlanningContext全schemaを書き直したりしない。

一つの論理release unitにつきactive branch/PRは一つ。同じ修正・review・CI retryを同じPRで続ける。全phaseのbranchやplaceholder PRを先行作成しない。新しい別ownerが必要な場合だけ、責務とacceptanceが独立したchild Issueを明示的に作る。

各実装writeの前にcurrent main、最新owner checkpoint、既存branch/PR/diffを再確認する。閉じたdocs branchをruntimeに再利用しない。実装済みと主張するにはexact codeと実行済みの検証を対応させる。

## Release order

作業IDは実装work内の識別子であり、Issue番号ではない。基本の順序はUC-P0、UC-P1A、UC-P1B、UC-P1C、UC-P2Aとする。UC-P0は現状固定/計測、UC-P1Aは既存正常選択を保つ非破壊的read boundary、UC-P1Bは共通mutation/staging、UC-P1Cは#164と整合するschema/証拠/tombstone/同期移行、UC-P2Aはeligibility・競合・予算を持つbounded retrievalである。

UC-P2Bの追加読取は、UC-P2Aの評価で初回話題のmissが必要性を示した場合に導入する。必要性がなければ実装を増やさず、判断と残る品質条件を記録する。embedding/rerankerは別の比較単位とし、追加読取やmodel変更と同時導入しない。

2026-09-13の合意により、Agents APIは情報収集を伴う学習相談の助言候補生成に限定する。[UC-E0の限定相談評価](../../external-integrations/work/20260912-managed-agent-runtime-evaluation.md) は#246/#187の作業であり、User ContextのUC-P0〜P7、特にUC-P3の前提ではない。記憶抽出・統合・定期要約・検索engineをAgents APIへ移す旧比較案は取り下げる。相談の本番有効化には対象構成のLunaと品質・費用・安全性の検証が必要だが、その検証待ちで記憶整備を止めない。

次にUC-P3で会話横断episodeとworking-memory projectionを接続する。確定イベント・dispatch receiptの永続境界、既存基盤を利用した必要最小限のexecutor、AI抽出、会話圧縮は別release unitに分ける。Agents API導入をこのphaseへ混ぜない。その後のUC-P4はsurface policyとrenderer接続、UC-P5は必要性を評価したconsolidation/retention、UC-P6は操作性とforget全経路の完成、UC-P7は縦断評価と本番rolloutの完了を扱う。詳細なファイル・fixture・rollbackは実装workに置く。

この順序は既存Phase 0〜7を実装単位に展開したもので、目標自体を廃止しない。安全な読取を先に作るため、Phase 3の競合解消の最小条件をUC-P2Aへ含め、Phase 2の会話横断episodeをUC-P3で実装する。安全性・forget・計測の最小条件は前段から必須であり、Phase 6/7まで先送りする意味ではない。

## Phase 0 — characterization and baseline

既存V1/V2の記録、repository、local/Firestore、移行、設定UI、全producer/consumer、summary/public-state/context projections、削除伝播、stale-device挙動を棚卸しする。既存bounded selector、Graph由来episode、formal-turn境界を維持する。新しい検索動作を入れる前にlongitudinal/adversarial corpusとcontext/request量のbaselineを用意する。

Exit gateは、current code/testsとtarget architectureの差、再現したfailureと未再現の懸念、測定結果、次の最小unitが明示されること。今回の静的設計だけで通過扱いにしない。

## Phase 1 — identity, provenance and lifecycle

UC-P1A〜P1Cでreadの入口、共通更新規則、stable identity、evidence/origin/authority、scope/time、replace/supersede/revoke、冪等性とanti-resurrectionを固める。保存・同期・旧client・migrationは#164、untrusted dataは#152の契約に従う。

Exit gateは訂正が競合するactive truthを作らず、forgetがreloadと適用対象のconcurrencyで保たれ、既存データを失わず読取/移行できること。原証拠の不明な旧記録から引用を捏造しない。format failureを空と扱って上書きしない。

## Phase 2 — episodic memory and bounded retrieval

UC-P2A/P2Bでowner/scope/lifecycle資格、exact entity/lexical、必要性を検証したsemantic retrieval、上限付き候補とcontextを提供する。UC-P3で会話横断episodeのprovenance/timeと永続処理を追加し、既存Graph-derived episodeとは区別する。embedding実装自体を目的化しない。

Exit gateは関連情報を会話横断で取得でき、wrong-owner/scope/revokedがsimilarityに関係なく除外され、unavailableとauthoritative emptyを区別し、保存履歴全体に比例したprompt増大へ戻らないこと。callbackはこのphaseの必須ではない。

## Phase 3 — temporal conflict resolution and rerank

current Structured State、supersession、origin/authority、validity、conflict分類を検索とprojectionに反映する。AIへ同じ重みのcurrent factとして矛盾情報を丸投げしない。bounded rerankは必要な場合だけ導入する。

Exit gateは古い教材progress・予定・preferenceが現在値をshadowせず、既知の機械的根拠で解ける矛盾を解消してからモデルへ渡すこと。初期の安全条件はUC-P2Aのrelease前から必須とする。

## Phase 4 — surface planning and natural realization

UC-P4で検索採用と言及を分離し、ignore/use_silentlyから始め、必要なcallbackと不確実性の確認へ進む。current-turn ACK、既存action、grounding、fallbackを維持する。文章を解析し直してmemory/stateを更新しない。

Exit gateはsilent useができ、隣接turnの不要callbackを抑え、敏感/不適切な想起を評価し、矛盾はsilent rewriteでなく確認へ戻せること。surface historyは表示/commit後の表現制御情報とする。

## Phase 5 — consolidation, reflection and retention

UC-P3のprojectionとUC-P5で、重複の整理、episode圧縮、見直し候補、summary/index/cache refresh、retentionを扱う。重い処理を毎turnのcritical pathに置かず、必要性と費用を測る。自律reflectionを必須にしないが、品質条件を黙って省略しない。

Exit gateは証拠より強いclaimを作らず、summaryが再生成可能で、revoked/supersededな内容が古いprojection経由で戻らないこと。確定イベントとjob/epochを検証する。相談agentのcompactionはこのphaseの記憶生成を代替せず、そのsessionから永続要約を自動作成しない。

## Phase 6 — user control and end-to-end forget

UC-P6で既存memory UXを発展させ、閲覧/訂正/forget/共有反映待ちをdesktop/mobileで扱う。retrieval/summary/cache/index/jobと同期へ失効を反映する。#164の旧端末/offline条件をconsumeし、物理削除やprovider送信済み情報との区別も表示する。

Exit gateはUIの削除とruntime forgetがずれず、古い端末やreloadで復活せず、適用範囲の全経路を実行済み証拠で確認できること。前段の実装も基本forgetを満たさなければreleaseしない。#246の相談sessionへ記憶を渡す場合は、[相談agentへの読取境界](../architecture/managed-execution-boundary.md) に従って旧sessionの利用終了と遅延結果の拒否を接続する。相談機能の導入自体をこのphaseの必須成果物にしない。

## Phase 7 — longitudinal evaluation and production observability

UC-P7で複数session/time/current-state変更/訂正/forget/一時adoptionのcorpusを実行する。precision、miss、false/stale recall、反復、不適切な表出、forget、context size、latencyを独立して評価する。重大failureを自然さの平均点で相殺しない。

#213のprivacy-preserving telemetryへ接続し、raw memory proseを軽量analyticsへ送らない。rolloutとrollback、security、ユーザー操作、同期の実行済み証拠が揃い、並行する正本がないことをexit gateとする。有限試験の0 failureを全入力への保証と書かない。

## Dependency boundaries

#47は共有会話/Fact Graphとoutcome learningを保持し、#294の共通read/episodeをconsumeする。#164はstorage/sync/operation/migrationの必要契約を提供する。初期read adapterは既存repositoryで進められ、WASM等の全体完了を待たない。新共有write/forgetの有効化時は該当契約の完了が必要である。

#152 / PR #174は既存security owner。#246はadvice lifecycleとpromotionを保持し、共通contextを使う。#187は学習相談に限定したAgents APIと外部sourceの接続・利用条件を所有する。本棚domain、scheduling domain、Actual、明示設定は各現在値を所有する。完了済み#278や#160を再開せず、#212の開発ハーネスと統合しない。#213は観測、#45/#89/#51/#128はそれぞれの運用/承認/互換性を保持する。

## Next implementation boundary

UC-P0のfixtureと実測を整えた上で、最初のruntime PRはUC-P1Aだけを対象にする。新しいLLM呼出し、vector DB、episode worker、schema全面変更、会話UI全面変更、model差替えを混ぜない。Agents API導入をこのPRの完了条件に追加しない。

文書PRのmergeはこのroadmapとworkの導入完了であり、親#294の完了ではない。新しいbranchを切る前に必ずcurrent mainと既存ownerを再確認する。
