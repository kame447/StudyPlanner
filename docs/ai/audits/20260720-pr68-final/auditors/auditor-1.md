# PR #68 最終監査 — Auditor 1（自然言語対話・状態遷移）

## HEAD

- Branch: `agent/fix-weekly-planning-trace-and-dialogue-final`
- HEAD: `23d7676370b3efebc8d1465dfd01abc32c6462ca`
- Base: `origin/main`
- 監査開始時に `.git/index.lock` が存在しないこと、作業ツリーが clean であること、HEAD が指定値と一致することを確認した。

## 担当範囲

自然言語入力が interpreter / rules から command、reducer、missing-status、question-plan、renderer、response、永続化へ流れる一連の状態遷移を独立監査した。特に、短答、訂正、曖昧入力、質問の繰り返し、同一ターンの accepted-fact 表示、pending turn、再読込後の質問文脈を対象にした。

## 主に確認したファイル

- `src/features/weeklyPlanning/application/useWeeklyPlanningApplication.ts`
- `src/features/weeklyPlanning/weeklyPlanningTurnController.ts`
- `src/features/weeklyPlanning/weeklyPlanningTurnExecutor.ts`
- `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`
- `src/features/weeklyPlanning/pipeline/weeklyPlanningRenderedQuestionContext.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningCommandAdapter.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningConstraintParsing.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningPriorityParsing.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningLifecycleInterpreter.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts`
- `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueManager.ts`
- `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts`
- `src/features/weeklyPlanning/weeklyPlanningReducer.ts`
- `src/features/weeklyPlanning/weeklyPlanningStorage.ts`
- 関連する PR 追加・変更テスト

## 実制御フロー

`useWeeklyPlanningApplication.submitTurn`（120–145行付近）
→ `submitWeeklyPlanningControlledTurn`（105–180行付近。state snapshot、user message、pending、revision/identity による stale commit 防止）
→ `executeWeeklyPlanningTurn`（42–115行付近。直前 intake、直近6メッセージ、今回入力を pipeline へ渡す）
→ deterministic preparation / AI interpreter / reference resolution / candidate validation
→ command adapter / intake reducer
→ missing/status と question plan（最大2問）
→ dialogue renderer（previous/current state delta から accepted fact を生成）
→ executor が最初の rendered question だけを `lastQuestionContext` として保存
→ controller が intake / assistant message / drafts を一括 commit
→ state hook の autosave。storage は `pendingTurn`、`pendingApproval`、session-only proposal を除外する一方、`intakeState.lastQuestionContext` は保存する。

## テスト・再現

- 一時 Vitest を作成し、以下4件を state/result の双方で再現した。4/4 passed（「現実装が不正挙動をする」ことを固定した counterexample）。一時ファイルは削除済みで、製品コードは変更していない。
  1. `23時から7時まで寝ます` に対して 07:00→23:00 の逆転 sleep command、および 23:30 の捏造 minute が accepted になる。
  2. `meal_bath_constraints` の質問直後の `19時です` が `ungrounded-life-constraint` で棄却される。
  3. 既存優先度が OS→ネットワーク→数学の状態で `ネットワークを先に変えてください` が `confirmed-slot-overwrite` となり、順序が変わらない。
  4. `3時間です` に canonical 180分・`rawText: 30分` の command を与えると state は180分だが accepted-fact 表示は30分になる。
- 全 Vitest: 146 files passed / 1 failed / 1 skipped、1274 tests passed / 1 failed / 13 skipped / 5 todo。失敗は後述 M-5。
- TypeScript `tsc --noEmit`: passed。
- Vite production build: passed（既存の chunk-size / mixed static-dynamic import warning のみ）。
- `package.json` に lint script は見つからなかったため lint は未実行。

## BLOCKER

なし。

## MAJOR

### M-1: sleep の時刻根拠が「役割」と「分精度」を保証せず、逆転・捏造時刻を accepted にする

