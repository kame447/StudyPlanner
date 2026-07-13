# R2 設計メモ（historical）: AI interpreter + deterministic validation + AI dialogue renderer

> **ステータス: historical implementation record。** AI interpreter、candidate validator、provider failure fallback の基盤は維持する。R2 の fixed questionPlan renderer は v4 の state-grounded planner に superseded され、現在の queue/status は v4 と roadmap が正である。

R2 を「正規表現 parser を増やして自然言語対応範囲を広げるフェーズ」から「AI interpreter + deterministic validation + AI dialogue renderer を含む入力理解基盤の拡張フェーズ」へ再整理するための設計メモである。**実装タスクmdではない。** ここから個別タスクを切るときは、この設計と切り出し時点の実コードを突き合わせること。

> **状態(2026-07-07 更新): 本メモは全体が実装反映済みの設計記録である。** §2〜§7(interpreter 境界の再設計、candidate validator、escalation、confidence→assumption/ambiguity、renderer 基盤、AI 実接続、テスト二層)は R2-A/R2-B/R2-C として実装・コミット済み。§8 の R2初期と candidate 契約の一連の修正(confidence 必須化・schema union 化・wrapper 簡素化)も closed。interpreter の実 AI 評価も1回完了(`tasks/closed/20260705-weekly-planning-r2c-eval.md`)。
>
> **R2-D(AI dialogue renderer の実接続)も完了(2026-07-07・監査で採用可判定)。** §5 の renderer 設計(RenderInput / 構造化出力 / plan 外破棄 / fallback)は、structured schema・`sanitizeDialogueRenderOutput` による validation(数・計画外 slot・重複・欠落を全チェックし questionPlan 順に再構成)・production injection(`createAiWeeklyPlanningDialogueRenderer`)・全経路 failure fallback として実装済み。「何を聞くか」は deterministic な questionPlan、「どう言うか」だけ AI が担う責務分離が成立。記録は `tasks/closed/20260707-weekly-planning-question-rendering-separation.md`。
>
> **R2-D 完了条件外の後続改善事項**(本メモの設計範囲外): retry policy、prompt tuning、実 AI 品質評価 / golden eval、コスト・レイテンシ計測、renderer の無質問ターン AI コール抑止。最新の進捗・着手順序は `weekly-planning-roadmap.md` を正とする。本メモは strategy 配下に残し、tasks/closed へは移動しない。

- 作成日: 2026-07-04 / 最終更新: 2026-07-07(実装反映済みの設計記録として状態注記)
- 前提: R1 クローズ済み(command boundary 完成、`docs/ai/tasks/closed/20260703-weekly-planning-r1-completion-report.md`)
- 関連: `docs/weekly-planning/weekly-planning-spec.md` §12(LLM/コード分担)、`docs/architecture/weekly-planning-responsibility-separation.md`(AI adapter は command 生成に限定・boundary 確立後に導入)、`docs/ai/strategy/weekly-planning-roadmap.md`

## 0. 方針の要約

```text
ユーザー自然文
→ AI interpreter(自然文 → command candidates)
→ deterministic validator / reducer / missing 判定
→ accepted facts + missing slots + next question plan
→ AI dialogue renderer(構造データ → 自然な日本語)
→ アプリ応答
```

**AI に任せないもの**: スケジューリング本体、保存、承認、missing / ambiguity / draft_ready 判定、質問対象の選定。これらは R1 で固めた決定的コード(reducer / validator / missingStatus / scheduler)に残す。AI の役割は次の2つだけ。

1. 自然文を `ParsedWeeklyPlanningCommand` の候補列に分解する(interpreter)。
2. コード側が決めた「受理済み・不足・次に聞くこと」を自然な日本語に整える(renderer)。

この分担は spec §12(LLM = 抽出・質問文生成・説明文、コード = 計算・判定)と、責務分離文書の「AI / ML adapter は command boundary が固まってから、自然言語から command を作る役割に限定して導入する」にそのまま沿う。R1 完了によって前提条件が成立した。

## 1. 動機となった実使用ログ

短答 slot filling(R2初期-1、実装済み)により「3時間です」は受理できるようになった。しかし次の入力は受理できず、同じ「分野や年度の優先順」の質問を繰り返した。

