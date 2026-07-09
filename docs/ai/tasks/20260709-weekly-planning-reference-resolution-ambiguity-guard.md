# 参照表現を一意に解決できない constraint source 候補を hard apply せず clarification に倒す

本mdの範囲外へ進まない。git add / commit / push はしない。production code は本タスク実装時のみ変更。設計根拠は `docs/architecture/weekly-planning-nl-capability-model.md` §8.1(semantic intent) / §8.2(clarification intent) / §9(vertical slice)。

## 背景

weekly planning AI interpreter real-eval の `ambiguous:2` で、nano だけが曖昧な参照表現を hard apply した。

対象 golden case:

```text
case ID: ambiguous:2
group: ambiguous
input: 入れてあるやつをそのまま考慮して
expected: notHardApplied=true, clarified=true
```

この入力では「入れてあるやつ」が timetable / existing_plans のどちらを指すか一意に決められない。active source が複数ある状態では、単一 source に勝手に確定せず clarification に倒すべきケース。

real-eval 診断で確認済みの事実:

```json
{
  "caseId": "ambiguous:2",
  "group": "ambiguous",
  "inputText": "入れてあるやつをそのまま考慮して",
  "expected": { "notHardApplied": true, "clarified": true },
  "rawAiResponse": {
    "candidates": [
      {
        "type": "use_constraint_source",
        "confidence": "high",
        "sourceText": "入れてあるやつをそのまま考慮して",
        "source": { "kind": "existing_plans", "selector": "active" }
      }
    ]
  },
  "parsedCandidate": {
    "command": {
      "type": "use_constraint_source",
      "confidence": "high",
      "sourceText": "入れてあるやつをそのまま考慮して",
      "source": { "kind": "existing_plans", "selector": "active" }
    },
    "origin": "ai_interpreter",
    "needsConfirmation": false
  },
  "validatorResult": {
    "accepted": ["use_constraint_source(existing_plans, active)"],
    "acceptedWithConfirmation": [],
    "clarifications": [],
    "clarificationRequests": [],
    "rejected": []
  },
  "finalEvaluationResult": { "notHardApplied": false, "clarified": false },
  "hardApplied": true,
  "clarified": false
}
```

mini は同じ `ambiguous:2` で failure にならなかった。差分は、nano が曖昧な参照先を `existing_plans` と high confidence で確定し、validator が accepted として通した点。

診断分類は A(interpreter が曖昧参照を確定候補にした) + 境界不足(validator が参照解決済みかどうかを検証できる契約がない)。validator / reducer は自然文の参照曖昧性を再判定する責務を持っていないため、high confidence の `use_constraint_source` は通常の確定候補として hard apply される。

## 目的

- 参照先が現在発話または利用可能な文脈から一意に解決できない `use_constraint_source` 候補を、hard apply せず clarification に倒す。
- 「それ」「やつ」「もの」等の単純キーワード guard にはしない。直前発話・recent mentions・pending clarification・intake state から将来 resolver が一意解決できる余地を残す。
- semantic interpretation / reference resolution / ambiguity decision / validator の責任境界を整理し、現在は最小の安全策だけを実装できる境界を作る。
- `ambiguous:2` を regression として固定し、nano が同じ誤確定をしても pipeline が安全側に倒れるようにする。

## 計画書との対応

- spec: §5(聞き取り)、§6(質問しすぎ防止)、§12(責務分離)
- 改善テーマ: roadmap Phase R2-Capability / semantic intent の安全化。`constraint-source-capability` で追加された `use_constraint_source` の参照先決定を、将来の reference resolution へ接続できる形に分離する。

## 対象ファイル

- 変更(想定):
  - `src/features/weeklyPlanning/intake/weeklyPlanningInterpreterTypes.ts`(必要なら参照解決結果・曖昧性 reason を表す最小型を追加)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts`(resolver の resolution status を受け取り、未解決/複数候補の hard accepted を防ぐ safety invariant の enforcement に限定)
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`(interpreter candidate と validation の間に resolver / ambiguity decision を接続)
  - `src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts`(必要なら schema/prompt の最小補強。ただし prompt だけに依存しない)
- 新規(必要なら):
  - `src/features/weeklyPlanning/intake/weeklyPlanningReferenceResolution.ts` など、constraint source 参照解決の小さな境界。時系列文脈全体は実装しない。
- テスト:
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts`
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.real-eval.test.ts`(diagnostic/filter は利用。golden case の入力・期待値は変更しない)

## 現在の処理経路

