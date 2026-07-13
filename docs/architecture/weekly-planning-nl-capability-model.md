> **Historical evidence marker:** A〜Gは診断証拠である。current DoRは[weekly-planning-dialogue-architecture-v4.md](weekly-planning-dialogue-architecture-v4.md)、current queueはroadmap冒頭だけを正とする。

# weeklyPlanning: 自然言語層と planner capability の分離モデル(提案)

> **ステータス: 診断・capability inventory の参照記録。** A〜F の問題分類、既存 capability の可視化、command validation の原則は維持する。GoalIntent へ段階移行して deterministic questionPlan を主導する提案は現在の対話設計ではない。通常経路の唯一の正は [親設計 v4](weekly-planning-dialogue-architecture-v4.md) である。

> **Historical statement as of 2026-07-07; not current DoR.** 当時はPost-R2の設計候補として記録された。2026-07-13以降のcurrent DoRはv4である。

**当時のステータス: 提案(未実装)。** 2026-07-07 の監査に基づく設計提案であり、`docs/architecture/weekly-planning-responsibility-separation.md`(R1 の command boundary 設計)を置き換えるものではなく、その `ParsedWeeklyPlanningCommand` 設計を実装した後に見えてきた「command 粒度が発話表現に追随して肥大化する」問題を是正するための後続設計。`weekly-planning-r2-ai-interpreter-design.md` の R2 command-candidate architecture(実装済み・有効な中間段階)の次の課題として位置づける。production code は本文書作成・更新時点で変更していない。

> **2026-07-08 更新**: 監査を実コードで再確認し、以下を追記した。§6 診断原則(実使用問題を A〜F に分類する恒久フレーム)、§7 capability inventory(read-only / draft mutation / requires confirmation / destructive の権限区分つき)、§8 semantic intent の最小設計(`use_constraint_source` 等・発話非依存)、§9 vertical slice(fixed events / timetable を最初の縦切りにする理由)、§10 renderer context 契約(「来週→今週」問題の回帰防止を含む)。本文書を次段階 task 群(§4 で再構成)の設計根拠とする。

## 1. 監査で確認した事実

### 1.1 AI interpreter は semantic layer ではなく、決定的 parser と同一の command classifier になっている

`weeklyPlanningAiInterpreter.ts` の system prompt(`createSystemPrompt`)は次の形をしている:

```text
Command types you may emit:
- set_exam_scope: ...
- set_priority_policy: ...
- set_unit_rate: ...
- mark_completed_units or note_progress_boundary ...
- add_fixed_event, add_unavailable, update_life_constraint, note_no_fixed_events, note_uncertainty, set_planning_range ...
```

これは決定的 parser(`weeklyPlanningIntakeReducer.ts` の `parseWeeklyPlanningCommands` が呼ぶ関数群)が生成する **同じ12種類の command** をそのまま列挙したものである。`InterpretedCommandCandidate.command` の型も `ParsedWeeklyPlanningCommand` そのもの(`weeklyPlanningInterpreterTypes.ts`)。

つまり AI と決定的 parser は**同じ出力空間(action space)を共有**しており、AI は「曖昧な自然文から一段抽象化された意味(意図・目標)を取り出す層」ではなく、「同じ固定 enum に対して、より柔軟なマッチングを行う classifier」になっている。新しい言い回しに対応する手段は、AI 側では system prompt への箇条書き追加、決定的側では正規表現追加であり、**どちらも「発話パターンごとに個別対応を増やす」という同じ増築様式**に閉じている。

### 1.2 `ParsedWeeklyPlanningCommand` の粒度が発話表現に引きずられている

12種類の command のうち、複数は「ユーザーの一発話パターン」に対応する形で追加されてきた:

- `mark_completion_target`(kind: all / latest_n_years / up_to_reachable / year_range)— 「全部」「できるところまで」「N年分」という**表現のバリエーションがそのまま enum の case**になっている。
- `note_progress_boundary` と `mark_completed_units` — 「完了方向が曖昧」と「完了方向が明確」という**解釈の確信度の違いが別 command 型**になっている(本来は同じ「進捗確定」意図の confidence 違いで表現できたはず)。
- `note_no_fixed_events` — 「固定予定はない」という**単一の発話意図**のためだけの command。
- `note_uncertainty` — 値が `PlanningIntakeUncertainty` 型で実質1値(`unknown_fields_may_take_longer`)のみ。**1つの発話パターンのために command 型を新設した**典型例。

