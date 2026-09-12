# User Context：read/writeサービスの詳細設計

Status: supporting target architecture / not a shipped runtime guarantee
Updated: 2026-09-12
Owner Issue: #294

この文書は [Memory and conversation architecture](memory-and-conversation.md) を、実装インターフェースと処理境界へ具体化する補助設計である。authority・lifecycle・forget・surfacingの正仕様は [既存policy](../policies/memory-lifecycle-and-surfacing.md)、品質要件は [既存quality](../quality/regression-scenarios.md) に置く。この文書を第二の正仕様や、実装済みの宣言として扱わない。矛盾が見つかったら担当canonical文書を明示的に改訂するまで実装を止める。

実行順は [roadmap](../roadmap/current.md)、変更箇所・受入条件・再現課題は [実装work](../work/20260912-context-harness-delivery.md) を参照する。ここにbranch/PRごとの進捗を複製しない。下記の新しい型・ファイル名は提案であり、production codeの存在を意味しない。

## 1. 採用理由と代替案

採用するのは、既存のUser Contextにboundedなread/writeサービスを設け、現在値を所有するdomain、意味解釈、正式な更新、会話表現の境界を保つ方法である。既存Stable V5を汎用自律エージェントへ置き換えない。

保存記憶を単純に増量してpromptへ渡す案は変更が小さいが、古い情報、対象範囲の混同、不要な言及、入力増大を解決しない。反証となるのは、現行selectorのままで全縦断シナリオと入力予算を満たす測定結果である。その場合、追加検索機構は導入しない。

汎用エージェント基盤へ載せ替えて検索・更新を広くAIに委ねる案は、自由度と引き換えに既存Reducer、repository、承認処理と別のownerを作る。現時点では採用しない。既存境界を保ったまま複雑性・品質・費用を改善する比較結果が出た場合のみ再検討する。

採用案は既存の正常経路を先に固定し、読取、更新整合、検索品質、言及を別々に比較できる。初期段階では新しいモデル呼出しもvector DBも不要であり、変更の影響を局所的に検証できる。

## 2. 公開ハーネスから取り入れる範囲

