# 対話P3(旧Stage2): 計画開始 intent の受理と dialogue decision の状態分類を分離する

> **改訂 2026-07-11(親設計 v2 対応)**: 親設計は draft-first / progressive refinement へ改訂された(`weekly-planning-dialogue-architecture.md`)。本タスクの機構(begin intent / planning_period / taxonomy 分離)はそのまま必要だが、位置づけが変わる: **開始質問は「何も仮定できない(blocking)場合」の経路**であり、目標・期間が揃い次第 preview-first(P1/P2)が主応答になる。
>
> **再改訂 2026-07-11(親設計 v3 対応)**: 意味解釈は AI interpreter に一本化された(v3 §2-1・I1)。これに伴い本タスクの「修正方針 1」の**deterministic parser gate(`parseBeginWeeklyPlanningCommand`)は rules モード fallback 用の補助**に格下げし、provider 時の begin 検出は AI schema + prompt(方針1の AI 側)を正とする。pending gate の scope 語拡充(方針3)も rules fallback の範囲。taxonomy(方針4)・slot 登録(方針5)・reducer 適用規則(方針2)は変更なし。**前提: I1・I2 完了後に実施**(P1・P2 はコミット済み)。受け入れ条件 1〜5 は rules モードでは deterministic gate 経由、provider モードでは stub interpreter の begin command 経由で検証する。

Priority: **High**(理由: 「予定作りたい」「明日と明後日の予定立てたい」「来週の予定を立てたい」が実測で全て「条件の整合性が取れず…」という虚偽の失敗応答に落ちており、週間計画対話の入口そのものが機能していない)

本mdの範囲外へ進まない。git add / commit / push はしない。

**前提**: 親設計 v2 §7 の P3。**preview方針Stage2(`20260711-weekly-planning-preview-policy-stage2-preview-first-decision.md`)完了後に実施する**(decision の優先順が preview-first に変わった上へ taxonomy を載せるため。逆順だと同一関数の二重改修になる)。T5(slot registry)は実装済みのため、「修正方針」5 の slot 追加は registry 1箇所 + 型 union で済む。着手時に実コードが本mdと食い違えば実装せず報告する。

## 背景

実測(2026-07-10・rules モード / AI モード同結果)で、開始発話 3 種が intent=unknown / status=idle / missing=[] のまま `createWeeklyPlanningDialogueDecision` の最終 else に落ち、`cannot_create_draft`(「条件の整合性が取れず、仮予定候補を作れませんでした」)を返すことを確認した。原因は2つ: (1)「週間計画を始めたい」という開始 intent を表す手段が deterministic parser にも AI schema にも無く、missing を seed する経路が期間 parse 成功と legacy fallback(週語+N時間×2)に限られる。(2) decision が「情報ゼロ」「機能未対応」「真の矛盾」を区別せず同一 kind・同一文言で返す。

## 目的

開始発話から「期間」「学習内容」の質問で対話を開始できるようにし、`cannot_create_draft` を本当に draft を作れない状態に限定する。未対応機能(非 exam の候補生成)は入力矛盾ではなく「できること/できないこと」の説明として返す。

## 計画書との対応