- AI interpreter は `use_constraint_source` を直接 `source.kind=timetable | existing_plans` 付きで返す。
- `parseCandidate` は confidence を正規化し、`confidence=high` なら `needsConfirmation=false` になる。
- validator は shape / enum / availability / confirmed slot / confidence を検証する。参照表現が一意に解決されたかどうかは判断しない。
- `confidence=low` は `clarifications`、`confidence=medium` は `acceptedWithConfirmation`、`confidence=high` は `accepted` に入る。
- pipeline は `accepted` と `acceptedWithConfirmation` を `applyWeeklyPlanningCommands` に渡す。
- reducer は `use_constraint_source` を適用すると `constraintSourcesInUse` に source を記録し、`fixed_events` missing を除去する。

## 問題点

- interpreter が曖昧参照を high confidence の単一 source として返すと、後段はそれを参照解決済み事実として扱う。
- validator は source availability は検証できるが、「この source.kind が文脈から一意に導かれたか」は検証できない。
- 現在の schema は `use_constraint_source(existing_plans)` と「曖昧な参照表現から推測された existing_plans」を区別できない。
- 単純キーワード guard にすると、将来「直前に保存済み予定の話をしていたので『それ』が existing_plans と一意に解決できる」ケースまで潰してしまう。

## 責任境界

- semantic interpretation: ユーザーが「既存の予定/時間割/保存済み source を制約として使いたい」と言っているかを command candidate として抽出する。曖昧な参照語を無理に source.kind へ確定しない。
- reference resolution: current utterance と利用可能な deterministic context から、参照先が `timetable` / `existing_plans` のどちらか一意かを判定し、`resolved` / `unresolved` / `multiple` の resolution status を返す。将来は直前発話・recent mentions・pending clarification・intake state を入力に増やせる境界にする。
- ambiguity decision: reference resolution が `unresolved` または `multiple` を返した場合、hard apply せず `request_clarification(target=unresolved_slot, ref=constraint_source)` へ倒す。
- validator: shape / enum / availability / confidence を検証し、resolver が返した resolution status を見て、`unresolved` / `multiple` が hard accepted されない safety invariant を enforcement する。validator 自身は `sourceText` のキーワード解析や自然文の参照解決を行わない。

責任境界は次を原則とする。

```text
semantic interpretation
→ reference resolution
→ ambiguity decision
→ validator
→ apply / clarification
```

validator 内で `sourceText` を再解析して timetable / existing_plans を判定する実装にはしない。

## 修正方針

### Phase 1(最小安全策)

1. `use_constraint_source` candidate について、source.kind が現在発話と利用可能な deterministic context から一意に解けているかを判定する小さな resolver 境界を用意する。
   - 明示的に timetable を指す例: `時間割`, `授業`, `今学期の時間割`, `登録済みの授業` など。
   - 明示的に existing_plans を指す例: `保存済みの予定`, `アプリに保存してある予定`, `もう登録してある予定` など。
   - `入れてあるやつ`, `カレンダーに入ってる予定`, `カレンダーに入れてあるやつ` のように active source が複数あり一意でないものは `unresolved` または `multiple` とする。
2. resolver は単純な「やつがあれば必ず NG」ではなく、一意解決できる肯定証拠があるかを見る。肯定証拠が無い場合だけ clarification に倒す。
3. resolver は `resolved` / `unresolved` / `multiple` の resolution status を返す。validator はその status を受け取り、`unresolved` / `multiple` の candidate を `accepted` に入れない。自然文の再解析は validator では行わない。
4. unresolved / multiple の場合は、既存の `request_clarification(target=unresolved_slot, ref=constraint_source)` 経路が利用可能なら必ずそれを使う。既存経路が現在の pipeline 接続点から利用できない場合に限り、同等の clarification request を pipeline decision として返す最小接続を許可する。state は進めない。
5. `ambiguous:2` を fake interpreter で再現する regression を追加する。nano と同じ high-confidence `use_constraint_source(existing_plans)` を注入しても hard apply されないことを固定する。

### Phase 2(将来接続用の境界整備。広げすぎない)

6. resolver の入力型を current utterance / stateSummary / availableConstraintSources 程度に留める。ただし型名・戻り値は将来 recent mentions / pending clarification を足せる形にする。
7. real-eval の diagnostic/filter は `ambiguous:2` の単独再評価に使える状態を維持する。全 case の大量ログは出さない。

## 触らない範囲

- golden case の入力文・期待値。
- Worker routing / model policy / quota / API client / purpose routing。
- renderer の自然文生成。
- reducer の一般挙動全面変更。`use_constraint_source` 適用時に `fixed_events` を充足する既存仕様は、一意解決済み source では維持する。
- 時系列文脈全体の reference resolution 実装。直前発話・recent mentions・pending clarification の本格利用は別 task。
- advanced recurrence / sharing / mobile / analytics。
- 単純キーワード blacklist の大量追加。

## 受け入れ条件