Codexの確認対象は `c4017a87aacc7558002b7cb510025e967c1d765e`。その [memory prompt構築](https://github.com/openai/codex/blob/c4017a87aacc7558002b7cb510025e967c1d765e/codex-rs/ext/memories/src/prompts.rs) は概要を上限付きで組み込み、[V2読取テンプレート](https://github.com/openai/codex/blob/c4017a87aacc7558002b7cb510025e967c1d765e/codex-rs/ext/memories/templates/memories/read_path_v2.md) は追加の根拠が回答を変える場合に詳細を読む。V1/V2の全動作が同一とは仮定しない。StudyPlannerには「最初に小さい文脈、必要時だけ追加読取」を移し、ファイル形式やCLIの権限を移植しない。

Codexの [write実装](https://github.com/openai/codex/blob/c4017a87aacc7558002b7cb510025e967c1d765e/codex-rs/memories/write/src/lib.rs) と [pipeline説明](https://github.com/openai/codex/blob/c4017a87aacc7558002b7cb510025e967c1d765e/codex-rs/memories/README.md) からは、抽出と統合の分離、上限、claim/lease、失敗時の再実行を参考にする。README内の配置説明とコードが異なる場合、実コードを優先する。StudyPlannerでは確定イベントに対する永続jobとして適用し、任意shell、任意ファイル編集、再帰委譲は導入しない。

Gemini CLIの確認対象は `9c1b0a610534d6f8120964cf2672c07807d8fc90` の [ChatCompressionService](https://github.com/google-gemini/gemini-cli/blob/9c1b0a610534d6f8120964cf2672c07807d8fc90/packages/core/src/context/chatCompressionService.ts)。履歴の分割点、最近の情報の保護、失敗後の不要な再試行抑制、圧縮結果の検査を参考にする。閾値や呼出し回数は移植せず、StudyPlannerのpending question・proposal・approvalを型付き状態で保持する。

[LangGraphのmemory資料](https://docs.langchain.com/oss/javascript/langgraph/add-memory) のthread内状態とthread横断storeの区別、[Anthropicのcontext engineering資料](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) の必要時参照も補助資料とする。いずれのライブラリも導入を決定したものではない。公開実装は設計根拠であり、StudyPlannerの要件や安全性の証明ではない。

## 3. 情報の正本

現在の進捗はBookshelf/StudyMaterial、予定はScheduleEvent/Occurrence、実績はActual、明示設定は各設定ownerから読む。過去の「200語まで終わった」というepisodeがあっても、本棚が350語なら現在値は350語である。User Contextへ可変の現在値を複製しない。

今回のユーザー発話が「今は400語」に訂正しても、読取サービスが本棚を裏から更新しない。保存済み350語と、新しい400語の更新候補を分け、担当ownerの通常の更新境界を通す。現在値優先とはユーザーの訂正を無視することではない。

Working Stateは現在の会話、pending question、未確定事項、proposal revisionであり、回復のため永続化してもdurable preferenceにはならない。Semantic Memoryは別の現在値ownerがない再利用可能なユーザー固有情報、Episodic Evidenceは過去の出来事の証拠である。観測から傾向を作る処理は#47へ渡す。

summary、embedding、検索cacheは再生成できるprojectionとする。projectionを再抽出して原発話より強い証拠へ昇格する循環は禁止する。

## 4. モジュールと依存方向

`src/features/userPlanningContext/application/userContextReadService.ts` をcaller向けfacade候補とする。`userContextReadContracts.ts` が型を持ち、保存場所の読取はport/adapterへ分ける。facadeや純粋policyがReact、provider、Firestore実装をimportしない。既存selectorを内部利用し、初回から空の抽象化ファイルを大量に作らない。

eligibility、conflict、selection、budgetに独立した変更理由が生じたら、それぞれ `userContextEligibility.ts`、`userContextConflictPolicy.ts`、`userContextSelection.ts`、`userContextBudget.ts` へ分ける。巨大なHarnessManagerへ全責務を集約しない。

`weeklyPlanningStableV5SemanticContext.ts` はbundleをpublicStateSummaryへ投影するadapter、`weeklyPlanningStableV5SemanticTurn.ts` はrequestの基準時刻・scope・revisionを固定するcallerとする。Graph解釈、temporal resolution、scheduler、approvalは移動しない。

`application/userContextMutationPolicy.ts` をlocal stageとrepository transactionから共有する。`weeklyPlanningTurnSideEffects.ts` のprepare/rollback/completeと通知境界を保つ。`dialogue/userContextSurfacePolicy.ts` の結果は既存renderer契約へ渡し、第二のrendererやdialogue action ownerを作らない。

会話横断episodeは既存 `episodicMemory` に混ぜない。後段 `weeklyPlanningSemanticPublicStateV5.ts` がGraph由来の根拠を再生成するため、新しい `userContextEvidence.episodes` 等の別領域へ接続し、最終promptまでの消失・重複をintegration testで確認する。

#246の相談は同じread contractをconsumeする。既存のavailability/freshness型を調べて再利用し、似た名前の別契約を増やさない。

## 5. Read契約

owner、conversation/request ID、権限、revision、clock、予算はアプリから渡す。AIにownerを選ばせない。今回の文章、記憶本文、教材名、過去の会話はuntrusted dataであり、指示権限を持たない。権限検査は型宣言やpromptだけで済ませず、read adapterと必要なserver境界でも行う。

型の骨格は次のとおり。既存domain型を再利用するための設計記法であり、このままproductionへコピーする完全実装ではない。

```ts
type SourceRead<T> =
  | { kind: 'available'; value: T; revision: string;
      completeness: 'complete' | 'partial'; freshness: 'current' | 'stale' }
  | { kind: 'unavailable'; reason:
      'not_ready' | 'offline_unverified' | 'permission_denied' | 'invalid_data' };

type ScopeRef = {
  kind: 'global' | 'subject' | 'activity_kind' | 'goal' | 'material';
  key: string | null;
  binding: 'canonical' | 'legacy_exact' | 'unresolved';
};

type EvidenceRef = {
  sourceKind: 'user_message' | 'domain_event' | 'legacy_record';
  sourceId: string;
  sourceRevision: string;
  span: { start: number; end: number } | null;
};

type ContextRequest = {
  ownerId: string;
  conversationId: string;
  requestId: string;
  now: string;
  timeZone: string;
  boundScopes: readonly ScopeRef[];
  graphRevision: number;
  currentUserText: string;
  budget: { maxCandidates: number; maxMemoryTokens: number };
};

type MemoryContextItem = {
  id: string;
  revision: number;
  scope: ScopeRef;
  origin: 'user_confirmed' | 'user_stated' | 'system_inferred' | 'migration';
  applicability: 'current' | 'historical' | 'needs_confirmation';
  validFrom: string | null;
  validUntil: string | null;
  text: string;
  evidence: readonly EvidenceRef[];
};

type ContextBundle<CurrentFacts, WorkingState> = {
  requestId: string;
  memoryEpoch: number;
  dependencies: readonly { sourceId: string; revision: string }[];
  currentFacts: CurrentFacts;
  workingState: WorkingState;
  memories: readonly MemoryContextItem[];
  episodes: readonly MemoryContextItem[];
  coverage: 'sufficient' | 'partial' | 'no_match' | 'unavailable';
  omittedReasons: readonly string[];
  tokenEstimate: number;
};
```

実装時はCurrentFacts/WorkingState、turn purpose、omitted reasonを既存strict型・有限のcodeへbindする。`legacy_exact` は旧keyの互換表現であり、raw日本語を正規表現で意味分類してよいという許可ではない。sourceが不正なのにAIへ修復させて現在値にしない。

完全なsourceを正常に読み、記録がない場合のみauthoritative emptyと扱う。sourceは読めたが検索該当なしならno_match、読めないならunavailable、上限等で一部だけならpartialである。これらを記憶削除・設定初期化の根拠にしない。

取得時刻とrevisionベクトルを固定し、適用・表示前に参照依存を再検証する。候補の追加・supersession等で選択集合自体が変わる場合はselection epochも検査する。無関係な別教材の更新で全応答を棄却することは避けるが、削除済み情報の混入を避ける検査を省かない。相談採用時と最終保存時には、それぞれのownerのfreshness/approval検査を別途通す。

## 6. 検索処理

検索engineへ渡す前にowner/access/scope/lifecycle/期間/sensitivityを絞り、返却後にも正本のID/revisionを検証する。revokedを低スコアにするだけの実装は禁止する。現在値を聞かれた検索と過去の経緯を聞かれた検索を分け、historicalやneeds_reviewを現在の確定条件へ混ぜない。

初期実装は現行snapshot上限内の純粋走査とする。明示scope一致、entity、語彙的関連性、時期、重複を用い、tie-breakをstable IDで固定する。文字検索は候補発見であって意味解釈ではない。検索した文章から承認・予定変更・永続保存の意思をコードで推定しない。

無関係なrecent fallbackで枠を埋めず、no_matchを正常結果として認める。使用回数は補助信号に留め、過去に使った記憶が永久に勝つ自己強化を避ける。候補数上限、採用件数、request全体のtoken/bytes予算を分ける。候補40件・採用12件・memory領域2,000推定token等は実験候補にすぎず、測定前の保証値にしない。

embeddingは許可済み候補の言い換えmiss改善を測ってから導入する。indexはsource ID/revision/scope/index versionで正本へ戻し、古いindexを直接信じない。外部vector DBを初期必須dependencyにせず、失敗時は検証済みlexical baselineへ戻す。owner/forgetのfilterを迂回するfallbackは禁止する。

AI rerankerも必要性の確認後に、候補数上限と1回上限を持つ任意処理にする。出力は候補IDの順位と理由のみで、本文・authority・lifecycleを変更できない。追加読取とrerankerを同時導入せず、どの変更で改善したかを分離する。

## 7. 必要時の追加読取

既存Graphのscopeだけでは新しい話題の初回を拾えない場合に対応する。最初はUI/ActiveInteractionの確定対象、既存Graph、必要最小限のglobal contextを使う。不足が確認された場合のみ、既存semantic interpreterが `semantic_result` またはread-onlyの `needs_context` を返せるようにする。別の検索司令塔AIを常設しない。

needs_contextはquery、必要な情報種別、scope候補、今回の原文上の根拠参照を返す。アプリがID・scope・権限・予算をbindし、読取後に同じsemantic ownerへ返す。最初の出力ではGraph、記憶、scheduler、previewを変更せず、最終semantic_resultだけを1回適用する。

追加読取は1ユーザーturnに最大1回。2回目は再ループせず、既存の確認/失敗境界へ戻す。意味解釈のrepairは現行許可上限のままとし、追加読取、semantic repair、renderer repairを含めてrequest全体の呼出し予算を設ける。abort、timeout、duplicate responseでも上限と一回適用を維持する。

正式な対象にbind済みのfocused authorization、approval、final saveへ割り込ませない。過去の記憶で現在の承認対象を変更しない。scope不明をscope無制限と解釈しない。

providerがroot unionを受け付けるとは仮定しない。固定object envelopeとnullable field等をadapterで検証し、通常semantic payloadのstrict validationを保持する。通常turnで不要な追加読取を行わないことも実API評価する。

## 8. Mutationと証拠

新しい保存形式ではstable memoryId、revision、semanticTarget、scope、evidence、valid time、recorded time、lifecycle、supersedes、schemaVersionを分離する。AIは既存記憶との意味関係を提案できるが、owner・scope・既存ID・expected revisionに基づく正式bindingはコードが行う。曖昧な関係は確認/needs_reviewにし、勝手な統合や増殖を避ける。

表示文と原発話の証拠を分ける。userEvidenceはuser messageのIDとspan、または確定domain eventへ参照する。spanは原文のUTF-16 code unitなど一つの基準に固定し、NFKC後の位置と混ぜない。参照先の存在、role、範囲、引用一致、アクセスを機械検証する。ただし引用が結論を意味的に支持するかは別のsemantic/adversarial評価であり、文字列一致だけで保証しない。

旧sourceTextが表示用のAI文章である場合、存在しない原発話を復元したことにしない。移行では元のauthorityを不当に下げず、原証拠の欠落を別の品質情報として保持する。

write APIはoperationId、ownerId、sourceEventId、expected revision/epoch、mutationを持つ。local stageは古いsnapshot全体ではなく操作をprepareし、commit時に最新状態へ共通の純粋policyを適用する。同一operationの再送は同じreceiptへ収束させ、古い抽出を新しい明示編集より優先しない。timestampだけのlast-write-winsを用いない。

reloadや複数端末を跨ぐoperation receiptはschema/同期プロトコルと一体で導入する。旧clientに消される一時的なmetadata追加だけで永続冪等性を宣言しない。通常会話のcompleteに到達しない出力は記憶やepisodeの確定根拠にしない。既存設定画面の明示操作は別のuser actionとして同じpolicyを通す。

## 9. 忘却・移行・rollback

tombstoneは通常active記録の件数上限から保護する。別collectionか同じaggregate内の専用領域かは#164のstorage ADRで決め、第二のactive本文正本を作らない。復活防止に必要なidentity/source lineage/epochを保持し、不要な本文をguardへ残さない。内容由来の照合keyやhashを匿名化とみなさず、security/privacyの検査対象にする。

当該端末ではforget後に選択・表示を停止し、共有ack前は反映待ちを表示する。生成途中で忘却された依存を使う未表示応答は棄却し、予算内で記憶なし再生成または安全なfallbackとする。末尾の一文だけ削る処理で代替しない。

offline端末への瞬時の反映や、既に外部APIへ送信した情報の遡及的な撤回は保証しない。再接続時のrevision/epoch検査、旧protocolのwriteや必要なAI requestを拒否する条件、アカウント削除を各ownerと整合させる。tombstoneを消す前には、旧epochのclient/jobが再送できない条件または同期watermarkを満たす。単なるTTLやactive件数によって削除しない。

未知の言い換え全ての同一性を完全判定する保証は置かない。忘却対象との関係が不明な再追加は明示確認へ戻す。新しいユーザーの明示的な再追加と、古い会話の再抽出を区別する。

移行は新形式のread互換を先に用意し、owner/revision条件付きのidempotent migrationを行い、writeの正本を切り替える。無期限dual-writeは行わない。rollback後も新しいtombstone/protocolを理解し、削除済み情報を復活させない。形式異常を空snapshotで上書きしない。具体的なRules/transaction/旧client遮断条件は#164と同じrelease境界で確定する。

## 10. Episode・永続job・会話圧縮

確定済みuser message、計画保存結果、Actual等を根拠にし、「提案した」「採用した」「実行した」「効果があった」を分ける。効果の未観測はunknownとする。キャンセルされた出力、未承認preview、assistantの助言をユーザーの恒常的特徴へ変換しない。

まず確定イベントを耐障害的に記録し、永続outbox/jobをclaimする。job keyはowner/sourceEventId/sourceRevision/extractorVersion、状態にはlease、attempt、nextAttemptAt、success_no_outputを持たせる。ブラウザのsetTimeoutや生存に依存せず、実行基盤がない段階では自動抽出を有効化しない。配置は既存gatewayと#164のauthorityに沿って確定する。

生成前とcommit直前にsource revisionとmemoryEpochを検証する。重複配送やworker停止/再開で二重記録しない。sourceの訂正・忘却が入った出力は棄却する。抽出/summaryの失敗で、既に成功した予定保存を巻き戻さない。

圧縮するのは完了した古いmessage区間。最新turn、必要な直近往復、pending question、proposal/approvalの型付き状態を保護する。Graphやsave receiptをsummaryから復元しない。coveredThroughTurnId、source revisions、dependency IDs、generator version、token見積りをprojectionへ保持する。

空・構造不正・依存切れ・epoch不一致・圧縮後増大は棄却し、元会話を削除しない。summaryを繰り返し再要約して原証拠を失う構成を避け、許可された元イベントから再生成する。原source削除後にsummaryだけで内容が復活する経路を禁止する。

## 11. Surfacingとrenderer

surface policyは既存policyのignore、use_silently、light_callback、explicit_callback、ask_due_to_uncertainty_or_conflictを具体化する。自然言語から新たな意図をコードで推測せず、検証済みの目的・関係・根拠を使う。過去参照が必要な場合にだけcallbackを許可し、関連する記憶を取得しただけでは言及を義務化しない。

rendererへ渡すのは、既存のapplication action、許可された事実/evidence、surface mode、禁止する断定、fallbackである。全記憶を再投入してrendererに再選択させない。rendererの文章から正式状態を逆算しない。

currentTurnGroundingによる今回の訂正等へのACKを、過去記憶のcallbackが押しのけないようにする。surface historyは実際の表示/commit後にmessageId、memoryId/revision、modeを記録し、キャンセル出力では増やさない。historyは表現制御の補助であり、ユーザーの性格や永続的事実へ昇格しない。cooldown値は無根拠に固定せず、同一会話内の反復抑制から評価する。

## 12. 予算と障害分離

request予算はsystem、schema/tool定義、正式状態、直近会話、memory、output reserveを合わせて扱う。provider別のtoken推定方法とversionを記録し、bytesの安全上限を実測token数と表示しない。各処理の局所retryを合計した最悪回数とdeadlineもrequest単位で制限する。

任意の長期記憶がunavailableなら、その記憶を使わず継続できる。予定の空き時間など必須の正式sourceがunavailableなら、それを必要とする更新・採用を停止する。既存planner-data availability契約より弱い空扱いのfallbackを作らない。

reranker失敗は検証済みdeterministic rankingへ、semantic失敗は正式状態を変更せず既存失敗経路へ、renderer失敗は既存actionのfallbackへ戻す。任意のepisode/summary/telemetry障害で確定済み保存を失敗させない。

provider secretは既存gatewayに置く。会話中の未検証モデル名・価格・日本語能力の印象はこの設計の根拠にしない。比較は同一modelでharnessを変える試験と、同一bundle/action/予算でrenderer modelを変える試験に分ける。追加検索、reranker、model差替えを一度に行わない。

read、write、episode、surface、semantic searchは段階的に無効化できる。ただしowner filter、forget guard、server authorizationをfeature flagで迂回してはならない。releaseとrollbackの検証は実装workに記録する。
