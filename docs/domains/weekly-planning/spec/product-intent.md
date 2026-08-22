# Weekly Planning Product Intent

Status: canonical product specification
Updated: 2026-08-23

Runtime contract: [../architecture/current-contract-v5.md](../architecture/current-contract-v5.md)
Scheduling policy: [../policies/scheduling.md](../policies/scheduling.md)
Human grounding: [../policies/human-grounding.md](../policies/human-grounding.md)
Current roadmap: [../roadmap/current.md](../roadmap/current.md)

## Purpose

週間計画は、ユーザーが自然な言葉で伝えた「何を進めたいか」「いつまでか」「どの時間を使えるか」を、既存予定・時間割・進捗と組み合わせ、実行可能な一週間の学習案へ変換する機能である。

単に空き時間へ作業を詰めるのではなく、必要な不足情報だけを対話で確認し、ユーザーが内容と前提を理解した上で承認できる計画を作る。

## User outcomes

利用者は次を行える。

- 曖昧な初期入力から週間計画の相談を始める
- 学習対象、範囲、現在進捗、今回の到達目標、期限、利用不可時間、希望を会話で追加・修正する
- 既存予定・時間割・生活制約と衝突しない候補を見る
- 計画に大きく影響する未確定事項だけを確認する
- 低影響の曖昧さに会話を支配されず、必要な論点から先に進める
- 未保存previewを週/日単位で確認する
- 会話またはUIで条件を修正し、最新条件でpreviewを再生成する
- 明示承認した内容だけを通常予定として保存する

## Product principles

### Low-friction dialogue

既知の事実を繰り返し質問しない。すべてのslotを順番に埋めるのではなく、現在の計画可否への影響が大きい不足・矛盾・選択だけを解決する。

安全な候補を提示できる場合は、自由回答を要求する前にreviewableなproposal/optionを提示できる。ただしproposalは未承認のままscheduleへ適用しない。

blockingな不確実性は必要な時点で修復する。一方、計画を安全に進められるlow-impact uncertaintyはdeferできる。ただし影響を持つ境界より前には再度解決する。詳細は [Human Grounding Policy](../policies/human-grounding.md) を参照する。

### Shared-ground first

アプリ内部の一般heuristicや観測から推定した傾向は、ユーザーと共有済みの事実ではない。影響が大きい場合は提案として表面化し、accept/modify/rejectできるようにする。

今回だけの方針とdurable preferenceを分離する。

### Progress is not the same as target

「全体でどこまであるか」「すでにどこまで終わったか」「残りはいくつか」「今回どこまで進めたいか」は別概念として扱う。

例:

```text
scope total: 20問
completed: 12問
remaining: 8問
this-plan target: 残り8問全部 / 今日は4問 / できる範囲
```

現在進捗からremainingを導出できても、それだけで今回のtargetを勝手に決めない。open-ended workに架空の総量を作らない。

### Preserve meaningful work units

学習内容には「分けてもよい作業」と「一まとまりで扱うべき作業」がある。

scheduler都合だけで意味のある作業単位を勝手に分割しない。atomic / splittable / needs-breakdown等のtyped stateに従い、必要な分解はsemantic/dialogue layerで解決する。

### Deterministic safety

AIは自然言語の意味理解とtyped decisionの自然な説明を担当する。次はapplicationが決定する。

- accepted state / revision / lifecycle
- clarification / confirmation necessity
- proposal acceptance scope
- authoritative availability
- scheduler placement / feasibility
- preview freshness
- approval / save / persistence

AIが生成した文章だけで予定を確定しない。

### Preview before commit

計画候補は未保存previewとして表示する。previewは現在のowner、conversation、state revision、source factsに束縛される。

条件が変わった場合は古いpreviewを確定せず、最新条件で再計算する。保存には明示的な承認を要求する。

## Scheduling intent

週間計画は、空いている時間を最大限埋めることを目的にしない。**実行可能性と回復余地を両立させる**。

current Stable V5の7日horizonでは、最初の6日をnormal placement days、7日目をreserve dayとして扱う。通常は6日側へ負荷を分散し、7日目を遅延・急な変更・見積もり誤差の吸収余地として残す。必要なhard constraintやcapacity不足がある場合はreserveも利用する。

また、新しい予定をrequest-timeの`notBefore`より前へ置かない。existing plans、timetable、accepted hard unavailable/life constraintを空き時間として扱わない。

この6+1 baselineはcurrent production scheduling policyであり、単なるhistorical noteではない。一方、soft cap、session長、細かなscoring定数はtunable policyであり、永久不変のproduct lawとは区別する。

詳細は [Scheduling Policy](../policies/scheduling.md) を参照する。

## Life / availability intent

起床時刻・睡眠終了時刻と、実際に学習を開始できる時刻は同一とは限らない。食事、身支度、移動等を考慮する必要がある場合は、それを別のtyped availability/constraintとして扱う。

ユーザーに生活の全項目をformのように聞くのではなく、計画結果へ影響する境界だけを自然な対話で確認する。

## Memory / personalization

週間計画は次を区別する。

- current conversation / current week accepted state
- durable explicit preference
- observed learning evidence / derived profile

一度の会話や一週間の採用を無期限profileへ自動昇格しない。詳細は [../policies/adaptive-memory.md](../policies/adaptive-memory.md) と personalization documentation を参照する。

## Failure behavior

曖昧・矛盾・AI failure・schema failure・source failureを「成功した計画」として隠さない。安全に続行できない場合はstateを壊さず、必要な確認または再試行を提示する。

legacy raw-text parserを意味理解のfallbackとして復活させない。

## Acceptance boundary

週間計画機能のproduct-level完了条件は次である。

- dedicated AI planning surfaceから自然に相談を開始できる
- accepted factを失わず、訂正が古いderived state/previewを適切に無効化する
- current progressと今回のtargetを混同しない
- atomic workをscheduler都合で勝手に分割しない
- existing plans・timetable・hard/life constraint・notBeforeを破らない
- current 7-day baselineのreserve/slack behaviorを意図せず失わない
- 未了承proposalや内部heuristicをsilent applyしない
- previewと保存済み予定を区別する
- explicit approvalなしにsaveしない
- desktop/mobileで主要な会話・preview・承認操作が成立する
- deterministic regression、Browser Regression、必要なreal-model evaluationで責務境界を検証できる

2026-08-22以前の詳細な初期計画書は [historical product plan](../../../archive/weekly-planning/legacy/product-plan-pre-stable-v5.md) として保持する。旧parser、旧UI、当時の固定実装手順はcurrent contractを上書きしない。ただし、そこで確立され現在のcode/testsでも生きている原則はcurrent owning docsへ移管して維持する。