- fake interpreter で `ambiguous:2` と同等の high-confidence `use_constraint_source(existing_plans)` を返しても、pipeline は `constraintSourcesInUse` を追加せず、`fixed_events` を hard 充足しない。
- 同ケースでは、既存の `request_clarification(target=unresolved_slot, ref=constraint_source)` 経路が利用可能なら、その正規経路で clarification request が発生する。
- 既存の `request_clarification` 経路が現在の pipeline 接続点から利用できない場合に限り、同等の clarification request を pipeline decision として返す最小接続を許可する。この場合も state は進めない。
- 明示的な timetable 表現(例: `時間割に登録してある授業はそのまま使って`)は従来どおり `use_constraint_source(timetable)` として hard apply できる。
- 明示的な existing_plans 表現(例: `アプリに保存してある予定と被らないようにして`)は従来どおり `use_constraint_source(existing_plans)` として hard apply できる。
- `confidence=low` / `request_clarification` の既存 validator・dialogue 経路を壊さない。
- validator 自身は `sourceText` の自然文解析を行わず、resolver の resolution status に基づいて safety invariant を enforcement する。
- weeklyPlanning テスト green / build 成功。

## テスト観点

- regression: nano 実測 candidate 相当 `{ type: 'use_constraint_source', source.kind: 'existing_plans', confidence: 'high', sourceText: '入れてあるやつをそのまま考慮して' }` → hard apply されず clarification。
- ambiguous golden: `授業はカレンダーに入れてあるやつでお願い` / `カレンダーに入ってる予定を使って` / `入れてあるやつをそのまま考慮して` → active source が複数なら hard apply されない。
- unambiguous timetable golden: 3件が regression しない。
- unambiguous existing_plans golden: 3件が regression しない。
- source availability: 一意解決済みでも source が空なら既存どおり availability reject / confirmation に倒れる。
- responsibility boundary: resolver が resolution status を返し、validator は status の enforcement のみを行うこと。validator 内に `sourceText` キーワード解析を追加しない。
- real-eval: `WEEKLY_PLANNING_REAL_AI_EVAL_CASE=ambiguous:2` と model filter で nano 単独、必要なら mini 比較。

## リスク

- resolver をキーワード blacklist として実装すると、将来の照応解決を阻害する。肯定証拠ベース + unresolved fallback に留める。
- validator に自然文判定を押し込みすぎると責務が肥大化する。validator は resolver の resolution status に基づく safety invariant の enforcement に留める。
- prompt だけの修正では nano の再発を防ぎ切れない可能性がある。pipeline 上の deterministic safety boundary を必ず入れる。
- 明示表現の hard apply を弱めすぎると `constraint-source-capability` の改善を後退させる。unambiguous golden を必ず regression に含める。

## 依存

- `20260708-weekly-planning-constraint-source-capability.md` の実装後を前提にする。
- `20260708-weekly-planning-clarification-semantic-intent.md` の `request_clarification` 経路が利用可能なら正規経路として必ず再利用する。未完了または現在の pipeline 接続点から利用不能な場合に限り、同等の clarification request を pipeline decision として返す最小接続に留める。

## Codexへの実装指示

1. まず `ambiguous:2` の real-eval diagnostic を読み、raw response / parsed candidate / validator result / hard apply を再確認する。確認済み事実と推測を混ぜない。
2. golden case の入力・期待値は変更しない。
3. `weekly_planning_interpreter` prompt だけに頼らず、deterministic safety boundary を作る。
4. reference resolution は current utterance + available context の最小入力で始め、`resolved` / `unresolved` / `multiple` の status を返す。将来 recent mentions を足せる型にする。時系列文脈全体は実装しない。
5. validator は resolution status の enforcement のみを担当し、`sourceText` のキーワード解析や自然文の参照解決を実装しない。
6. unresolved / multiple の clarification は、既存の `request_clarification` 経路が利用可能なら必ず再利用する。利用不能な場合のみ最小の pipeline decision 接続を許可する。
7. reducer / dialogue manager / renderer / Worker routing / model policy へ範囲を広げない。
8. `shouldSavePlan: false` 維持。UI/CSS/save/approval に触れない。
9. 最後に必ず `docs/ai/codex-task-guide.md` に従う。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```

real-eval 単独確認(必要な env がある場合のみ):

```bash
WEEKLY_PLANNING_REAL_AI_EVAL=1 \
WEEKLY_PLANNING_REAL_AI_EVAL_ID_TOKEN="$TOKEN" \
WEEKLY_PLANNING_REAL_AI_EVAL_MODEL="gpt-5.4-nano-2026-03-17" \
WEEKLY_PLANNING_REAL_AI_EVAL_CASE="ambiguous:2" \
npm run test:run -- \
src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.real-eval.test.ts
```
