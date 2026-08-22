# Weekly Planning Product Intent

Status: canonical product specification
Updated: 2026-08-22

Runtime contract: [../architecture/current-contract-v5.md](../architecture/current-contract-v5.md)
Human grounding: [../policies/human-grounding.md](../policies/human-grounding.md)
Current roadmap: [../roadmap/current.md](../roadmap/current.md)

## Purpose

週間計画は、ユーザーが自然な言葉で伝えた「何を進めたいか」「いつまでか」「どの時間を使えるか」を、既存予定・時間割・進捗と組み合わせ、実行可能な一週間の学習案へ変換する機能である。

単に空き時間へ作業を詰めるのではなく、必要な不足情報だけを対話で確認し、ユーザーが内容と前提を理解した上で承認できる計画を作る。

## User outcomes

利用者は次を行える。

- 曖昧な初期入力から週間計画の相談を始める
- 学習対象、範囲、進捗、期限、利用不可時間、希望を会話で追加・修正する
- 既存予定・時間割と衝突しない候補を見る
- 計画に大きく影響する未確定事項だけを確認する
- 未保存previewを週/日単位で確認する
- 会話またはUIで条件を修正し、最新条件でpreviewを再生成する
- 明示承認した内容だけを通常予定として保存する

## Product principles

### Low-friction dialogue

既知の事実を繰り返し質問しない。すべてのslotを順番に埋めるのではなく、現在の計画可否への影響が大きい不足・矛盾・選択だけを解決する。

安全な候補を提示できる場合は、自由回答を要求する前にreviewableなproposal/optionを提示できる。ただしproposalは未承認のままscheduleへ適用しない。

### Shared-ground first

アプリ内部の一般heuristicや観測から推定した傾向は、ユーザーと共有済みの事実ではない。影響が大きい場合は提案として表面化し、accept/modify/rejectできるようにする。

今回だけの方針とdurable preferenceを分離する。

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

schedulerはaccepted typed stateから実行可能な候補を作る。以下はproduct invariantではなく、必要に応じて変更可能なscheduling policyである。

- 何日へ分散するか
- 1sessionの長さ
- 予備日を設けるか
- どの時間帯を優先するか
- task typeごとの配置score

これらを固定の「6等分」「7日目予備」「科目名から固定時刻」等としてproduct specificationへ埋め込まない。ユーザーの明示条件、accepted preference、availability、本人の観測データ、current scheduling policyから決定する。

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
- 既存予定・時間割・hard constraintを破らない
- 未了承proposalや内部heuristicをsilent applyしない
- previewと保存済み予定を区別する
- explicit approvalなしにsaveしない
- desktop/mobileで主要な会話・preview・承認操作が成立する
- deterministic regression、Browser Regression、必要なreal-model evaluationで責務境界を検証できる

2026-08-22以前の詳細な初期計画書は [historical product plan](../../../archive/weekly-planning/legacy/product-plan-pre-stable-v5.md) として保持する。そこで記述された固定配分・旧UI・将来案はcurrent contractを上書きしない。