これらは「新しい表現が見つかるたびに command 型を1つ増やす」というスケーリングをしており、command 数は発話パターン数に比例して増え続ける設計になっている。

### 1.3 planner(generator/pipeline)側には、実は汎用 capability がすでに存在する

これは監査で確認できた**良いニュース**である。`weeklyDraftCandidateGenerator.ts` と `weeklyPlanningIntakePipeline.ts` を見ると:

| capability | 実装状況 | 経路 |
|---|---|---|
| 既存予定(`Plan[]`)の取得と busy interval 化 | **あり(型付き・汎用)** | `WeeklyDraftCandidateGeneratorInput.existingPlans` — pipeline input として毎ターン無条件に渡される(`NaturalLanguageAssistant.tsx:526` が `plans` を毎回渡す) |
| 時間割(`ScheduleTemplate[]`)の取得と busy interval 化 | **あり(型付き・汎用)** | `scheduleTemplates` / `timetableTermId` — 同上、`buildTimetableBusyIntervals` |
| 制約源の追加(睡眠・食事・風呂・固定予定・不可時間帯) | **あり(kind ベースで汎用)** | `LifeConstraintKind` enum(sleep/meal/bath/commute/club/cram_school/buffer/fixed_event/unavailable)+ `add_unavailable` / `add_fixed_event` / `update_life_constraint` の3 command。**これは発話パターンではなく domain kind で分岐しており、比較的健全な粒度** |
| busy interval の計算(constraint → 時間帯) | **あり(汎用)** | `constraintToBusyInterval` / `expandRecurringUnavailableConstraints` |
| draft candidate の生成(配置) | **あり** | `createWeeklyDraftCandidatesFromRemainingWorkItems` |
| draft block の作成 | **UIのみ・NL 経路なし** | `onCreateWeeklyDraftBlocks` — ボタン `onClick` からのみ呼ばれる。command union に対応する型なし |
| draft block の削除・変更 | **UIのみ・NL 経路なし** | `onRemoveWeeklyDraftBlock` — 同上。「土曜の分を消して」のような発話を扱う capability が planner に存在しない |
| 保存済み予定の作成・更新・削除 | **UIのみ・NL 経路なし** | `savePlanDraft` は一括承認ボタン経由のみ。仕様上意図的(AIに自動承認させない)だが、「承認して」等の発話を承認 UI 操作へブリッジする capability もない |

**重要な結論**: 「既存予定・時間割を計画制約として使う」という capability は、**scheduling 層ではすでに汎用的に実装されている**(型付き入力として毎ターン渡される)。ユーザーが「予定表の通り」と言っても言わなくても、generator は既存予定と時間割を避ける。**欠けているのは scheduling capability ではなく、intake 層の missing/completion 判定**が、この既存 capability の存在を認識していないことである(`fixed_events` missing は「ユーザーが `add_fixed_event` を明示するか `note_no_fixed_events` を言うまで」解消されない設計になっており、「planner がすでに existingPlans/scheduleTemplates を持っている」という事実を intake 側の充足判定が参照していない)。

この非対称——**scheduling は汎用 capability 化されているのに、intake の充足判定はそれを知らない**——が実例2・4の直接原因である。

## 2. 推奨する層構造

```text
自然文
  ↓
[1] semantic intent 抽出(AI interpreter)
  ↓ GoalIntent(有限だが「意味」の集合。発話表現の集合ではない)
[2] planner decision(deterministic)
  ↓ 「この intent に対して、どの capability を、どの引数で呼ぶか」の決定
[3] typed capability 呼び出し(deterministic, planner が実行)
  ↓ 例: resolveFixedEventsFromExistingCapability() / addConstraintSource() / setCompletionTarget()
[4] validated state transition(deterministic, 既存の reducer/validator)
  ↓
PlanningIntakeState
```

### 現状との違い

現状は実質 `[1] AI classifier → [4] state transition` の2層で、層2（層3）が存在しない。command が「意図」と「適用方法」を1つの型に同居させてしまっているため、新しい発話に対応するたびに [1] と [4] の両方に手を入れる必要がある。