```text
ユーザー: 数学とOSとハードウェアとソフトウェアとヒューマンサイエンスがあって、
2025~2019までそれぞれあるんだけど、それらを分野ごとにまとめてやる。
優先順位的には数学から初めて最後がヒューマンサイエンスかな
```

この一文には少なくとも次が含まれる。

| 情報 | 値 |
| --- | --- |
| fields | 数学、OS、ハードウェア、ソフトウェア、ヒューマンサイエンス |
| yearRange | 2025〜2019(降順) |
| priorityPolicy | field_first(「分野ごとにまとめてやる」) |
| fieldPriority(部分順序) | 数学が先頭、ヒューマンサイエンスが最後 |

正規表現 parser でこの種の自由な説明文を分解し続けるのは、表現追加のいたちごっこになる。これは個別エッジケースではなく手法の限界であり、AI interpreter を導入する動機である。この入力を**第1号の評価ケース**として扱う(§7)。

## 2. AI interpreter の設計

### 2.1 既存 boundary の再設計(最重要)

`intake/weeklyPlanningIntakeTypes.ts` に既に `WeeklyPlanningIntakeInterpreter` boundary が存在するが、現在の返り値は `Promise<Partial<PlanningIntakeState>>` である。**このまま使ってはならない。** AI が state 断片を直接作る形は、R1 で確立した command boundary(parser → command → adapter → reducer)を迂回し、merge 規則・missing 判定・identity/dedupe をすべてバイパスする。

返り値を command candidates に変更する:

```ts
interface InterpretedCommandCandidate {
  command: ParsedWeeklyPlanningCommand;   // 既存 union をそのまま使う
  origin: 'ai_interpreter';
  needsConfirmation: boolean;             // medium confidence 等で最終確認に回すか
}

interface WeeklyPlanningIntakeInterpreter {
  interpretUserTurn(params: {
    userText: string;
    context: WeeklyPlanningIntakeContext;
    stateSummary: InterpreterStateSummary; // state 全体は渡さない(§2.3)
  }): Promise<InterpretedCommandCandidate[]>;
}
```

ポイント:

- **出力型を新発明しない。** 既存の `ParsedWeeklyPlanningCommand` は全 variant が `sourceText` / `sourceSegment` / `confidence` を持つ。AI はこの型の候補を返すだけで、適用は既存 reducer が行う。R1 の成果をそのまま器にする。
- interpreter は `PlanningIntakeState` を受け取らず、変更もしない。渡すのは解釈に必要な要約(既知 fields、確定済み slot の一覧、planning 期間)だけにする(プロンプト最小化とプライバシーの両面。spec §4.7)。
- 呼び出しは非同期。pipeline 側に async 境界が入ることになるため、導入タスクでは `runWeeklyPlanningIntakePipeline` の同期性への影響を設計に含めること(fake は同期的に resolve できるので、テストは単純に保てる)。

### 2.2 エスカレーション条件(どの入力を AI に渡すか)

常時 AI を呼ばない。**決定的 parser を先に走らせ、次のすべてを満たすときだけ AI へエスカレーションする**:

1. このターンで決定的 parser が command を1件も生成しなかった、**または** turn 適用後も missing が1つも減らなかった(= 進展なし)。
2. 入力が短答でない(短答 slot filling の対象は既存経路で処理済み)。
3. AI 経路が利用可能(設定で有効、かつ直前の呼び出しが連続失敗していない)。

この判定はすべて決定的コードで行える(command 件数と missing の差分は reducer の入出力から計算できる)。

**縮退**: AI 呼び出しの失敗・タイムアウト・オフライン時は、従来どおり決定的 parser のみの結果で応答する(現行と同じ挙動に戻るだけで、機能は壊れない)。既存 parser は削除せず、ベースライン兼 fallback として恒久的に残す。

### 2.3 parser 由来と AI 由来の優先順位

原則: **決定的 parser の結果が常に勝つ。**

- 適用順は「parser 由来 command → AI 由来 candidate」。同一 slot への競合は、既存の merge 規則(constraint identity / unitRate の unit 単位置換 / progress の field 単位 merge)がそのまま解決する。
- それでも足りない上書き(例: parser が確定した yearRange を AI 候補が別値で置き換える)は、validator(§3)が「確定済み slot への矛盾候補」として**棄却**する。
- AI 候補同士の重複は command の identity(kind + 主要 payload)で dedupe する。

