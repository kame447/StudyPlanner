# D2: state-grounded dialogue planner を通常経路へ接続する

Status: **open — D1 の後**

Priority: High。D1 の契約を使い、AI を「固定 questionPlan の言い換え器」から、検証済み state を根拠に dialogue action と応答を選ぶ役割へ移す。

本 task は [親設計 v4](../../architecture/weekly-planning-dialogue-architecture-v4.md) §4、§7、§8 の D2 である。

## 目的

通常の user turn を次の順に接続する。

1. 既存 AI interpreter が typed command 候補を返す。
2. adapter、validator、reducer、scheduler が command を検証・適用・計算する。
3. D1 の snapshot と allowed actions を deterministic に構築する。
4. 新しい AI dialogue planner が action と応答を返す。
5. action validator が通れば UI に表示し、通らなければ既存 deterministic dialogue policy / renderer を fallback として使う。

opening では command interpreter を呼ばず、opening snapshot から dialogue planner を一回だけ呼ぶ。通常 turn のモデル呼び出しは最大2回とする。

## 対象ファイル

- 変更候補:
  - pipeline/weeklyPlanningIntakePipeline.ts
  - dialogue/weeklyPlanningAiDialoguePlanner.ts
  - dialogue/weeklyPlanningDialogueRenderer.ts
  - dialogue/weeklyPlanningDialogueManager.ts
  - components/NaturalLanguageAssistant.tsx
  - interpreter / renderer の provider injection がある composition root
- テスト候補:
  - pipeline/weeklyPlanningIntakePipeline.test.ts
  - dialogue planner / renderer integration test
  - weeklyPlanningRoleplayScenarios.test.ts

D1 の型・validator・fallback contract を再定義しない。scheduler、preview 作成、承認、保存、rules parser の意味拡張は対象外である。

## 実装方針

### planner input

D1 の DialogueStateSnapshot と AllowedDialogueActions をそのまま JSON schema input にする。system prompt は次を明示する。

- snapshot の accepted facts が正であり、history は解釈補助である。
- action、質問論点、fact reference、assumption、preview offer は allowed list から選ぶ。
- 未検証の日時、既存予定、計算結果を文章に加えない。
- 丁寧なです・ます調で、原則一論点を聞く。
- 既知の時間割や保存済み予定は、再入力を求めず必要な補足だけを聞く。
- accepted command、rejected command、feasibility、assumption を区別する。

### 既存 renderer の移行

weeklyPlanningAiDialogueRenderer の slot 固定 schema を通常経路に使わない。既存の createWeeklyPlanningDialogueDecision、question registry、deterministic message は次の場合に残す。

- provider 無し、例外、timeout
- planner の JSON parse / schema / action validation failure
- safety 上、state-grounded response を採用できない場合

AI の空 action は provider failure ではない。D1 の許可規則に従って action を決めるか、明示的な fallback action を返すものとして扱う。

### UI

UI は planner の response を表示するだけで、response の文言を見て state・preview・保存を変更しない。preview 作成・承認は既存操作を維持する。opening message は UI 初期化時に一度だけ生成し、再 render ごとに provider を呼ばない。

## 受け入れシナリオ

1. opening: ユーザー発話前に、期間・科目・時間を順番に固定質問せず、自由に話せる開始応答を表示する。
2. 複合発話: 期間、学習対象、優先、固定予定を一発話で渡し、validator が受理した全条件を snapshot が示し、既出情報を再質問しない。
3. 既知予定: 火曜18:00〜22:00のバイトが input に存在するとき、AI はその事実を fact reference で示し、同じバイトを再入力させない。
4. reject: validator が range / confirmed-slot を reject したとき、AI は受理済みとして説明せず、explain_rejection または fallback を使う。
5. preview: deterministic candidate があるときだけ offer_preview を返せる。AI の文言だけで preview を作らない。
6. failure: provider 例外、不正 JSON、unknown action、unknown fact reference で deterministic fallback が動き、turn の state と diagnostics を失わない。
7. call budget: opening は1 call、通常 turn は interpreter と dialogue planner の最大2 call。質問が無い旧 renderer call を残さない。

## 触らない範囲

- relative constraint の表現、帰宅 / 食事の順序計算
- capacity policy の変更、scheduler の配置アルゴリズム
- 保存済み Plan の変更・削除を自然言語で実行すること
- profile 永続化、共有、通知
- command validator / reducer の既存 guard を弱めること

## 検証

stub provider により action、factRefs、question topics、fallback を再現可能にテストする。実モデル評価は D3 にまとめる。weeklyPlanning test suite と build を実行する。git add、commit、push は行わない。