提案する構造では、[1] の出力を**発話表現非依存の意味カテゴリ(GoalIntent)**に限定し、[2] の planner decision 層が「この GoalIntent は、今の state でどの capability にどう変換されるか」を決定する。これにより:

- 新しい言い回し(「予定表の通り」「登録済みの授業を考慮して」「時間割はもう入っている」)は、すべて**同じ GoalIntent**(例: `defer_fixed_events_to_existing_schedule_capability`)に集約でき、AI 側の追加作業は「この意味へのマッピングを増やす」だけで済む。
- planner 側は「`defer_fixed_events_to_existing_schedule_capability` intent を受け取ったら、`existingPlans`/`scheduleTemplates` が非空であることを確認し、`fixed_events` missing を解消し、confirmedSlots に登録する」という**1つの capability 実装**を持てばよい。表現のバリエーションが増えても、この capability 実装は変わらない。

### GoalIntent の例(command と対比)

| 現状の command(表現ごと) | 提案する GoalIntent(意味ごと) |
|---|---|
| `note_no_fixed_events` | `set_fixed_events_state: none` |
| (存在しない。task md が新設しようとしている) | `set_fixed_events_state: defer_to_existing_capability` |
| `add_fixed_event` | `set_fixed_events_state: explicit(event)` |
| `mark_completion_target`(all/latest_n_years/up_to_reachable/year_range の4 case) | `set_completion_target(field, target: TargetSpec)` — TargetSpec 自体は変えず、**command 型を分けない**(4 case は同じ command の payload variation であり、別 command にする理由がない。実装は既にこの形なので、ここは是正不要、良い例として明示)|
| `note_uncertainty` | 汎用 `note_ambiguity(topic, detail)` に統合可能(uncertainty の種類が増えても command 型を増やさない) |
| (存在しない。`clarification-request-handling` task が新設しようとしている) | `request_term_clarification(term)` — これは正しく「新しい意味カテゴリ」なので GoalIntent として1つ追加する価値がある。ただし「command 型を1つ増やす」という手段は現行パターンと同じであることに注意(下記 §4 参照)|

**注記**: `mark_completion_target` は実は監視すべき悪い例ではなく、**良い実装例**である。1つの command 型の中で `target.kind` という payload variation として4パターンを吸収しており、command 型自体は増えていない。これは提案する GoalIntent 設計の先取りと言える。逆に `note_no_fixed_events` / `note_uncertainty` のような「1発話パターン = 1 command 型」は是正対象である。

## 3. AI に任せるべき境界 / deterministic に保つべき境界

| 領域 | 担当 | 理由 |
|---|---|---|
| 表現ゆれの吸収(「予定表の通り」≒「時間割はもう入っている」≒「登録済みの授業を考慮して」)| **AI interpreter** | 意味は同じでも表現は無限。ここを deterministic regex で追い続けるのが現状のアンチパターン |
| どの GoalIntent に対応するかの判定 | **AI interpreter**(意味解釈)+ **validator**(GoalIntent の値域チェック) | AI は「このユーザー発話は `set_fixed_events_state: defer_to_existing_capability` という意味だ」までを出す。GoalIntent の種類自体は有限の deterministic な enum |
| GoalIntent → どの capability をどう呼ぶか | **planner(deterministic)** | 「existingPlans が空なら defer は成立しない」「confirmedSlots への反映」等はロジックであり AI に判断させない |
| busy interval 計算・配置・容量判定 | **deterministic(既存のまま)** | 監査時点で既に十分 deterministic。変更不要 |
| state transition・missing/confirmedSlots 更新 | **deterministic(既存 reducer のまま)** | 変更不要。ただし GoalIntent → capability 呼び出しの結果を受け取る形に整理 |
| 質問文の自然文生成 | **AI renderer**(既存 R2-D 通り)| 「何を聞くか」は決定的 questionPlan、「どう言うか」だけ AI。この境界は監査時点で既に正しく実装されている |

## 4. Historical task inventory（2026-07-08時点）

> **Historical task state; no item in this section is currently open.** 現在のowner/statusはv4、roadmap、roleplay P7 tableを参照する。

