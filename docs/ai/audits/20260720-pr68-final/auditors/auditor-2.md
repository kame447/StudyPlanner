# PR #68 最終採用監査 — Auditor 2

## 監査メタデータ

- 監査対象ブランチ: `agent/fix-weekly-planning-trace-and-dialogue-final`
- 監査対象 HEAD: `23d7676370b3efebc8d1465dfd01abc32c6462ca`
- 比較元: `origin/main`
- 担当領域: AI interpreter と deterministic parser の責任境界、command adapter、runtime validation、candidate validation、grounding、fallback、AI renderer、regex 過剰解釈、AI 出力から state・preview・保存へ至る安全境界
- 監査方式: 他監査人の報告、過去レビュー、PR 本文の主張を参照せず、実コード、制御フロー、state 遷移、最小反例を根拠にした読み取り専用監査

## 調査した主要ファイル

- `src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningCommandRuntimeValidation.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningCommandAdapter.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningReferenceResolution.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningExamScopeEnrichment.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningConstraintParsing.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningMissingStatus.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningDraftRequestAdapter.ts`
- `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`
- `src/features/weeklyPlanning/pipeline/weeklyPlanningBehaviorAwareIntakePipeline.ts`
- `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts`
- `src/features/weeklyPlanning/weeklyPlanningTurnController.ts`
- `src/features/weeklyPlanning/weeklyPlanningTurnExecutor.ts`

## 追跡した制御フロー

1. `submitWeeklyPlanningControlledTurn` が入力長、pending turn、pending approval を検査し、snapshot と pending identity を固定する。
2. `executeWeeklyPlanningTurn` が provider を選び、AI provider では `runWeeklyPlanningBehaviorAwarePipelineWithInterpreter` を呼ぶ。
3. AI 呼出し前に `runWeeklyPlanningIntakePipelineWithInterpreter` が `applyDeterministicWeeklyPlanningUserTurn` を必ず適用する。
4. AI 応答は `parseCandidate` で null canonicalization と runtime shape validation を通り、constraint-source resolution、`validateInterpretedCandidates` の grounding・値域・競合検査へ進む。
5. accepted command と accepted-with-confirmation command は `applyWeeklyPlanningCommands` に渡され、`finalizeState`、draft request、preview candidate の生成へ進む。
6. preview は controller の turn identity を満たす場合だけ commit され、最終 Plan 保存は別の approval 境界を通る。ただし intake state に誤った hard constraint や exam scope が入ると、その後の preview と承認対象自体が誤る。
7. interpreter が throw した場合は previous state を起点に deterministic + legacy fallback を実行する。controller/executor の外側で失敗した場合も stale pending turn は commit されない。

## 実行したテスト・再現

- 監査開始時に `git status -sb`、`git rev-parse HEAD`、`git diff --stat origin/main...HEAD`、`git diff --name-status origin/main...HEAD`、`git diff origin/main...HEAD` を確認。開始時は clean、HEAD は指定値と一致した。
- 一時 Vitest で実 pipeline を通す 3 反例を実行し、3/3 が「現在の不正受理」を再現した。
  - `23時から7時まで寝ます` に AI が `sleep / 07:00 / 23:00` を返すと `interpreterDiagnostics.accepted` に入り、その逆転値が `state.constraints` に適用された。
  - 同じ入力に AI が `sleep / 23:30 / 07:45` を返しても accepted となり、ユーザーが述べていない分精度が state に適用された。
  - rules の実 pipeline に `来週は数学を1科目勉強する計画を立てたいです` を渡すと、`examPrepScope={ fields: [], totalFields: 1 }`、`tasks=[]`、`draftRequest=null`、`draftCandidates=null` となった。
- 一時テスト削除後、既存の以下 5 ファイルを実行: 5 files / 136 tests passed。
  - `weeklyPlanningCandidateValidator.test.ts`
  - `weeklyPlanningAdversarialInput.test.ts`
  - `weeklyPlanningSevenAuditContract.test.ts`
  - `weeklyPlanningIntakePipeline.test.ts`
  - `weeklyPlanningAiInterpreter.test.ts`
