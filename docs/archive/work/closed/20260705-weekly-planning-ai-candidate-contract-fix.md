# AI candidate 受信契約の不整合修正(confidence 必須化・候補単位処理・enum 語彙検証)【完了 2026-07-05】

> **完了記録**: 実装・採用・コミット済み。候補単位処理・parseRejections 記録・enum 語彙検証は以後の再スモークで機能を確認。ただし本タスクで schema の properties に confidence だけを列挙したことが「payload 欠落応答」の回帰を生み、後続の `closed/20260705-weekly-planning-command-schema-completion.md` で修正された。

R2-C-eval の手動スモーク(実 AI 到達成功・抽出品質良好・**受信側不整合で全滅**)で判明した、AI 応答の受信契約の不整合を修正する小タスク。**R2-D(renderer 実接続)は本タスク完了後に進む。**

本mdに書かれていない範囲へ進まない。対象外の気づきは発見事項として報告する。git add / commit / push はしない。

## 背景(調査で確定済みの原因)

実 AI は評価ケース第1号に対して良質な candidates(`set_exam_scope` fields 5件・yearRange 2025〜2019、`set_priority_policy` field_first)を返したが、次の不整合により **parser 段階で全滅**し、validator にも reducer にも到達しなかった。

1. **confidence の必須性が層ごとに食い違う**: response schema は candidate の required を `['command', 'needsConfirmation']` のみとし、command 内の `confidence` を要求していない。prompt も confidence の判定基準は述べるが「各 command に含めよ」とは指示していない。一方 parser(`isCommandCandidate`)と validator(`hasRequiredShape`)は `command.confidence` を必須にしている。AI は schema に忠実に confidence を省き、受信側が全部捨てた。
2. **parser が all-or-nothing**: `parsed.candidates.every(isCommandCandidate)` により、1件でも不正なら応答全体を空配列として破棄する。validator の候補単位処理と矛盾する。
3. **parser 破棄が無音**: rejected の記録は validator 以降にしかなく、parser 全滅は「候補0件」としか観測できない。
4. **enum 語彙の検証漏れ**: 実 AI は `unitModel: 'field-year'`(domain の `StudyScopeUnit` に存在しない値)を返した。validator に enum 語彙チェックがないため、confidence を直しただけではこの不正値が state まで流れ、missing 判定や draft request の ready 条件が静かに壊れる。

設計メモ(`docs/ai/strategy/weekly-planning-r2-ai-interpreter-design.md` §3)では「confidence 欠落時は low 扱いに格下げ」と定めており、実装(拒否)が設計から逸脱している。

## 対象(この6点に限定)

1. **response schema と prompt で confidence を明示的に要求する**: schema の command 側に `confidence`(enum: high / medium / low)を required で追加し、prompt に「各 command に confidence フィールドを含める」と明示する。
2. **confidence 欠落時は low へ格下げする**(設計どおり): parser で欠落・不正値の confidence を `'low'` に補完して通す(validator の low 扱い = clarifications 行きに乗る)。
3. **parser の all-or-nothing をやめ、候補単位で扱う**: 構造不正(command が object でない、type が string でない等)の候補だけを破棄し、正常な候補は残す。
4. **parser 段階の破棄理由を diagnostics に残す**: 破棄した生候補と理由(例: `invalid-candidate-shape`)を pipeline 出力から観測できるようにする(interpreter の戻り値を `{ candidates, parseRejections }` 形へ拡張するのが素直。fake / pipeline / real-eval ハーネスの追随は機械的変更に留める)。real-eval の記録 JSON にも parseRejections が載ること。
5. **validator に enum 語彙検証を追加する**: 少なくとも `set_exam_scope.scope.unitModel` と `set_unit_rate.unitRate.unit`(`StudyScopeUnit`)、`set_priority_policy.policy.kind`、`mark_completed_units.mergeMode`、`add_unavailable` / `add_fixed_event` / `update_life_constraint` の `hardness` と `update_life_constraint.kind`。enum 外の値は理由つき rejected(例: `invalid-unit-model`)。
6. **回帰テストの追加**(下記)。

## 回帰テスト(red → green で進める)

**production code に触る前に intended test を追加して red を確認する。**

1. **実ログ形の fixture 固定(最重要)**: 手動スモークで観測した実 AI 応答の形 — command に confidence なし・`unitModel: 'field-year'`・candidate は command + needsConfirmation のみ — を fake / fixture として登録し、修正後は「confidence 欠落候補が low 格下げで生き残り clarifications に入る」「`field-year` の exam scope が `invalid-unit-model` で rejected になる」「正常な `set_priority_policy` は candidate 単位で生き残る」ことを固定する。
2. 1件の構造不正候補が混ざっても他の正常候補が適用されること(all-or-nothing の廃止)。
3. parser 破棄理由が pipeline 出力(interpreterDiagnostics 相当)から観測できること。
4. schema 定数に confidence が required で含まれることの形状テスト(schema と parser の再乖離防止)。
5. 既存のモックテスト・foundation テスト・regression がすべて期待値変更なしで green(期待値変更が必要になったら「現状固定か intended か」を明記して report)。

## 対象ファイル候補

- `src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts`(schema / prompt / parser)
- `src/features/weeklyPlanning/intake/weeklyPlanningInterpreterTypes.ts`(戻り値拡張)
- `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts`(enum 語彙検証)
- `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`(parseRejections の diagnostics 反映)
- `src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts` / `weeklyPlanningInterpreterFoundation.test.ts` / `weeklyPlanningAiInterpreter.real-eval.test.ts`(テストと記録項目の追随)
- 必要なら `testFixtures/weeklyPlanningEvaluationCases.ts`(実ログ形 fixture の追加。既存値の変更禁止)

## 触らない範囲 / 停止条件

- prompt の抽出品質チューニングの反復(confidence 指示の追記のみ。表現改善は別タスク)。
- escalation 条件、renderer、UI、Cloudflare proxy / Worker、scheduler、保存・承認導線。
- domain 型(`StudyScopeUnit` / `PriorityPolicy` 等)の変更 — validator が既存 enum を参照するだけにする。
- interpreter interface の拡張が fake / pipeline / real-eval の機械的追随を超えて波及する場合は停止して報告。
- 説明できない新規テスト失敗が出たら停止。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check
git diff --stat
git status -sb
```

CI が実 AI を呼ばないこと(ネットワークなしで全 green)を維持する。

## 完了後

- R2-C-eval の Phase 2(opt-in 自動評価)を修正後の契約で実施すれば、修正の実地確認を兼ねられる(実施はユーザー判断)。
- 完了して初めて R2-D(renderer 実接続)へ進める。