> **2026-07-08 再構成結果**: 以下の分析に基づき task を再発行した。
> - `fixed-events-state-and-timetable-intent` → **破棄**。専用状態5値+専用 command 追加という「発話追随」設計だったため。代替として基盤 task `20260708-weekly-planning-constraint-source-capability.md`(§9 の vertical slice)を新規発行。
> - `renderer-deterministic-context` → **再発行**(`20260708-weekly-planning-renderer-deterministic-context.md`)。§10 の renderer context 契約に合わせ、capability snapshot 由来の「利用中 constraint source」を context 素材に追加。planning period(実例1)部分は基盤 task に依存せず先行可。
> - `clarification-request-handling` → **再発行**(`20260708-weekly-planning-clarification-semantic-intent.md`)。§8.2 の clarification intent(用語非依存・payload で target 表現)として設計し直し。
> - `completion-target-model` → **実装済み(stale)**。§7.4 の通り verify のうえ closed へ。本再構成の対象外。
> - 実使用で確認された問題(実例1〜4・聞き返し)は全て新 task の背景に保持した。

以下は破棄前の分析(記録として保持)。3件とも**局所修正になっている**。実装を止めるべきという意味ではなく、実装順序と設計方針に条件を付けるべきという結論である。

### `fixed-events-state-and-timetable-intent` — **要再設計。基盤 task が先。**

task md は「fixed_events の状態を5値 enum に増やし、`timetable使用` という新しい宣言 command を1つ追加する」という設計になっている。これは §1.3 で確認した**「scheduling には capability が既にあるのに、intake がそれを知らない」という非対称を、新しい専用状態+専用 command で埋める**アプローチであり、まさに「発話パターンごとに専用対応を増やす」現行パターンの延長である。

**推奨する代替**: 新しい command 型を増やすのではなく、`update_life_constraint` や `note_no_fixed_events` と並ぶ「fixed_events の解決方法」の1 variant として実装する(例: 既存の `note_no_fixed_events` を一般化し、`{ resolution: 'none' | 'defer_to_existing_capability' | 'explicit' }` の payload variation にする)。かつ、**「defer_to_existing_capability」の受理条件は `existingPlans`/`scheduleTemplates` が実際に非空であることを planner 側が検証する**(空なのに「予定表の通り」と言われたら、そのまま鵜呑みにせず確認に回す、という deterministic capability 側のガードにする)。

このタスクは、後述する「基盤 task」(§5)が先にあるべきで、そのまま実装すると command 数がさらに1つ増える。

### `renderer-deterministic-context` — **概ね妥当。局所修正のリスクは低い。**

RenderInput への context 追加は「AI に渡す事実を増やす」性質のタスクで、command/state 遷移構造には手を入れない。ただし「既知予定の不足部分」フィールドは、上記 fixed_events 状態が再設計された後の形に合わせる必要があるため、**fixed-events task の後に実施する依存関係**を明記すべき(現状の task md にも「fixed_events の状態区別タスクが入った後はその状態を context に載せる」と書かれており、依存は認識されている)。

### `clarification-request-handling` — **意味カテゴリとしては妥当。ただし手段が現行パターンのまま。**

「聞き返し」は本当に**新しい意味カテゴリ**であり、既存12 command のどれにも属さない。GoalIntent として1つ追加する判断は正しい。ただし実装手段が「`ParsedWeeklyPlanningCommand` に `ask_clarification` という13番目の command を足す」という、**現行の「command 型を1つ増やす」パターンそのまま**である点が監査対象。

**推奨**: このタスク自体は実装してよいが、§5 の基盤整理(GoalIntent 層の導入)を先に行うなら、`ask_clarification` は「command」ではなく「GoalIntent」として最初から新層に置くべき。基盤整理を先にしない場合、現行パターンに沿った実装として許容できるが、その場合も**「用語ごとに command を増やさない」**(`term` を payload にした汎用1 command にする、既に task md はそう書いている)ことは死守する。

## 5. Historical conclusions（2026-07-08時点）

> **Historical conclusions; not current implementation instructions.** 当時のtask判断と提案を証拠として保持する。

### 5.1 現行 architecture の問題点