- `npm run build`: TypeScript `--noEmit` と production build が成功。既存の chunk size / dynamic import 警告のみ。
- lint script は `package.json` に存在しない。
- 一時ファイルは削除済み。UNC 上で `apply_patch` が既存ファイル読取を一貫して `E_ACCESSDENIED` にしたため、複数回の失敗確認後、作成した正確な 2 ファイルだけを単一ファイル指定で削除した。

## BLOCKER

該当なし。

## MAJOR

### MAJOR-1: life-constraint grounding が時刻の役割と分精度を保持せず、明示入力と矛盾する hard constraint を受理する

- 対象ファイル・関数・行:
  - `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts:234-270` — `normalizedTextContainsValue` / `lifeConstraintPayloadGrounded`
  - 同 `:338-461` — `validateCommandGrounding` の life-constraint 分岐
  - 同 `:633-640` — `validateValueRange` の `update_life_constraint` 分岐
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts:584-622` — validation 後の command 適用
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts:350-357` — constraint の state 適用
- 再現条件:
  1. ユーザー入力を `23時から7時まで寝ます` とする。
  2. AI candidate を `update_life_constraint(kind=sleep, start=07:00, end=23:00, hardness=hard, confidence=high)` とする。あるいは `start=23:30, end=07:45` とする。
  3. `runWeeklyPlanningIntakePipelineWithInterpreter` の通常入口を通す。
- 現在挙動: どちらも candidate が accepted となり、そのまま `state.constraints` へ適用される。
- 期待挙動: `23時から7時まで` は start=`23:00`、end=`07:00` だけに grounding されるべきで、開始・終了の逆転や、入力にない 30/45 分は拒否されるべきである。
- 影響: AI の単純な endpoint 取り違えや分の幻覚が hard sleep constraint として確定し、利用可能時間、preview、最終的にユーザーが承認する計画時刻を大きく歪める。誤値は suggestion として隔離されず intake state に入る。
- 原因:
  - `lifeConstraintPayloadGrounded` は start と end が文字列中のどこかに個別に存在することしか見ず、「から」の左辺・「まで」の右辺という役割を照合しない。
  - `normalizedTextContainsValue` の日本語時刻 regex は、出力が `23:30` でも `(?:30分)?` を optional にするため、入力の裸の `23時` だけで一致する。
  - value-range validation は各 HH:MM の形式だけを検査し、source semantics を補完しない。
- 既存テストで未検出の理由: 追加されたテストは正しい `23:00/07:00` の受理、入力に存在しない `22:00` の拒否、別 kind の拒否を確認するが、同じ二つの時刻を start/end で交換する反例と、同じ hour に未提示 minutes を付加する反例を含まない。したがって token-presence 型 grounding の穴を通過する。
- 重要度理由: 明示された生活制約と正反対の hard constraint が実入口から state へ無確認で入り、生成予定を直接変える実害ある契約違反である。一方、repository への直接無承認保存ではなく最終 approval は残るため BLOCKER ではなく MAJOR とした。

### MAJOR-2: deterministic exam-scope regex が一般的な「1科目」を院試 scope と誤解釈し、AI より先に通常学習 goal を失わせる

