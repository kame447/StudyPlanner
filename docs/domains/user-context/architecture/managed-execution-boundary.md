# User Context：実行基盤の委譲境界

Status: supporting target architecture / no provider adoption or runtime change
Updated: 2026-09-12
Owner Issue: #294

この文書は [canonical architecture](memory-and-conversation.md) と [memory policy](../policies/memory-lifecycle-and-surfacing.md) の下で、[read/writeサービス設計](context-service-contract.md) に実行adapterを接続する場合の境界を補足する。providerの機能・利用条件・実験結果は [外部実行基盤の採否記録](../../external-integrations/work/20260912-managed-agent-runtime-evaluation.md) が所有し、実行順は [roadmap](../roadmap/current.md) のみを正とする。新しい保存authority、汎用HarnessManager、第二のsemantic interpreterを作る設計ではない。

## 1. 設計判断

採用するのは、プロダクトの意味と実行方法を分け、必要な箇所だけ実行基盤を比較できる構造である。現在の直接モデル呼出しをproduction baselineとして残す。managed runtimeの利用自体は未決定であり、この文書を追加してもAgents APIを呼ばない。

全て自作する案は既存境界との整合を取りやすいが、長時間処理の復旧や圧縮まで重複実装する費用がある。全面委譲する案は実装量を減らし得るが、正式状態、承認、忘却、provider sessionが混ざる危険がある。限定adapter案は実装と移行の負担が残るが、同じ不変条件で比較し、非採用にも戻せる。そのため限定adapterを設計上の選択肢とする。比較で利点を確認できなければ導入しない。

## 2. 委譲する可能性がある処理と、残す責務

モデルとtoolの実行loop、実行途中の復旧、技術的なsession維持、session内の自動圧縮は実行基盤の候補責務である。どこまで利用できるかはproviderの実際のcontractで検証する。

ユーザーとscopeの認可、現在の教材・予定・実績、memoryのidentity/provenance/authority、訂正・忘却、選択してよい情報、正式な会話状態、preview、承認、保存、操作の一意性はStudyPlannerが所有する。providerのsession ID、完了イベント、要約、自然文の「保存しました」は、これらの正本や成功receiptではない。

[service design](context-service-contract.md) §10および [delivery work](../work/20260912-context-harness-delivery.md) §9にある永続jobは、プロダクトとして処理すべき確定イベントと、その処理結果を失わない要求である。managed内部のmodel/tool retry、汎用session復旧、compaction実装を二重に自作する要求ではない。アプリのdispatch journal/outboxとoperation receiptは残し、選んだ実行backendの内部queueまで複製しない。自前executorを採る場合だけ、その実行に必要なclaim/lease/retryを実装する。

## 3. 接続位置と最小契約

通常のStable V5 interpreter/renderer、focused authorization、approval、final saveは初回の比較対象から外す。候補は会話横断episodeの抽出など、読み取り専用で、候補結果を既存validation/mutationへ戻せる限定的な仕事とする。相談で利用する場合も#246のadvice/adoption/promotionを迂回しない。

実装が必要になった時点で、既存applicationの実行portが再利用できるかを先に確認する。以下はportの概念であり、実装済みの型やSDK呼出しではない。

```ts
type ContextWorkRequest = {
  operationId: string;
  requestId: string;
  ownerBinding: string;
  sourceManifestId: string;
  memoryEpoch: number;
  purpose: 'episode_candidate' | 'summary_projection';
  deadline: string;
  policyVersion: string;
  allowedToolSetId: string;
  budgetId: string;
};

type ContextWorkResult = {
  operationId: string;
  requestId: string;
  sourceManifestId: string;
  memoryEpoch: number;
  outcome: 'candidate' | 'no_output' | 'failed' | 'cancelled' | 'unknown';
  candidateReference: string | null;
  executionReceiptId: string;
};
```

ownerBinding、manifest、tool set、budgetはserver/applicationが発行・解決する。モデルがowner IDや全件読取の条件を指定して認可を拡大することはできない。providerSessionIdとproviderイベントIDはadapter内部でowner/operation/request/epochへ結び付ける。クライアントから渡されたproviderSessionIdだけでresumeやreadを許さない。