- AI interpreter が決定的 parser と同一の command 空間を共有し、意味解釈層として機能していない(§1.1)。
- `ParsedWeeklyPlanningCommand` の一部(`note_no_fixed_events`, `note_uncertainty`)が発話パターン単位で追加されており、スケールしない(§1.2)。
- scheduling 層にはすでに汎用 capability(existingPlans/scheduleTemplates の型付き受け入れ)があるのに、intake 層の missing 判定がそれを認識しておらず、結果的に「言えば言うほど専用対応が増える」状態を生んでいる(§1.3)。
- draft block の作成・削除・変更、保存済み予定の作成・更新・削除は NL 経路が存在せず(意図的な設計だが)、planner capability として明示化されていない。

### 5.2 推奨する capability model

§2〜§3 のとおり: 自然文 → GoalIntent(意味・有限)→ planner decision(どの capability を呼ぶか)→ typed capability → validated state transition。`mark_completion_target` は既にこの形に近い実装であり、リファレンス実装として扱える。

### 5.3 既存 task をそのまま実装してよいか

**そのまま実装すべきでない。** 特に `fixed-events-state-and-timetable-intent` は、実装するとちょうど批判対象の設計(専用状態+専用 command)を1件確定させてしまう。

### 5.4 先に基盤 task が必要か

**必要。** 提案する基盤 task(新規、未作成):

> **「fixed_events 解決の capability 化」**: (a) `existingPlans`/`scheduleTemplates` が非空であることを条件に、intake 側で `fixed_events` missing を解消できる deterministic capability 判定を1つ設計する。(b) この capability が「明示 command なしでも(pipeline input に既存予定・時間割さえあれば)`confirmedSlots` に反映できる」のか、「ユーザーの defer 意図(発話 or ボタン)を1回だけ確認してから反映する」のかを設計判断として先に決める(spec §6 の「質問しすぎ防止」との整合)。(c) この判断が固まってから、`fixed-events-state-and-timetable-intent` を「新 command 追加」ではなく「既存 capability 判定の呼び出し」として実装し直す。

この基盤 task は、AI interpreter の GoalIntent 層導入という大きな再設計を今すぐ要求するものではない(それは中長期の再設計であり、本文書はその方向性のみ提案する)。**最小限、`fixed_events` の解決を「発話 command」ではなく「capability 判定」として設計し直すことが、次の1手として現実的**である。

### 5.5 architecture/strategy 文書への反映

- 本文書(`docs/architecture/weekly-planning-nl-capability-model.md`)を新規作成した(今回)。
- `docs/architecture/weekly-planning-responsibility-separation.md` は、command boundary 確立時点(R1)の設計として引き続き有効。本文書はその後続(R2-S 以降で command 粒度が発話追随してきた反省)として位置づける。同文書側への追記は今回行っていない(必要なら次の作業で相互参照リンクを追加する)。
- `docs/ai/strategy/weekly-planning-roadmap.md` への反映は今回行っていない。次に roadmap を更新する際、「fixed_events capability 化」を新規基盤 task として R2-S 系列(または新設する R2-Capability 系列)に追加することを推奨する。

> **2026-07-08 追記**: 上記の反映を実施した。roadmap に **Phase R2-Capability** を新設し、本文書を設計根拠として基盤 task と依存順序を記載。R2 設計メモ末尾に「Post-R2 architecture evolution」節を追加し本文書を参照。§4 の3 task の再構成も実施(§4 の見出し下の追記を参照)。

---

## 6. 診断原則(実使用問題を分類する恒久フレーム)

今後、実使用で問題が出るたびに「専用 parser / regex / command / handler を1つ足す」に逃げないため、まず**問題を層で分類する**。1つの症状が複数層にまたがることもある(その場合は主因を1つ選び、従因を併記する)。

| 分類 | 意味 | 直し方の方向 |
|---|---|---|
| **A. semantic interpretation 不足** | AI/parser が発話の意味を取り出せていない(表現ゆれに負けている) | interpreter の意味写像を足す。**発話パターン専用の regex/command を足すのではなく、既存の意味カテゴリへ写像できるか先に確認** |
| **B. semantic representation 不足** | 取り出したい「意味」を表す型・intent がそもそも無い | semantic intent(有限の意味カテゴリ)を1つ足す。発話バリエーションではなく意味単位で足す |
| **C. planner capability 不足** | その意図を実行する domain operation が planner に存在しない | 汎用 capability を足す(発話専用の例外処理ではなく) |
| **D. capability はあるが intake から見えない** | scheduling 層に capability があるのに、intake の missing/充足判定・interpreter stateSummary がその存在を知らない | capability の可用性を intake/interpreter/renderer に**構造化して供給**する(新 capability は作らない) |
| **E. state transition / validation 不足** | 意味も capability も揃うが、state 反映・missing 解消・矛盾検証が繋がっていない | reducer/validator の遷移規則を足す |
| **F. renderer context 不足** | 「何を言うか」に必要な確定事実が renderer に渡っていない/AI が context 外を捏造する | RenderInput に deterministic context を足す。AI に捏造させない |