## 3. AI candidate validator の設計

AI の出力を受ける唯一の門として、決定的 validator を1層置く。検証項目:

| 検証 | 内容 | 不合格時 |
| --- | --- | --- |
| 型 | `ParsedWeeklyPlanningCommand` union に合致するか(unknown な type、欠落フィールド) | 破棄 |
| 値域 | 年度が妥当な範囲か(例: 2000〜現在+1)、minutesPerUnit が正の現実的な値か、日付・時刻形式 | 破棄 |
| 語彙 | fields が既知語彙(examPrepScope.fields や表記ゆれ辞書)に解決できるか。未知 field は破棄ではなく `needsConfirmation` へ格下げ | 格下げ |
| 整合 | 確定済み slot と矛盾しないか(§2.3)。同一ターン内の候補同士の矛盾(同じ slot に別値)は confidence が高い方のみ残す | 破棄 |
| confidence | 欠落時は `low` 扱い | 格下げ |

破棄・格下げした候補は捨てずに **diagnostics に記録**する(`rejectedCandidates: { candidate, reason }[]`)。評価ケース(§7)の分析と、将来の interpreter 改善の材料になる。

validator は純関数として実装し、AI なしで unit テストできるようにする。

## 4. confidence と assumption / ambiguity の扱い

spec §6(質問しすぎ防止・仮置き原則)にそのまま接続する。

| confidence | 扱い |
| --- | --- |
| high | command として適用(parser 由来と同格) |
| medium | 適用するが assumption として記録し、`needsConfirmation: true`。最終確認でまとめて承認を取る(spec §4 の「前回と同じ前提にしています」パターンと同じ導線) |
| low | 適用しない。clarification 材料として next question plan に渡す(missing とは区別された「確認したい解釈」) |

### 部分順序(fieldPriority)の扱い

「数学から初めて最後がヒューマンサイエンス」は完全順序ではない。`PriorityPolicy.order` は完全順序前提なので、次の方針とする:

- interpreter は「先頭: 数学、末尾: ヒューマンサイエンス」という部分情報を `set_priority_policy` 候補(中間は fields の列挙順で補完した order)+ `confidence: 'medium'` として返す。
- 適用時に assumption として記録し、remaining work items の既存 ambiguity `field_order_incomplete` の仕組みに乗せて、最終確認で「この順でよいか」を一括確認する。
- `PriorityPolicy` 型の拡張(部分順序の一級表現)は**今はしない**。assumption + 既存 ambiguity で表現できる間は型を増やさない。足りないと分かった時点で設計を追加する。

## 5. AI dialogue renderer の設計

原則: **何を聞くかはコードが決め、AI はどう言うかだけを担当する。**

### 5.1 RenderInput(コード側が渡す構造データ)

既存の `WeeklyPlanningDialogueDecision`(kind / messageKey / requiredFields / summary)がほぼ素材になっている。これを拡張した構造を渡す:

```ts
interface DialogueRenderInput {
  acceptedFacts: {            // 受理済み条件の要約素材(decision summary 由来)
    fields?: string[];
    yearRange?: { startYear: number; endYear: number };
    unitRateMinutes?: number;
    priorityOrder?: string[];
    constraintSummary?: string[];
  };
  assumptions: string[];      // 仮置き中の前提(最終確認に回すもの)
  nextQuestions: Array<{      // コードが決めた質問計画。AI はこれ以外を聞けない
    slotKey: PlanningIntakeMissing | string;
    intent: string;           // 何を知りたいか(日本語の素)
    options?: string[];       // 選択肢がある場合
  }>;                         // 上限はコード側で 1〜2 件に絞って渡す(spec §6)
  styleConstraints: {
    tone: 'mentor';           // メンター調、命令形禁止
    maxQuestions: number;
  };
}
```

### 5.2 AI に質問を増やさせない制約(2段構え)