- spec: §5(不足情報だけを少しずつ聞く)、§13(メンター対話)
- 改善テーマ: 親設計 §5.1(decision taxonomy)/ dialogue-design-review W1・W2 / roadmap R2初期-2(情報不足と条件矛盾の分類分離)の残余消化

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/intake/weeklyPlanningCommandTypes.ts`(`begin_weekly_planning` command)
  - `src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts`(entry gate parser + pending gate の scope 語拡充)
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts`(command case + setup 順序)
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeTypes.ts`(missing key `planning_period`)
  - `src/features/weeklyPlanning/intake/weeklyPlanningMissingStatus.ts`(status / questions)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts`(KNOWN_COMMAND_TYPES / shape)
  - `src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts`(schema + prompt 1 bullet)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueManager.ts`(decision taxonomy / questionPlan / slot 登録)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueMessages.ts`(新 kind の deterministic 文言 / slot ラベル)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts`(slot 語彙・fallback 質問文)
  - (T5 実装済みの場合は registry ファイルへの追加で上記 dialogue/renderer/messages の大半が1箇所になる)
- 新規: なし
- テスト:
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueManager.test.ts`
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueMessages.test.ts`

## 現在の処理経路

1. missing の seed 経路は3つのみ: `set_planning_range`(状態導出シード)/ `set_pending_planning_range`(planning_start_date)/ legacy fallback branch A(`looksLikeWeeklyPlanningRequest` = `/今週|来週|週間|週/` かつ `N時間` 表現2件以上、`intake/weeklyPlanningLegacyFallback.ts`)。
2. pending 化 gate(`parsePendingPlanningRange`)は `hasOneWeekDuration` または `/来週.*計画/`。**「来週の予定を立てたい」は「予定」のため不一致**(実測)。
3. どの parser にも掛からない場合: intent=unknown・missing=[] → `resolveStatus` → idle → `createWeeklyPlanningDialogueDecision`:
   - missing 空 → ambiguity 無し → `shouldCreateDraft && !draftRequest`(line 369 相当)に該当せず → dry-run 無し → status ≠ draft_ready → **最終 else(line 403 相当)= `cannot_create_draft` / `cannot_create_draft_from_intake`**。
   - この kind は `renderWeeklyPlanningDialogueMessage` の AI 経路対象外(`ask_missing_info` のみ AI)で、`dialogueMessages` の固定文言が返る。
4. `cannot_create_draft` を返す site は dialogueManager に2箇所ある: (a) `shouldCreateDraft && !draftRequest`(条件が揃ったはずなのに adapter が null)、(b) 最終 else(それ以外すべての受け皿)。

## 問題点

- 開始 intent の表現手段が無い(W1)。AI に grounding(Stage 1)があっても、出力する command が無ければ空を返すしかない(W4 の一部)。
- 最終 else が「まだ始まっていない」状態の受け皿になっており、「整合性が取れず」という説明が内部状態(missing=[]・矛盾なし)と一致しない(W2)。
- 非 exam の目標が集まりきった場合(将来 Stage 3 後)も、adapter null → site (a) 経由で同じ虚偽文言になる。

## 修正方針

### 1. `begin_weekly_planning` command(semantic intent)

- `use_constraint_source` / `request_clarification` と同じ設計原則(capability model §8.4: 意味カテゴリ単位・payload で表現吸収)で追加する。payload は無し(confidence / sourceText / sourceSegment のみ)。**開始表現ごとに command や regex を増やさないこと。**
- deterministic parser: `weeklyPlanningScopeParsing.ts` に `parseBeginWeeklyPlanningCommand(text)` を追加。gate は「計画対象名詞 +作成動詞」の1本(例: `(予定|計画|スケジュール)` × `(立て|作|組|決め)` + 意志表現)。週間計画モード内の入力のみが対象なので誤爆面は狭い。名詞・動詞の細かな網羅はしない(拾えない開始表現は AI 側の写像が受け持つ)。
- AI schema に `begin_weekly_planning` を追加し、prompt に1 bullet: 「ユーザーが計画・予定を作りたいと表明したら(期間・内容が未指定でも)emit する」。`KNOWN_COMMAND_TYPES` / `hasRequiredShape` にも追加。

### 2. reducer の適用規則

- setup command 順序: range → pending → **begin** → exam scope(begin は range/pending が同一 turn で適用された**後**に適用し、下記 guard で二重 seed を防ぐ)。
- `case 'begin_weekly_planning'`:
  - `intent` が `unknown` のときのみ `weekly_study_planning` にする(exam_prep_planning を降格しない)。
  - `planning_period` を seed する。ただし `state.range` または `state.pendingPlanningRange` が既にあれば seed しない。
  - `tasks_or_goals` を seed する。ただし `state.examPrepScope` または `state.tasks.length > 0` があれば seed しない(T1 の状態導出シードと同じ判定。共有 helper `deriveMissingForPlanningRange` の tasks_or_goals 判定部を再利用してよいが、fixed_events / sleep / meal は**ここでは seed しない** — 生活制約の質問は期間確定後の既存フローに任せる)。
- `set_planning_range` / `set_pending_planning_range` の case に `removeMissing(['planning_period'])` を追加(期間が pending 化 or 確定したら planning_period は解消)。

### 3. pending gate の scope 語拡充(最小)

- `parsePendingPlanningRange` の `/来週.*計画/` を `/来週.*(計画|予定|スケジュール)/` に広げる(「来週の予定を立てたい」→ 既存の pending 経路で開始日 clarification へ)。これは表現追加ではなく、同一 intent の対象名詞の正規化。**これ以外の regex 追加はしない。**

### 4. decision taxonomy の分離(dialogueManager)

`WeeklyPlanningDialogueDecisionKind` に2値を追加し、`createWeeklyPlanningDialogueDecision` の2つの `cannot_create_draft` site を次の写像に置き換える:

| 状態 | kind(新設は太字) | messageKey |
|---|---|---|
| missing あり | ask_missing_info(既存) | 既存 |
| ambiguity あり | confirm_ambiguity(既存) | 既存 |
| intent=unknown かつ tasks 空 かつ examPrepScope 無し かつ missing 空(=対話未開始・解釈不能 turn) | **open_planning_dialogue** | open_weekly_planning_dialogue |
| shouldCreateDraft && !draftRequest かつ tasks あり かつ examPrepScope 無し(=非 exam は候補生成未対応) | **explain_capability_gap** | explain_weekly_planning_capability_gap |
| shouldCreateDraft && !draftRequest(上記以外 = exam 系で adapter null) | cannot_create_draft(既存・縮小) | 既存 |
| unscheduled あり / dry-run あり / draft_ready | 既存どおり | 既存 |
| 上記いずれでもない最終 else | **open_planning_dialogue**(受け皿も「開始への誘導」にする) | 同上 |

- `dialogueMessages` に deterministic 文言を追加:
  - open_planning_dialogue: 「どんな計画を作りたいか教えてください。対象の期間(例: 来週)と、学習したい内容から始めましょう。」(週の捏造をしない範囲で固定文言)
  - explain_capability_gap: 「この学習内容の仮予定候補の自動生成にはまだ対応していません。現在は過去問(年度×分野)型の計画に対応しています。」+ 既存 `buildConditionSummary`。
- 両 kind とも AI renderer の対象にはしない(Stage 5 の範囲)。`renderWeeklyPlanningDialogueMessage` は変更不要(`ask_missing_info` 以外は自動的に dialogueMessages 経路)。
- `decision.shouldCreateDraft` は両 kind とも false。`shouldSavePlan: false` 維持。

### 5. `planning_period` slot の登録(T5 registry 実装済み)

- `weeklyPlanningIntakeTypes.ts` の `PlanningIntakeMissing` union に追加。
- `intake/weeklyPlanningQuestionSlots.ts`(registry)に slot 定義を1件追加: intent `ask_planning_period` / status `needs_scope`(判定順は planning_start_date の直前)/ 質問文「いつからいつまでの計画にしますか？」/ 用語説明・語彙ヒント・ユーザーラベル(「計画の期間」)/ questionPlan 先頭・dependsOn なし。
- **previewPolicy(P1 で導入済みのフィールド)は `assumable`**: 既定 = 現在日時から 7 calendar days(既存の inferred range 既定と同じ意味)。これにより「目標だけ分かっていて期間未指定」のケースは P2 の preview-first で仮定期間の preview に進み、planning_period の質問は「目標も期間も無い開始時」に blocking の tasks_or_goals と並んで出る形になる。

## 責任境界

- 開始 intent の**検出**は parser(1本の gate)と AI(意味写像)。**開始後に何を聞くか**は missing/questionPlan の既存 deterministic 機構。
- 状態分類(taxonomy)と応答目的の決定は dialogue policy(deterministic)。文言は dialogueMessages(deterministic)。AI は本タスクでは応答生成に関与しない。
- reducer に自然言語を追加しない(gate は parser 層)。validator の防衛線は変更しない(command 追加のみ)。

## 触らない範囲

- `looksLikeWeeklyPlanningRequest` の判定式(roadmap §7 で凍結中。begin gate は別関数として新設し、既存 gate に触れない)
- legacy fallback の分岐条件(Stage 3 の範囲)
- draft request adapter の exam 専用条件(R3)・scheduler・preview・保存/承認導線
- AI renderer の適用範囲拡大(Stage 5)
- `weeklyPlanningInterpreterEscalation.ts`(Stage 6)
- `shouldSavePlan: false` を維持する

## 受け入れ条件

すべて `planningStartDate: '2026-07-10'` / `currentDateTime: '2026-07-10T15:30:00'`、rules モード(deterministic のみ)で:

1. 「予定作りたい」→ decision.kind が `ask_missing_info`、questionPlan に `planning_period` と `tasks_or_goals`、応答文言に「整合性」が含まれない。
2. 「明日と明後日の予定立てたい」→ 同上(期間の deterministic 解決は本タスクの対象外。planning_period の質問が出れば合格)。
3. 「来週の予定を立てたい」→ `pendingPlanningRange` が設定され、`planning_start_date` の質問(「来週のどの日から〜」)+ `tasks_or_goals` の質問になる。`planning_period` は missing に入らない。
4. 「来週の計画を立てたい」の既存フロー(pending → 「水曜日から」)が全 regression green のまま。
5. 完全に解釈不能な turn(例: 「こんにちは」)→ `open_planning_dialogue` になり、`cannot_create_draft` にならない。
6. stub interpreter が空 candidates を返す AI モードでも、上記 1〜5 の decision が同じになる(contract 7)。
7. tasks があり examPrepScope が無い draft_ready 状態(手組み state で可)→ `explain_capability_gap` になり、「整合性が取れず」文言が出ない(contract 8)。
8. exam prep の正常フロー(既存テストの draft_ready / offer_dry_run_preview / cannot_create_draft(adapter null))の decision が変わらない。ただし既存テストのうち「情報ゼロ状態で cannot_create_draft を期待する」ものは本タスクの意図した変更として期待値を更新し、報告に列挙する(既知の該当候補: `weeklyPlanningDialogueManager.test.ts:313` 付近、`weeklyPlanningIntakePipeline.test.ts:223` 付近 — どちらの site を検証しているか確認して判断)。
9. `begin_weekly_planning` が AI schema / KNOWN_COMMAND_TYPES に存在し、stub interpreter 経由で適用できる。
10. 既存テスト全 green(意図した更新を除く)+ `npm run build` 成功。

## テスト観点

- pipeline: 受け入れ条件 1〜6(複数 turn: 開始 → 期間回答 → 既存フロー接続)。
- dialogueManager: taxonomy の写像表(idle / 非exam gap / exam null / 最終 else)を状態別にユニットテスト。
- dialogueMessages: 新 kind の文言、`planning_period` ラベル。
- 境界: begin + 期間が同一 turn(「来週の計画を立てたい」)で planning_period が seed されないこと。exam intent(「院試の過去問を進めたい」)で begin が intent を上書きしないこと。
- regression: legacy fallback テスト(`来週、英語を3時間、数学を2時間` は begin gate 対象外の動詞なし発話であることを確認)・weekend range・T1〜T3 の全テスト。

## リスク

- begin gate の誤発火: 「予定を消したい」等の削除系発話も名詞+動詞に近い。gate の動詞集合を作成系(立て/作/組/決め)に限定し、削除・変更系の語(消し/削除/変え)を含む場合は emit しない negative 条件を1つ置く(これは表現追加ではなく安全条件)。
- `open_planning_dialogue` が受け皿になることで、真の不具合(パイプライン例外系)が「開始質問」に化ける可能性 → UI の catch 文言(「会話状態を更新できませんでした」)は別経路であり影響しない。
- planning_period と planning_start_date の質問が近い意味を持つ。文言で区別する(期間全体 vs 期間内の開始日)。同一 turn に両方が missing になる状態は作らない(pending があれば planning_period は seed/維持しない)。

## Codexへの実装指示

1. 最初に本md全体と `docs/ai/codex-task-guide.md`、親設計 §5・§5.1 を読む。
2. T5(slot registry)の実装有無を確認し、登録方法を分岐する(「修正方針」5)。
3. 実装順: 型(command / missing)→ parser gate → reducer → missingStatus → dialogueManager taxonomy → messages / renderer 登録 → validator / AI schema → テスト。
4. 参照すべき既存実装: `use_constraint_source`(semantic intent command の追加様式)、`set_pending_planning_range`(seed パターン)、`deriveMissingForPlanningRange`(状態導出 seed の判定共有)。
5. 検証(Node 22):

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/dialogue
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```

6. `docs/ai/codex-task-guide.md` に従う: スコープ外へ広げない、git 操作をしない、期待値を更新した既存テストを理由つきで報告する。