### 6.1 今回の実例の分類(監査結果)

| 実例 | 症状 | 主因 | 従因 |
|---|---|---|---|
| 実例1 | 「来週」と入力したのに renderer が「今週」と言う | **F**(`DialogueRenderInput.acceptedFacts` に planning period が無い。`state.range` は存在するが renderer に渡っていない) | — |
| 実例2 | 授業・バイトを伝えたのに broad な固定予定質問を繰り返す | **D**(授業=既存 timetable を避ける capability は常時稼働しているのに intake が知らない)+ **A/E**(バイト18-20:30 が hard `add_fixed_event` にならず `fixed_events` missing が残る) | — |
| 実例4a | 「授業は予定表に記載の通り」が既存時間割の利用意図として扱われない | **B/D**(「既存 schedule source を制約として使う」という意味カテゴリが無い + capability はあるが intake が接続していない) | — |
| 実例4b | 「HS は全部、OS/SW は2年分」等の field 別 target | 監査時点で **解決済み**。`CompletionTarget` / `mark_completion_target` / `resolveCompletionTargetMissing` が実装済み(下記 §7.4) | — |
| 実例(聞き返し) | 「固定の予定って何ですか？」が uncertainty 等へ誤分類される | **B**(clarification という意味カテゴリが無い)+ **A**(既存 command へ無理に写像) | **F**(そもそも用語が伝わらない=別途 F で緩和) |

**重要な帰結**: 実例2・4a の主因は **C(capability 不足)ではなく D(intake から見えない)**。したがって「予定表を使う」ための新しい scheduling capability を作る必要はない。欠けているのは、既に稼働している read-only capability の可用性を intake/interpreter/renderer へ**構造化供給**する層である。

## 7. capability inventory(2026-07-08・実コード確認)

「実際に利用可能か」と「どの経路から呼べるか」「AI が自動実行してよいか」を分けて棚卸しする。権限区分は次の4段:

- **read-only**: 参照のみ。state を変えない。AI トリガでも安全(結果は情報として intake/renderer に渡すだけ)。
- **draft mutation**: 未承認 draft の生成・変更・削除。保存はしない。AI トリガの可否は product policy 判断(現状 UI のみ)。
- **requires confirmation**: 実行はできるが user 確認を1回挟む(medium confidence の assumption、空ソースへの defer 等)。
- **destructive / save-commit**: 保存・確定・削除。**必ず user confirmation。AI 自動実行しない**(spec §10・現行設計の維持)。

### 7.1 read-only(参照系)— すべて実装済み・汎用・毎ターン稼働

| capability | 実装 | 経路 | intake から見えるか |
|---|---|---|---|
| 既存予定(`Plan[]`)→ busy interval | あり | `weeklyDraftCandidateGenerator.buildBusyIntervals`(`existingPlans`)。`NaturalLanguageAssistant.tsx:526` が毎ターン `plans` を渡す | **見えない**(pipeline は generator に渡すだけ。`PlanningIntakeState` にも `InterpreterStateSummary` にも既存予定の存在が反映されない) |
| active timetable(`ScheduleTemplate[]`)→ busy interval | あり | `buildTimetableBusyIntervals`(`scheduleTemplates` / `timetableTermId`)。同上 526-528 で毎ターン供給 | **見えない**(同上) |
| 生活制約 / 固定予定 → busy interval | あり | `constraintToBusyInterval` / `expandRecurringUnavailableConstraints` | 見える(intake state 由来) |
| remaining work items → draft candidate 配置 | あり | `createWeeklyDraftCandidatesFromRemainingWorkItems` | 見える |

**この表の "見えない" 2行が実例2・4a の直接原因**(§6.1 の D)。

### 7.2 draft mutation(未承認 draft 操作)— UI のみ・NL 経路なし