- 根拠: `weeklyPlanningCandidateValidator.ts:234-243` の `normalizedTextContainsValue` は構造化値が `23:30` でも、日本語時刻の minute 部分を任意にした正規表現により入力中の `23時` と一致する。`weeklyPlanningCandidateValidator.ts:257-270` の `lifeConstraintPayloadGrounded` は start/end の値が入力のどこかに存在するかだけを検査し、どちらが開始・終了かを検査しない。life constraint update は同ファイル 458–461行付近でこの判定をそのまま使う。
- 発生条件: 入力 `23時から7時まで寝ます` に、AI が sleep `start=07:00,end=23:00` を返した場合、または `start=23:30,end=07:00` を返した場合。
- 現挙動: どちらも candidate が accepted され、`weeklyPlanningIntakeReducer.ts:350-356` で state に保存される。前者は睡眠時間帯を日中 07:00–23:00 と解釈させ、preview の空き時間を大幅に誤らせる。
- 期待: 時刻を構文上の start/end 役割に結び付け、入力に minute がない場合は `:00` 以外を根拠ありと扱わない。不一致なら reject/repair question にする。
- 根本原因: grounding が値集合の包含検査に留まり、関係・順序・精度を検証しない。
- テスト漏れ: 既存追加テストは正しい 23:00/07:00 と明白な 22:00 mismatch を覆うが、start/end 入れ替え、および hour-only 入力に対する non-zero minute を覆わない。
- 重大度理由: accepted された誤制約が生成計画の利用可能時間そのものを変え、ユーザーの睡眠時間を正反対に解釈するため MAJOR。

### M-2: meal/bath 質問直後の自然な短答 `19時です` を文脈解決できず黙って捨てる

- 根拠: `weeklyPlanningCandidateValidator.ts:291-312` は life-constraint kind ごとの語彙を現在入力に要求し、直前質問による例外は `sleep_cycle` + `kind === sleep` だけである。`weeklyPlanningConstraintParsing.ts` の deterministic parser も meal/bath 語を要求する。さらに `weeklyPlanningDialogueManager.ts:104,114-135` は最大2問を表示できるのに対し、`weeklyPlanningTurnExecutor.ts:96-108` が保存する `lastQuestionContext` は最初の1問だけである。
- 発生条件: assistant が「食事やお風呂など、勉強できない時間を教えてください」と質問し、ユーザーが `19時です` と答え、AI が meal の時刻として正しく構造化した場合。
- 現挙動: `ungrounded-life-constraint` で command を破棄し、回答内容は state に反映されない。ユーザーには rejection 理由が示されず、同じ不足扱いまたは default 前提で会話が進む。
- 期待: 直前の `meal_bath_constraints` 文脈を grounding に利用する。meal/bath のどちらか特定できなければ、入力を捨てず「19時は夕食開始ですか」等の限定的な repair question を返す。表示した2問目への短答も追跡可能にする。
- 根本原因: question context の利用が sleep にハードコードされ、question plan（複数）と persisted context（単数）のモデルが不整合。
- テスト漏れ: 既存テストは `夕食は19時` や `食事時間は60分、風呂は30分` のような自己完結入力だけで、直前質問に依存する bare-time reply を覆わない。
- 重大度理由: 最も自然な会話形式の回答が無言で消え、食事時間に学習予定を重ね得るため MAJOR。

### M-3: 確定済み優先度への明示訂正を常に reject し、ユーザーには失敗を知らせない

- 根拠: `weeklyPlanningIntakePipeline.ts:384-405` は既知 priority を confirmed slot に含め、`weeklyPlanningCandidateValidator.ts:839-847` は confirmed slot を更新する command を（exam scope 以外）`confirmed-slot-overwrite` として拒否する。一方、`weeklyPlanningLifecycleInterpreter.ts:83-134` の deterministic correction target は task のみであり、`weeklyPlanningAiInterpreter.ts:459-480,532-569` の response parse/schema は candidate と assumption proposal しか取り込まず、priority correction envelope の回復経路がない。prompt 自体は同ファイル 595–597行付近で訂正を調停するようモデルへ要求している。
- 発生条件: priority が OS→ネットワーク→数学で確定した後、ユーザーが `ネットワークを先に変えてください` と明示し、AI がネットワーク→OS→数学の正しい command を返す。
- 現挙動: command は `confirmed-slot-overwrite` で破棄され、古い順序のまま。renderer は rejection/確認を表示しないため、ユーザーは訂正が成功したように会話を続け得る。
- 期待: 明示的な correction intent を現在の発話から確立して更新するか、破壊的変更として確認質問を出す。少なくとも失敗を可視化する。
- 根本原因: overwrite guard と correction lifecycle が priority では接続されておらず、remote interpreter の correction 情報も schema 境界で失われる。
- テスト漏れ: 既存 pipeline test は訂正後も古い priority が残ることを guard の成功として assert するが、ユーザー向け確認・repair が存在することを assert していない。task correction の lifecycle test は priority を覆わない。
- 重大度理由: 計画生成の中心となる順序訂正が黙殺され、誤った preview/保存計画へ進むため MAJOR。

### M-4: accepted-fact 表示が未検証の `rawText` を canonical 値より優先し、受理内容を誤表示する

