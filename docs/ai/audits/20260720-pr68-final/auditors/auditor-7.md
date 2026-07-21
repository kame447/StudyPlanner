# StudyPlanner PR #68 採用前独立監査（監査人7: テスト品質・PR全体）

## 監査対象HEAD

- ブランチ: `agent/fix-weekly-planning-trace-and-dialogue-final`
- HEAD: `23d7676370b3efebc8d1465dfd01abc32c6462ca`
- 比較元: `origin/main`
- 開始時状態: `## agent/fix-weekly-planning-trace-and-dialogue-final...origin/agent/fix-weekly-planning-trace-and-dialogue-final`（未コミット変更なし）

## 担当領域

- 変更・追加されたテストの期待値、負方向契約、mockで隠れる境界、integration不足
- controller / rules / persistence / approval / trace Firestore 経路
- build/test設定、PRスコープ、文書と実装の一致、保守性
- 指定された取りこぼし候補（数値・優先順・生活制約種別・時刻・readiness・対話遅延・modal/selectedDate競合・trace不変条件）

## 調査した主要ファイル

- `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningMissingStatus.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.ts`
- `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`
- `src/features/weeklyPlanning/pipeline/weeklyPlanningRenderedQuestionContext.ts`
- `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts`
- `src/features/weeklyPlanning/weeklyPlanningTurnController.ts`
- `src/features/weeklyPlanning/weeklyPlanningTurnExecutor.ts`
- `src/features/weeklyPlanning/application/useWeeklyPlanningApplication.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.ts`
- `src/features/weeklyPlanning/planning/weeklyPlanningInterruptibleApproval.ts`
- `src/features/weeklyPlanning/useWeeklyPlanningState.ts`
- `src/features/weeklyPlanning/weeklyPlanningStorage.ts`
- `src/components/NaturalLanguageAssistant.tsx`
- `src/components/QuickEntryModal.tsx`
- `src/components/WeeklyPlanningQuickEntryModal.tsx`
- `workers/ai-proxy/src/weeklyPlanningTraceApi.ts`
- `workers/ai-proxy/src/weeklyPlanningTraceFirestore.ts`
- `workers/ai-proxy/src/weeklyPlanningTracePrivacy.ts`
- PRで追加・変更された週間計画・approval・traceテスト群、および2件の追加設計文書

## 追跡した制御フロー

1. `NaturalLanguageAssistant.handleCreateWeeklyDrafts` → `useWeeklyPlanningApplication.submitTurn` → `submitWeeklyPlanningControlledTurn` → `executeWeeklyPlanningTurn` → AI/rules intake pipeline → candidate validation → intake reducer → dialogue renderer → preview commit。
2. preview昇格 → `approveWeeklyPlanningDraftBlocks` → approval guard → interruptible approval → `saveWeeklyApprovedPlan` → operation ledger → `complete_approval`。
3. modal unmount/remountと、selectedDateによる週scope変更 → App所有state / stale pending guard / storage再読込。
4. trace `/append` → privacy shape・structural ID検証 → immutable entry書込み → session metadata PATCH → Firestore maximum transform、ならびにadmin read時のredaction後structural ID復元。

## 実行したテストまたは再現

- `AGENTS.md`全文、`git status -sb`、`git rev-parse HEAD`、`git diff --stat origin/main...HEAD`、`git diff --name-status origin/main...HEAD`、`git diff origin/main...HEAD`を開始前に確認した。
- 一時Vitest `auditor7TemporaryTimeGrounding.test.ts` を作成し、`23時から7時まで寝ます`に対する `start: 23:30` の拒否を期待した。実行環境のWSL Nodeが `v12.22.9`で、Vitest起動時に `ERR_UNKNOWN_BUILTIN_MODULE: node:fs/promises`となり、test collection前に失敗した。一時ファイルは削除済み。
- 同じ実装分岐を副作用のないNode式で直接評価した結果: `{"23:00":true,"22:00":false,"23:30":true}`。したがって正方向 `23:00` と負方向 `22:00` は期待どおりだが、未明示の30分を加えた `23:30` も誤ってgroundedになることを再現した。
- 全suite/buildは本監査では重複実行していない。上記Node互換性のため、既存focused Vitestも独立再実行していない。

## BLOCKER

なし。

## MAJOR

### 1. 「23時」を `23:30` に変えたAI生活制約がgroundedとして受理される

- 対象ファイル・関数/行:
  - `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts:234-243` `normalizedTextContainsValue`
  - 同 `:257-270` `lifeConstraintPayloadGrounded`
  - 同 `:458-461` `validateCommandGrounding` の `update_life_constraint`
  - 受理後の適用: `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts:589-620`、`src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts:350-357`