1. **構造化出力**: 自由文1本ではなく、「受理確認の一文」「質問文(nextQuestions の slot ごと)」を分離したフィールドで返させる。`nextQuestions` にない slot への質問フィールドは**コード側で捨てる**。
2. **逸脱時 fallback**: 出力が構造を満たさない・質問数が上限を超える・応答が得られない場合は、**テンプレート文へ差し替える**。R2初期-4(受理済みサマリ+文言トーン改善)で整備するテンプレートが、この fallback の実体になる。つまり R2初期-4 は AI 導入後も縮退先として恒久的に生きる。

renderer は表示専用で state を一切変更しない。したがって最悪の逸脱でも壊れるのは文面だけであり、計画データには影響しない。

### 5.3 受理済みと不足の伝え方

応答の「型」はコードが固定する: (a) 受理済み条件の短い要約(1〜2文)→ (b) 仮置き中の前提があれば一言 → (c) 次の質問(1〜2個)。AI はこの型の中で言い回しを整えるだけ。現行の「週間計画に必要な情報がまだ足りません。次に◯◯を教えてください。」のような missing の生出力はテンプレート改善(R2初期-4)の時点で廃止する。

## 6. AI 呼び出し経路

- 既存の `workers/ai-proxy`(wrangler 構成あり)を経由する。通常予定側 NL パイプラインに AI-assisted fallback の前例があるため、接続パターンはそちらを参照する。
- 送信データは最小化する: ユーザー当該ターンの文面+state 要約のみ。生活情報の履歴全体・保存済み予定は送らない(spec §4.7 データ安全性)。
- モデル選定・コスト上限・レート制御・プロンプト設計は**ユーザー判断事項**。実接続タスク(R2-C)の着手前に確認を取る。

## 7. テスト戦略

AI は非決定的なので、テストを二層に分ける。

1. **unit / regression(CI で常時実行)**: interpreter / renderer を DI 境界にし、**fake**(固定の candidate 列・固定の文面を返す実装)を注入して書く。エスカレーション条件、validator、confidence 別の適用、renderer の plan 外質問破棄・fallback 切替は、すべて fake で決定的にテストできる。既存テストは AI を一切呼ばない。
2. **評価(golden cases、CI 外または別枠)**: 実 AI の出力品質は `testFixtures/weeklyPlanningEvaluationCases.ts` の路線で評価ケースとして管理する。§1 の実使用ログ(5 fields + 2025〜2019 + field_first + 部分順序)を**第1号ケース**として登録し、「validator 通過後に fields / yearRange / priorityPolicy が command として得られ、missing が正しく減ること」を合格基準にする。評価はしきい値判定(全件一致ではなく必須項目の充足)とし、モデル更新時の回帰確認に使う。

## 8. roadmap への反映案

Phase R2 の看板を差し替える。

- **R2(再定義)**: 「入力理解基盤の拡張: AI interpreter + deterministic validation + AI dialogue rendering」
  - **R2初期(現行のまま維持)**: slot filling(済)/ 分類分離 / 年度範囲 / 受理済みサマリ+トーン改善。位置づけを「AI 導入前の baseline と fallback の整備」に更新する。
  - **R2-A: interpreter 基盤(AI 未接続)**: boundary の返り値再設計(`Partial<State>` → `InterpretedCommandCandidate[]`)、candidate validator、confidence→assumption/ambiguity 規則、エスカレーション条件。fake interpreter で全経路がテストできる状態まで。
  - **R2-B: renderer 基盤(AI 未接続)**: `DialogueRenderInput` の構造化(decision summary の拡張)、構造化出力の受け口、plan 外質問の破棄、fallback テンプレ接続。fake renderer でテスト可能に。
  - **R2-C: AI 実接続**: ai-proxy 経由の接続、評価ケースの運用開始、コスト・レイテンシ計測。**着手前にユーザー判断(モデル・コスト・送信データ範囲)を確認する停止点。**
- **旧 R2 計画の格下げ**: 締切表現 parser、完了条件 parser、量・単位 parser の正規表現拡張は「AI interpreter 導入後に必要性を再評価」へ変更する(interpreter が拾えるなら個別 parser は不要になる可能性が高い。ただし頻出・定型の表現は決定的 parser に残す価値がある — エスカレーション頻度とコストで判断)。
- R3(進捗単位一般化)以降との関係: interpreter の出力は command なので、R3 で command payload が一般化されれば interpreter は同じ器で新 unitKind を返せる。順序関係は現行 roadmap のまま(R2 基盤 → R3)。