| capability | 実装 | 経路 |
|---|---|---|
| draft block 作成 | UI のみ | `onCreateWeeklyDraftBlocks`(ボタン `onClick`。`NaturalLanguageAssistant.tsx:589`) |
| draft block 削除 | UI のみ | `onRemoveWeeklyDraftBlock`(同 430) |
| draft block 変更・移動 | **UI にも無い** | 作成と削除のみ。「土曜の分を火曜へ」のような move capability は planner に存在しない(C 不足の候補・今回は対象外) |

### 7.3 destructive / save-commit — UI のみ・意図的に NL 経路なし

| capability | 実装 | 経路 |
|---|---|---|
| 予定保存(一括承認) | UI のみ | `savePlanDraft`(一括承認ボタン)。`shouldSavePlan: false` 維持 |
| 保存済み予定の更新・削除 | weeklyPlanning 経路には無い | — |

**設計判断(維持)**: 保存・承認・削除は capability の存在(将来 planner から呼べるか)と自動実行権限を分ける。当面 AI 自動実行はしない。「承認して」等の発話を承認 UI へブリッジする capability も今は作らない。

### 7.4 completion target — 監査時点で実装済み(良いリファレンス)

`CompletionTarget`(`weeklyPlanningIntakeTypes.ts`:`all` / `latest_n_years` / `up_to_reachable` / `year_range`)、`MarkCompletionTargetCommand`、reducer の `applyMarkCompletionTargetCommand` + `resolveCompletionTargetMissing`、interpreter schema、`weeklyPlanningRemainingWorkItems` への反映まで揃っている。**4つの表現バリエーションを別 command にせず、1 command の `target.kind` payload variation に吸収している**点が、本文書が推奨する semantic intent 設計の先取り。→ **`docs/ai/tasks/20260707-weekly-planning-completion-target-model.md` は実装済みで stale。verify のうえ closed へ移すことを推奨(本再構成の対象外)。**

## 8. Historical proposal: semantic intent の最小設計(発話非依存)

> **Historical proposal; not current implementation instructions.** 設計根拠として保持し、current taskへ直接読み替えない。

R2 の command-candidate architecture(実装済み)を壊さず、その上に**発話表現に追随しない意味カテゴリ**を最小限だけ導入する。全面 GoalIntent 移行はしない(§11 相当のやらないこと)。

### 8.1 `use_constraint_source`(実例2・4a を1つに集約)

次はすべて**同じ意味**であり、別 parser/regex/command を作らない:

> 「授業は予定表の通り」/「いつもの授業を避けて」/「時間割に入っている予定を使って」/「登録済みの授業を考慮して」/「普段通りの授業があります」

これらを1つの意味へ写像する。payload で参照対象を表現する:

```text
intent: use_constraint_source
source:
  kind: timetable | existing_plans | calendar
  selector: active            # 表現ではなく参照対象
```

- **AI の責務**: 上記の表現ゆれを `use_constraint_source(kind, selector)` へ写像するところまで(§6 の A/B)。
- **planner decision の責務(deterministic)**: §7.1 の capability snapshot を見て、参照ソースが**実際に非空**かを検証する。非空なら `fixed_events` を充足し「その source を制約として利用中」と記録(§6 の D/E)。**空なのに「予定表の通り」と言われたら鵜呑みにせず、`requires confirmation` へ倒す**(存在しないものを利用中と偽らない)。

この形なら、新しい言い回しが増えても AI 側は写像を1本増やすだけで、planner 側の capability 判定は不変。

### 8.2 clarification intent(実例・聞き返しを1つに集約)

「固定の予定って何ですか？」「それってどういう意味？」「何を答えればいいの？」を**用語ごとの専用 command にしない**。1つの意味カテゴリで扱う:

```text
intent: request_clarification
payload:
  target: referenced_question | referenced_term | unresolved_slot
  ref: <slotKey or term>       # 直前の質問・用語・未解決 slot への参照
```

- deterministic dialogue manager の責務: clarification を受けたら **state を進めない(missing を消さない)**。用語の deterministic な説明(用語辞書)を返し、**元の unresolved question / intent を維持**する。説明文は deterministic、言い回しだけ renderer が整える。

### 8.3 ambiguity の一般化(将来)