- 再現条件: ユーザー発話を `23時から7時まで寝ます`、AI候補を `update_life_constraint(kind=sleep, start=23:30, end=07:00, hardness=hard, confidence=high)` として `validateInterpretedCandidates` に渡す。
- 現在挙動: `normalizedTextContainsValue` が `23時` に対して `${hour}時(?:${minute}分)?` を使い、分グループ全体を任意にする。値が `23:30` でも `23時` の部分だけでmatchするため候補が `accepted` に入り、pipelineがそのままreducerへ渡して睡眠制約を23:30開始として保存する。
- 期待挙動: 分を省略した日本語の `23時` は `23:00` にだけ一致し、`23:30` は `ungrounded-life-constraint` として拒否する。`23時30分` または `23:30` が明示された場合のみ `23:30` を受理する。
- 影響: 明示された睡眠開始時刻を30分ずらし、利用可能時間と生成previewを誤らせる。PRが復元しようとしている「AI commandの明示値grounding」境界をすり抜け、ユーザー入力と異なる制約が通常の高confidence値として状態へ入る。
- 原因: 日本語の「時」表記を `HH:00` と同一視するための分省略対応が、structured value側の分が00かどうかを条件にせず常にoptionalになっている。
- 既存テストで未検出の理由: `weeklyPlanningAdversarialInput.test.ts:169-194` は `23時` ↔ `23:00` の正方向だけ、同 `:257-269` は `23時` ↔ `22:00` の時差だけを確認する。時は同じで分だけ捏造する `23:30` がないため、狭い正負ペアは通っても一般契約が成立していない。設計文書の「日本語の23時と23:00のgroundingを検証した」という記録も、この隣接反例を覆わない。
- 重要度理由: 将来改善や文言の好みではなく、明示値をAIが変更しないための採用境界の機能不良であり、その誤値が実際のintake stateとpreview計算へ到達するためMAJOR。

## MINOR

なし。

## 誤検知として除外した候補

- `3時間です` に対する30分: `explicitMinuteValues`が180分を抽出し、30分commandは一致せず拒否される。追加adversarial testもこの負方向を持つ。
- 明示された分野優先順の逆転: `priorityHeadGrounded`と既知分野検証により、`OSをネットワークより先に`を逆順commandにした場合は拒否される。追加table testも逆順を検証する。
- sleep発話をmeal等へ変える候補: `lifeConstraintKindGrounded`が発話または直前sleep質問にkindをgroundし、sleep発話のmeal化を拒否する。
- `year_field_chunk`以外のunit rateによるreadiness: `hasConfirmedYearFieldUnitRate`がunitまで検査し、`finalizeState`とconfirmed slot判定の双方で別unitを充足扱いしない。draft requestがnullになるintegration寄りのテストも追加されている。
- 同じ質問の不要反復・受理内容の一ターン遅れ: rendererはcurrent/previous state差分と最新source turnでaccepted factsを作り、変更されたpriorityだけを当該turnでacknowledgeするテスト、および旧scope文字列が短答に含まれても再acknowledgeしないテストがある。実装経路上の逆転は見つからなかった。
- preview生成中のmodal close: pending処理とplanning stateはmodal子ではなくApp側hook/controllerが所有し、commit前にpending identityを再照合する。既存lifecycle testもchild unmount中の結果commitとremount後preview復元を対象にしている。
- 保存途中のselectedDate変更: 週scope変更でstate refが切り替わると `shouldContinue` / `ownsPendingApproval` がfalseになり、旧週結果を新週stateへcommitしない。進行中の1件保存が完了した場合もoperation ledgerへ結果を残し、再開時はsaved itemをskipする。storageはpendingTurn/pendingApprovalを永続化・復元しないため旧週が永久busyにもならない。
- traceのentryCount後退: session conflictで明白な後退を拒否し、書込み時はmetadata PATCHからentryCountを除外した後、Firestore `maximum` transformで単調増加させる。
- trace structural ID/redaction境界: write境界でsession/conversation/entry ID形式と相互対応を検証し、admin出力では一般値をredact後、安全なstructural IDだけ原値へ戻す。Firestore decode時もdocument path IDがfield内のredacted/偽IDを上書きする。
- trace複数entry appendの途中失敗: entry単位の書込みは順次でbatch transactionではないが、各entryはdeterministic IDのcreate-onlyかつ同一retryを許し、session countは最後にmaximum更新されるためretryで収束する。batch原子性を要求する仕様は確認できず、将来の堅牢化候補に留め、BLOCKER/MAJORにはしなかった。
- test fixtureからの `examType: 院試` 削除: 対応するfree text自体が院試を明示しておらず、今回追加されたgrounding境界に合わせて未根拠分類を除いた変更で、期待値弱体化とは判定しなかった。
- build/CI: `package.json`の既存 `test:run` と `build` は変更されず、新規テストは標準Vitest探索下にある。lint scriptは元から存在せず、本PRによるCI除外・test skip・一時workflow追加は差分にない。

## 監査完了時のgit status

- 最終確認予定: 一時テスト不存在、および `git status -sb` clean。
- 本体コードは変更していない。Git write操作は実施していない。