## 9. 決めるべき論点(タスク切り出し前にユーザー確認)

1. R2-C のモデル選定・コスト上限・レイテンシ許容値。
2. 外部 API への送信データ範囲(state 要約の粒度)。
3. 評価ケースの合格基準の粒度(必須項目充足で良いか)。
4. エスカレーション条件の初期値(「進展なし」判定で良いか、長さ閾値を足すか)。

## 10. やらないこと(この設計の範囲外)

- AI にスケジューリング・保存・承認・missing 判定・質問対象の選定をさせること。
- `PlanningIntakeState` を AI 出力で直接更新すること(`Partial<State>` 返却の旧 boundary の温存)。
- 既存の決定的 parser の削除。
- LangGraph 等のフレームワーク導入(現行の決定的パイプライン+DI 境界で足りる想定。必要になったら別途設計)。
- scheduler / 保存導線 / UI の変更。

## 11. Post-R2 architecture evolution(次段階への位置づけ・2026-07-08 追記)

**本節は §2〜§7 の実装記録を書き換えない。** §2〜§7 は R2-A〜D の**実装済み事実の記録**であり、`AI interpreter → ParsedWeeklyPlanningCommand candidates → validator / reducer` という architecture は実装・コミット済みで、有効に稼働している。本節はその**次の課題**を追記するものである。

### 11.1 R2 command-candidate architecture は有効な中間段階だった

R2 で確立した「AI は state を直接更新せず、既存 command union の候補を返し、deterministic validator/reducer が適用する」という境界は正しく、維持する。confidence→assumption/ambiguity、escalation、plan 外質問の破棄、failure fallback も含めて、responsibility separation(spec §12)に沿った土台として機能している。

### 11.2 実使用で判明した次の課題: semantic intent と planner capability の間の層

2026-07-08 の監査(実コード確認)で、次の構造的問題が判明した:

- **AI interpreter が決定的 parser と同一の command 空間(action space)を共有している**。`weeklyPlanningAiInterpreter.ts` の system prompt は決定的 parser と同じ 12 command を列挙し、`InterpretedCommandCandidate.command` の型も `ParsedWeeklyPlanningCommand` そのもの。つまり AI は「曖昧な自然文を一段抽象化した意味へ写像する層」ではなく、「同じ固定 enum への、より柔軟な classifier」になっている。新しい言い回しへの対応は、AI 側では system prompt への箇条書き追加、決定的側では regex 追加であり、**どちらも「発話パターンごとに個別対応を増やす」同じ増築様式**に閉じている。
- `note_no_fixed_events` / `note_uncertainty` のように**1発話パターン=1 command 型**で増えた command が存在する(スケールしない)。
- scheduling 層には既存予定・時間割を避ける**汎用 capability が既にある**のに、intake の missing/充足判定と interpreter stateSummary がその存在を知らない(**capability はあるが intake から見えない**)。これが「授業を伝えても再質問される」「予定表の通り、が扱われない」の直接原因。

したがって次段階の課題は、**発話表現非依存の semantic intent(意味カテゴリ)と、planner capability の間の層**を最小限導入することである。

### 11.3 次段階の設計の正は `weekly-planning-nl-capability-model.md`

Post-R2 の設計は `docs/architecture/weekly-planning-nl-capability-model.md` を正とする。要点:

- 実使用問題を A〜F(interpretation / representation / capability / intake 可視性 / state transition / renderer context)で分類する診断原則。
- capability inventory を read-only / draft mutation / requires confirmation / destructive の権限区分つきで棚卸し。
- `use_constraint_source` / `request_clarification` 等、**発話ではなく意味カテゴリ**単位の最小 intent 設計。
- fixed events / timetable を最初の vertical slice にして、`表現ゆれ → semantic interpretation → planner capability resolution → deterministic state/missing → renderer context` を1経路だけ貫通させる。
- **全面 GoalIntent 移行はしない**(§10 の「やらないこと」を継承)。R2 の command-candidate 境界の上に、意味カテゴリ層を薄く載せる。

この方針の roadmap 反映は `weekly-planning-roadmap.md` の Phase R2-Capability を正とする。