入力には許可されたContextBundleとschemaだけを渡し、結果は既存のstrict検証を経た候補に限定する。schema対応を実APIで検証できない場合は、文章を正規表現で解釈して正式な候補に戻さず、そのbackendを不採用にする。元sourceの取得失敗を空と見なさない。

## 4. 更新・忘却と継続session

新しいtool readをfilterするだけでは、過去に送信した情報が継続sessionや圧縮状態に残る問題を解決しない。source訂正、supersession、forgetによって依存manifest/epochが失効したら、その実行からの未表示回答と未commit候補を無効にする。表示直前と正式適用直前の検証を両方行う。

正しく部分失効できることが証明されていないprovider sessionは継続・forkせず、利用を終了する。再実行が必要なら現在の許可済みsourceから新しいsessionを構成する。古いraw会話や要約を無検査で新sessionへ再投入しない。追加費用と再実行も元requestの上限内に制限し、上限がなければ安全なfallbackへ戻る。

アプリ側の利用停止、providerへのcancel/delete要求、providerでの削除確認と保管条件は別状態として記録する。送信済み情報の遡及的な未送信化、offline端末への瞬時の反映、保管条件以上の物理消去を保証しない。APIがdeleteを受け付けることだけで全artifactや派生状態の消去完了とは判断しない。

## 5. 認可、イベントと再送

初回の実験は実ユーザー情報を使わず、読み取り専用の小さなtool集合を使う。正式DBの管理資格、汎用shell、任意MCP接続、保存toolを与えない。tool handlerは正本へのアクセスごとにowner/scope/epochを検証し、古い実行のcapabilityを失効できるようにする。provider認証は既存gateway/server境界から外へ出さない。

アプリが保持するoperationIdとreceiptを基準に結果を一度だけ適用する。create要求の応答を失ったら、providerの冪等性または安全な照合方法を確認するまで、別sessionを盲目的に再作成しない。結果不明はunknownのまま保持し、成功にも失敗にも偽装しない。

stream/webhookの切断、重複、順序逆転、取消し後の遅延結果を想定する。認証・署名等は採用するtransportの公式契約で検証し、event IDとoperationを照合する。受信したという理由だけでGraphやmemoryを更新しない。handler停止後の再開と保持期間を実行試験する。managedの内部復旧が成功しても、アプリのtool handlerや正式commitが成功した証拠にはならない。

## 6. 予算、圧縮、観測

通常turnの追加読取最大1回と既存semantic/renderer repair上限は維持する。managed実行だからこの上限を暗黙に拡張しない。別の長時間jobに異なる予算が必要なら、個別purposeの明示contractとして定義する。初回実験ではsubagentを無効にし、呼出数、時間、入出力量、tool出力、総費用を検証可能な範囲へ制限する。

provider内部の実消費や設定で確認できない値を、アプリの推定上限で保証したことにしない。観測不能な費用・実行上限が必須条件に抵触する場合は不採用とする。#213の既存usage/pricingへ接続し、unknownを0にしない。通常の軽量metricへ本文、raw prompt、memory、秘密を送らない。

自動圧縮は実行を続けるための派生状態であり、アプリのsummary source of truthではない。pending question、proposal revision、adoption、approval、save receiptは元の型付き状態で再検証する。圧縮前後で対象が変わるケース、古い記憶を保持するケースを評価する。圧縮の内部表現や最終promptを完全に観測できるとは仮定せず、観測範囲と限界を記録する。

## 7. 移行と非採用時の動作

最初は同じfixture・許可context・期待候補を用いたoffline/明示実行の比較とする。対応する共通modelがない場合、model差とharness差を分離できたと主張しない。provider/SDK、model、利用可能なharness設定、prompt/schema/policy、source revisionを記録し、更新後も同じ回帰を通す。

採用時もprovider sessionをexportしなければユーザー記憶を復元できない設計にはしない。現在値、正式会話状態、根拠付き記憶、操作receiptをStudyPlanner側で保持し、backend停止時は現在の直接呼出し経路または明示的な再実行待ちへ戻せるようにする。同一operationの二重実行・二重commitをfallbackで作らない。

この文書の追加でproviderを採用済み、privacyを審査済み、UC-P0/P1を完了済みにはしない。最初のread boundaryは実行backendと独立に進める。採否判断と未検証事項は外部実行基盤のworkに集約する。