`note_uncertainty`(現状 `PlanningIntakeUncertainty` 実質1値)は、種類が増えるたびに command を増やさないよう、`note_ambiguity(topic, detail)` 相当へ将来統合できる。**今回の vertical slice の対象外**(触らない)。方向性のみ記録。

### 8.4 「command を1つ増やす」手段への注意

clarification や `use_constraint_source` を「`ParsedWeeklyPlanningCommand` に case を1つ足す」形で実装すること自体は、現行パターンの延長として許容できる。ただし**死守する不変条件**: 発話表現ごとに case を増やさず、payload(参照対象・target)で表現を吸収する。case 数は「意味カテゴリ数」に比例させ、「発話パターン数」に比例させない。

## 9. Historical vertical-slice proposal: fixed events / timetable

> **Historical sequence as of 2026-07-08; not current queue.** 以下は当時の縦切り提案である。

全面移行を避け、次の1経路だけを最初に貫通させる:

```text
自然言語の表現ゆれ(「予定表の通り」ほか)
→ semantic interpretation(use_constraint_source)
→ planner capability resolution(§7.1 snapshot でソース非空を検証)
→ deterministic state / missing decision(fixed_events 充足 or requires confirmation)
→ renderer context(planning period + 「授業は既存の時間割を利用中」を accepted fact として供給)
```

### 9.1 fixed events / timetable を選ぶ理由

1. **capability が既にある(C 不足でない)**: §7.1 の通り timetable/existing plans → busy interval は毎ターン稼働。作るのは供給層だけで、scheduler に触れない=リスクが小さい。
2. **D(見えない)の典型で、直し方が構造的**: 「発話専用対応を足す」誘惑がもっとも強い箇所(現に stale task が専用状態5値+専用 command を作ろうとしていた)。ここを capability snapshot 供給で直せば、以後の D 問題の手本になる。
3. **A〜F を1経路で全部踏む**: 表現ゆれ(A)、意味カテゴリ(B)、可用性供給(D)、充足遷移(E)、renderer context(F)を最小規模で通せる。他 domain へ横展開できる基盤になる。
4. **実害が大きく再現が明確**: 実例2・4a は「授業・バイトを伝えたのに broad 再質問」という体感最悪の回帰で、回帰テストが書きやすい。

### 9.2 スコープに含めない(縦切りを薄く保つ)

- draft block の move capability 新設(§7.2 の欠落)。
- 保存・承認の NL 化(§7.3)。
- ambiguity 一般化(§8.3)。
- timetable データ層の改修(intake は「利用中」の宣言・可用性参照まで. 実データの busy interval 化は `existing-plans-availability-exclusion`(closed)で完了済み)。

## 10. Historical renderer context contract（Fの証拠）

> **Historical contract evidence; current response grounding is defined by v4 §4 and DA1.**

renderer は「どう言うか」だけを担当する現在の責務分離(R2-D)を維持する。ただし自然な質問文に必要な deterministic context を欠かさない。RenderInput へ供給すべき最小 context:

- **planning period**(`state.range` を「来週」等の period ラベル素材として。日付そのものではなくラベル)。← **実例1 の回帰防止**
- 対象単位(exam prep なら「年度」)。
- 既に利用中の constraint source(§8.1 で `use_constraint_source` が成立したら「授業は既存の時間割を利用中」)。
- 受理済みの事実(accepted facts)と不足の差分(missing)。
- planner が現在利用可能な capability(§7.1 snapshot)。
- 各 nextQuestion のユーザー語彙ヒント(intent の内部キーを直訳させない。「固定の予定」→平易語)。

### 10.1 契約(回帰テストで要求する)

1. **AI は context 外の事実を捏造しない**: period を渡さないのに「今週/来週」を勝手に決めない。渡した period だけを使う。deterministic fallback も同じ period を出す。
2. **「来週」と入力したら質問文は「今週」と言わない**(AI 経路・deterministic fallback の両方)。これは失ってはならない回帰。
3. 個別文字列一致ではなく、**同義表現・表現ゆれが semantic level で同じ intent に解釈される契約**をテストで要求する(例: 「予定表の通り」「時間割に入っている」「登録済みの授業を考慮」が同一の `use_constraint_source(timetable, active)` になる)。

> **Historical handling:** preserve this evidence, but do not treat old proposals or old task order as implementation instructions. Current status is v4 only.
