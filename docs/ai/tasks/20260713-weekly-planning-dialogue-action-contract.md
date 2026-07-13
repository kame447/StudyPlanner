# D1: state-grounded dialogue action contract を導入する

Status: **open — v4 の最初の新規実装 task**

Priority: High。通常経路の会話主導権を AI へ移す前に、許可する action と deterministic fallback を型・検証契約として固定する。

本 task は [親設計 v4](../../architecture/weekly-planning-dialogue-architecture-v4.md) §4、§6、§8 の D1 である。production code を変更する task であり、ここでは UI の通常会話経路をまだ切り替えない。

## 前提と扱い

現在作業ツリーには P4 由来と見られる未コミット差分がある。P4 の検証・完了処理はこの task の範囲外であり、既存差分を上書きしない。P4 が意図した差分なら、その command 基盤を利用する。未検証のまま P4 を closed と宣言しない。

## 目的

AI renderer が固定 questionPlan を言い換えるだけの構成を置き換えるため、次の pure な契約を導入する。

1. reducer と scheduler の後に作る DialogueStateSnapshot。
2. deterministic に導出する AllowedDialogueActions と allowed question topics。
3. AI dialogue planner の構造化 output。
4. output の schema、fact reference、action、question topic、assumption、preview の semantic validation。
5. 不正 output と provider 障害に対する deterministic fallback contract。

この task の完了時点では既存 DialogueDecision と renderer が通常表示を継続してよい。新契約は unit test と pipeline contract test で検証できる状態にする。

## 変更対象

- 新規候補:
  - src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueActionTypes.ts
  - src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueActionValidator.ts
  - src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueStateSnapshot.ts
  - src/features/weeklyPlanning/dialogue/weeklyPlanningAiDialoguePlanner.ts
- 変更候補:
  - dialogue/weeklyPlanningDialogueManager.ts
  - dialogue/weeklyPlanningDialogueRenderer.ts
  - intake/weeklyPlanningQuestionSlots.ts
  - pipeline/weeklyPlanningIntakePipeline.ts
- テスト候補:
  - dialogue の新規 contract test
  - pipeline/weeklyPlanningIntakePipeline.test.ts

実ファイル名は既存の責務と衝突しない範囲で調整してよい。scheduler、preview、保存、通常予定 parser、UI は変更しない。

## 契約

### DialogueStateSnapshot

snapshot は presentation 用の任意文ではなく、deterministic な JSON 値と stable ID を持つ。最低限、次を含める。

- accepted facts と fact ID
- rejected / confirmation-pending command と理由
- current missing、assumptions、質問済み topic
- planning range と確度
- existing plans、timetable、fixed events の参照可能な要約
- feasibility: required minutes、scheduled minutes、unscheduled items、conflicts、preview availability
- active preview 要約と capability gap
- recent history の上限付き引用
- allowed question topic とその user-facing hint、選択肢、依存情報

history は facts の代替にしない。AI に渡す event 名、日時、量は snapshot に存在するものだけにする。

### AllowedDialogueActions

action は有限集合とし、少なくとも welcome、invite_open_context、acknowledge_and_ask、confirm_reference、acknowledge_known_schedule、propose_assumption、discuss_feasibility、explain_rejection、offer_preview、explain_capability_gap を扱う。

導出関数は action ごとの許可条件を持つ。例:

- offer_preview は preview candidate があるときだけ。
- discuss_feasibility は unscheduled / capacity shortage があるときだけ。
- explain_rejection は rejection があるときだけ。
- question topic は question registry が current state で eligible としたものだけ。
- assumption proposal は既存 state を mutate せず、policy が許す slot と候補値だけ。

### AI output と validator

AI は action、factRefs、questionTopics、assumptionProposal、previewOffer、response を返す。validator は次を全て確認する。

- action が allowed actions にある。
- factRefs が snapshot の fact / event / diagnostic ID の部分集合である。
- questionTopics が allowed topics の部分集合で、原則一論点である。
- assumption proposal が allowed policy に一致し、確定 command を含まない。
- previewOffer と rejection explanation が該当する deterministic 根拠を持つ。
- response は state 変更、保存、承認済みとみなす命令を持たない presentation value として扱う。

validator は自然文から state を復元しない。不正時は partial apply せず null を返し、呼び出し側が fallback を使えるようにする。

## 触らない範囲

- interpreter の command schema と reducer の既存安全境界
- scheduler の配置ロジック、busy interval、preview / approval / save
- NaturalLanguageAssistant の通常表示経路
- relative constraint の domain 化（D3）
- provider の実接続を通常経路に入れること（D2）

## 受け入れ条件

1. snapshot が state、validator diagnostics、scheduler diagnostics、existing schedule sources から決定的に構築できる。
2. question registry を allowed topic と fallback metadata として使い、固定質問順を action の必須順序にしない。
3. allowed でない action、存在しない fact reference、未許可 topic、根拠なし preview / assumption は全て reject される。
4. accepted facts と assumption が別の ID / 型で snapshot に現れる。
5. provider output が不正でも既存 deterministic fallback に必要な入力を失わない。
6. snapshot / validator の unit tests と既存 weeklyPlanning tests が green である。
7. UI、scheduler、保存経路に production behavior の変更がない。

## 検証

対象 unit tests、weeklyPlanning test suite、build を実行する。テストは自然文の完全一致ではなく、action、reference、topic、fallback 選択を確認する。git add、commit、push は行わない。