- 根拠: `weeklyPlanningCandidateValidator.ts:358-375` は `minutesPerUnit` の canonical 数値を入力に照合するが、同じ `unitRate.rawText` との整合性を検査しない。`weeklyPlanningCommandAdapter.ts:165-169` と reducer は command の unitRate object 全体を保存する。`weeklyPlanningDialogueRenderer.ts:179-184,351-354,490-492` は表示ラベルを `rawText` から作り、canonical minutes より優先する。
- 発生条件: ユーザーが `3時間です` と答え、AI が `minutesPerUnit=180`、`rawText=30分` を返す。
- 現挙動: state には正しく180分が accepted される一方、同一ターンの assistant acknowledgement は30分を受け付けたと表示する。
- 期待: accepted-fact は reducer が確定した canonical 値から生成するか、raw/canonical の一致を validator で保証する。
- 根本原因: evidence/display 用 raw data が validation 境界を迂回し、renderer で authoritative data として扱われる。
- テスト漏れ: 既存テストは canonical 30分を `3時間` へ割り当てる mismatch を reject するが、canonical と表示 rawText の内部矛盾を覆わない。
- 重大度理由: AI の提案を確認可能にするための acknowledgement 自体が事実と異なり、誤訂正や誤承認を誘発するため MAJOR。

### M-5: controller approval integration test が実時計に依存し、夜間は全 suite を赤くする

- 根拠: `weeklyPlanningControllerApprovalFlow.integration.test.ts:110` は `今日の勉強計画を立ててください` を送信し、143行付近で preview が必ず存在すると仮定する。pipeline は `weeklyPlanningIntakePipeline.ts:91-102` で `currentDateTime` 未指定時に実ローカル時刻を採用し、`weeklyPlanningScopeParsing.ts:74` の today range は現在時刻から当日24:00までを対象にする。
- 発生条件: 2026-07-19 21:12 JST 頃に全 suite を実行。fixture は2時間 task と meal/bath/sleep 等の制約を要求する。
- 現挙動: range は 21:12–24:00 しかなく、制約込みでは候補0件となる。`Preview was not created` で当該テストが失敗し、全結果は 1 failed になった。
- 期待: integration test が固定 `currentDateTime` を controller/executor まで注入するか fake timer を使う。あるいは late-day infeasible response を検証する別ケースとして切り分ける。
- 根本原因: 「today」の動的意味を検証するテストが時計を固定せず、常時 preview 可という別の仮定を置いている。
- テスト漏れ: 早朝/日中しか通らない fixture で、深夜境界を独立検証していない。
- 重大度理由: 製品の infeasible 判定そのものではなくテストの決定性の問題だが、時刻だけで PR の必須全テストが再現性なく失敗するため MAJOR。

## MINOR

なし。上記以外に、ユーザー影響を伴う独立した MINOR は確認しなかった。

## False positives として除外したもの

- `3時間です` に canonical 30分を割り当てる command、`23時から7時` に 22:00 を割り当てる command、sleep 発話を meal kind に割り当てる command は現 validator で正しく reject される。
- 正しい `23:00` / `07:00` sleep command と、hour-only `23時` → `23:00` は accepted される。M-1 はこの正常系ではなく、役割入れ替えと non-zero minute の抜け穴である。
- 2科目の明示順序を逆にした priority command は head grounding で reject される。M-3 は AI の誤りではなく、ユーザー自身が明示した「訂正」も回復経路なく reject される点である。
- accepted-fact は previous/current state delta から同一ターンに生成され、通常ケースでは次ターンに持ち越されないため、「常に1ターン遅れる」という問題は確認しなかった。M-4 は表示 evidence の不整合に限定した。
- deterministic constraint parser は数値的な時計根拠がない曖昧表現から勝手に精密時刻を作らないため、別 finding にはしなかった。
- controller の pending identity/revision guard は遅延した古い request の commit を防ぐ。storage が in-flight pending operation を永続化しないのも、復元不能な async 処理を再開しない意図として妥当であり finding にしなかった。`lastQuestionContext` は永続化される。
- 同じ missing slot の repair wording には改善余地があるが、M-2 のように有効回答を捨てる再現とは分離できないため、推測的な「常に同じ質問を繰り返す」finding は追加しなかった。

## 最終 git status

`git status -sb`:

```text
## agent/fix-weekly-planning-trace-and-dialogue-final...origin/agent/fix-weekly-planning-trace-and-dialogue-final
```

一時テストを含む未追跡・変更ファイルなし。Git write operation は実行していない。
