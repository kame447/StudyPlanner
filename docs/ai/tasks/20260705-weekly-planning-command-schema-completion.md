# AI interpreter の command response schema 完全化(union 化と完全性テスト)

candidate contract fix 後の再スモークで見つかった回帰の修正タスク。**R2-D はこのタスクと再スモークの完了後に進む。**

本mdに書かれていない範囲へ進まない。対象外の気づきは発見事項として報告する。git add / commit / push はしない。

## 背景(調査で確定済み)

contract fix で command schema の `properties` に `confidence` だけを列挙し required にした結果、実 AI は「schema に列挙されたプロパティ = 出力すべき完全な形」と解釈し、**payload(type / fields / yearRange / policy / order 等)を一切含まない応答**を返すようになった:

```json
{"candidates":[{"command":{"confidence":"high"},"needsConfirmation":false},{"command":{"confidence":"medium"},"needsConfirmation":true}]}
```

`additionalProperties: true` は「許可」であって「指示」ではなく、モデルは使わない。全候補は parser の `command.type` チェックで `parseRejections`(`invalid-candidate-shape`)に落ち、候補0件 → state 不変 → 同じ質問の繰り返しとなった(破棄が観測可能な点は contract fix の成果として機能)。

前回(confidence 欠落で全滅)と今回(payload 欠落で全滅)の2連続の教訓: **response schema が唯一の実効的な契約であり、部分的に書くと部分しか返らない。schema は閉世界として完全に書く。**

## 対象(この3点に限定)

### 1. command schema の完全 union 化

`WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT` の command 部分を、interpreter が受理可能な全 command type(validator の `KNOWN_COMMAND_TYPES` にある 11 種: `add_unavailable` / `add_fixed_event` / `update_life_constraint` / `set_priority_policy` / `mark_completed_units` / `note_progress_boundary` / `note_no_fixed_events` / `note_uncertainty` / `set_unit_rate` / `set_exam_scope` / `set_planning_range`)を網羅する **anyOf の union** として定義する。

各サブスキーマの方針:

- `type`(該当 command type の固定値)と `confidence`(enum: high / medium / low)を required にする。
- payload は `intake/weeklyPlanningCommandTypes.ts` の各 interface を写像する(`set_exam_scope` は scope(fields / yearRange / totalYears / strategyHint / unitModel / rawText…)、`set_priority_policy` は policy.kind と order、`set_planning_range` は range、`set_unit_rate` は unitRate、`mark_completed_units` は field / completedYears / mergeMode、`add_fixed_event` は event、`add_unavailable` は range、`update_life_constraint` は kind と constraint、`note_progress_boundary` は field / boundaryYear / ambiguity、`note_uncertainty` は uncertainty、等)。
- **Phase 1 として、validator(`hasRequiredShape` / `validateValueRange` / enum 検証)・adapter・reducer が実際に参照するフィールドを棚卸しし、それらが schema で表現されていることを確認してから schema を書く**(参照されるのに schema にないフィールドが残ると、今回と同型の「静かな欠落」が再発する)。`sourceText` / `sourceSegment` の扱い(required にするか、欠落時に parser が userText で補完するか)もこの棚卸しで決めて報告する。
- enum 値(`unitModel` / `unit` の `StudyScopeUnit`、`policy.kind`、`mergeMode`、`hardness`、constraint `kind` 等)は domain の値を schema 側にも列挙し、validator の enum 検証と一致させる。
- command レベルの `additionalProperties` は `false` に閉じる(閉世界化。strict: false のままなので API 制約はない)。
- prompt の散文のフィールド説明(command types の列挙)は schema と矛盾しない範囲で簡素化してよいが、**prompt 品質のチューニングには進まない**。

### 2. schema 完全性テスト

`KNOWN_COMMAND_TYPES` の各 type について、response schema の anyOf に対応するサブスキーマが存在し、`type` と `confidence` が required であることを検査するテストを追加する(export 済みの schema 定数を直接検査)。**このテストは現行 schema に対して red になるはず**で、これが本タスクの red → green の軸になる。validator の `KNOWN_COMMAND_TYPES` に将来 command が追加されたとき、schema の追随漏れを red で検出できるようにする。

### 3. 回帰テスト(fixture)

- **payload 欠落応答の固定**: 今回観測した実応答(上記 JSON)を fixture 化し、全候補が `parseRejections`(`invalid-candidate-shape`)に落ちて候補0件になることを固定する(現挙動どおり・schema 修正後も不変)。
- **完全応答の通過**: 手動スモークで観測した内容に基づく完全な `set_exam_scope`(fields 5件・yearRange 2025〜2019・unitModel year_field_chunk)/ `set_priority_policy`(field_first・order)/ `set_planning_range` 応答が、parser → validator を通過して accepted / acceptedWithConfirmation に入り、mock pipeline で state に反映されることを固定する。
- 既存テスト(foundation / mock / regression)はすべて期待値変更なしで green。

## 対象ファイル候補

- `src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts`(schema 定数、必要なら prompt の簡素化)
- `src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts`(schema 完全性テスト・fixture テスト)
- 必要なら `testFixtures/weeklyPlanningEvaluationCases.ts`(実応答 fixture の追加。既存値の変更禁止)
- parser / validator / pipeline / interpreterTypes は**原則変更しない**(Phase 1 の棚卸しで sourceText 補完等の小変更が必要と判明した場合のみ、その根拠を報告してから最小で行う)

## 触らない範囲 / 停止条件

- **strict: true 化**(全 required + additionalProperties: false + null 許容の設計が要るため別タスク)。
- prompt 品質のチューニング反復、renderer、UI、escalation 条件、Cloudflare proxy / Worker、domain 型(`weeklyPlanningCommandTypes.ts` / `StudyScopeUnit` 等)の変更。
- parser / validator のロジック変更が「sourceText 補完」程度を超える場合は停止して報告。
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

## Codexへの実装指示(要約)

1. Phase 1: validator / adapter / reducer が参照する payload フィールドの棚卸しを報告 → Phase 2: schema 完全性テストを追加し **red を確認** → Phase 3: anyOf union schema を実装して green → Phase 4: fixture 回帰(欠落応答・完全応答)を追加して全体検証、で停止。
2. schema のサブスキーマは `weeklyPlanningCommandTypes.ts` の interface と1対1で突き合わせ、写し漏れをなくす(棚卸し表を報告に含める)。
3. 完了後の実地確認(手動スモーク再実施)は R2-C-eval 側で行うため、このタスクには含めない。
4. `docs/ai/codex-task-guide.md` に従う。