- 対象ファイル・関数・行:
  - `src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts:947-980` — `extractInlineExamFields`
  - 同 `:1005-1011` — `parseTotalFields`
  - 同 `:1039-1080` — `mergeExamPrepScope`
  - 同 `:1083-1107` — `hasExamScopeSignal` / `parseSetExamScopeCommand`
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts:408-439` — exam scope 適用時の missing 更新
  - 同 `:577-628` および `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts:540-550` — AI 前の deterministic 適用
  - `src/features/weeklyPlanning/weeklyPlanningTurnExecutor.ts:82-95` — `examPrepScope` の存在だけで exam dialogue を選択
- 再現条件: rules の通常 pipeline に `来週は数学を1科目勉強する計画を立てたいです` を入力する。AI 経路でも deterministic prepared state は同じ処理を AI 呼出し前に通る。
- 現在挙動: 「院試」「過去問」「分野」の記載がないのに `1科目` だけで exam-scope signal となる。field extraction は空のまま、`examPrepScope={fields:[], totalFields:1}` が作られ、reducer は `tasks_or_goals` を除去する。実再現では tasks が空、draft request/candidates が null になった。AI 経路では後続 AI が task を補っても `examPrepScope` が残り、exam dialogue / exam draft 側へ誤ルーティングされる。
- 期待挙動: 数量付きの一般語「科目」だけでは entrance-exam scope を確定しない。院試・過去問・明示的な exam field 文脈、既存 exam scope、またはその slot への短答がある場合だけ deterministic command にし、それ以外は AI semantic interpreter または通常 task parser に委ねるべきである。
- 影響: MVP の一般的な自然言語学習計画が通常 task として扱われず、goal 消失、質問 flow の誤り、preview 不生成につながる。rules/AI の双方に共通する前処理なので provider を変えても回避できない。
- 原因: PR で `parseTotalFields` と `hasExamScopeSignal` が `([数値])科目` を単独の exam signal として追加した一方、exam 文脈 guard がない。さらに空 fields + totalFields の scope を有効とし、exam-scope command 適用時に learning scope missing を無条件で解消する。
- 既存テストで未検出の理由: scope parser の追加ケースは院試・過去問・訂正・一科目としての複合 field という正方向を中心にし、「科目」を通常の教科数として使う非 exam 発話を通していない。
- 重要度理由: 一般的で明示的な非 exam 学習 request が provider 非依存で誤分類され、計画作成を完了できない core MVP 回帰である。データ破壊や認可 bypass ではないため MAJOR とした。

## MINOR

該当なし。

## 誤検知として除外した候補・漏れ確認

- `3時間です` に AI が 30 分を返すケース: `explicitMinuteValues` は 180 分を抽出し、30 分を `ungrounded-unit-rate` として拒否する。問題なし。
- `OSをネットワークより先にします` に逆順 `[ネットワーク, OS]` を返すケース: exact phrase では先頭 field grounding が成立せず拒否する。問題なし。ただし一般的な token-presence 方式を安全とみなしたわけではなく、採用阻害となる実証済み反例は MAJOR-1 に限定した。
- `23時から7時まで寝ます` を meal/bath 等として返す exact ケース: kind keyword grounding が成立せず拒否する。問題なし。
- 正しい `sleep / 23:00 / 07:00`: 受理する。`23時` と `23:00` の正方向対応自体は動く。ただし minute regex が過剰に optional であるため、正方向成功だけでは MAJOR-1 を防げない。
- 同じ sleep 入力に `22:00` を返すケース: 22 時の evidence がなく拒否する。問題なし。
- 曖昧な clock expression: numeric hour のない曖昧語を explicit HH:MM として確定する追加経路は確認しなかった。deterministic sleep range は明示 numeric range を要求し、`夜に風呂` は exact start 生成から除外される。
- provider throw: previous state を起点に deterministic + legacy fallback へ移り、untrusted AI command は適用されない。controller の pending identity guard も stale commit を防ぐため、state 破壊の指摘から除外した。
- malformed/empty AI content: command は適用されず prepared deterministic state に留まる。応答品質低下はあり得るが、今回の重要度基準で実害ある意味逸脱の採用とは認定しなかった。
- AI renderer: slot 契約、禁止概念、意味逸脱時の deterministic fallback を確認し、保存 state を AI 文面から復元・変更する経路は認めなかった。
- redaction: AI candidate の `sourceUserText` は validation 用に non-enumerable で保持され、reference resolution でも descriptor が保持されるが、redacted 値を command payload に復元する処理ではない。関連経路で危険値の復元は確認しなかった。

## 監査完了時 git status

`## agent/fix-weekly-planning-trace-and-dialogue-final...origin/agent/fix-weekly-planning-trace-and-dialogue-final`

作業ツリーは clean。一時テスト・probe・repo 内一時報告は存在しない。本体コード、Git index、commit、branch、remote には変更を加えていない。
