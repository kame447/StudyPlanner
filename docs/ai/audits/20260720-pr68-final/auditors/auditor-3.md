# PR #68 独立監査 3 — intake state / readiness

## 監査対象

- HEAD: `23d7676370b3efebc8d1465dfd01abc32c6462ca`
- branch: `agent/fix-weekly-planning-trace-and-dialogue-final`
- comparison: `origin/main...HEAD`
- 開始時状態: clean（`git status -sb` は branch tracking 行のみ）
- 担当領域: intake state、missing/status、question-slot registry/dependency、canonicalization、confirmed/inferred provenance、pending planning range、unit rate、field/year range、fixed event、life constraint、priority、readiness、preview 生成可否

## 調査した主要ファイル

- `src/features/weeklyPlanning/intake/weeklyPlanningIntakeTypes.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningCommandTypes.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningMissingStatus.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningUnitRateParsing.ts`
- `src/features/weeklyPlanning/intake/weeklyPlanningDraftRequestAdapter.ts`
- `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`
- `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueManager.ts`

## 追跡した制御フロー

`beginWeeklyPlanningUserTurn` → deterministic range/scope/constraint/unit parsing → `applyWeeklyPlanningCommands` → AI interpreter state summary (`confirmedSlotsFromState`) → `validateInterpretedCandidates` → command canonicalization/適用 → `finalizeState`（unit-rate missing、priority missing、status、questions、`shouldCreateDraft`）→ `createWeeklyDraftRequestFromIntakeState` / `createAssumedWeeklyDraftRequest` → scheduler dry-run → dialogue decision / preview。

## 実行したテスト・最小再現

- 監査専用の focused TypeScript harness を一時作成し、Windows Node 20 + TypeScript `transpileModule` で実コードを直接ロードした。exit 0 で次の7反例を assert した。
  1. 開始指定のない「1週間」を現在日時開始の inferred range として確定。
  2. unit-rate 質問への裸の「3」から、3分と180分の両 command が受理。
  3. 3分野の優先順で、`['OS']` の欠落 order と末尾逆転 order の双方が受理。
  4. 「23時30分」を構造化 `23:00` として受理。
  5. 同一発話内の夕食 19:00–20:00 を sleep の時刻として受理。
  6. `buffer` 制約だけで `sleep_cycle` が解消され、`draft_ready` / confirmed draft request へ到達。
  7. hard `unavailable` が fixed event として保存・認識されても `missing: fixed_events` が残る。
- 出力要約: inferred range `2026-07-19T14:37:00`–`2026-07-25T24:00:00`、bare unit rates `[3, 180]` accepted、priority counterexamples accepted、rounded/crossed sleep accepted、buffer status `draft_ready`、unavailable 後も fixed-events missing `true`。
- Vitest の同一 focused file は環境理由で起動不可: WSL の既定 Node は v12.22.9（`node:fs/promises` 非対応）、Windows Node は Linux 用 `node_modules` のため `@rollup/rollup-win32-x64-msvc` 不在。依存関係は変更していない。
- 監査専用2ファイルは終了前に削除済み。

## BLOCKER

該当なし。

## MAJOR

### M1. 開始指定のない「1週間」を deterministic 層が現在時刻開始として確定し、confirmed slot として扱う

- 場所: `weeklyPlanningScopeParsing.ts:810-842` (`parseWeeklyPlanningRange`)、`weeklyPlanningIntakeReducer.ts:441-459` (`set_planning_range`)、`weeklyPlanningIntakePipeline.ts:384-405` (`confirmedSlotsFromState`)
- 再現: `applyDeterministicWeeklyPlanningUserTurn(undefined, '1週間の計画を立てたいです', { selectedDate: '2026-07-19', currentDateTime: '2026-07-19T14:37:00' })`。
- 現在挙動: range は `2026-07-19T14:37:00` 開始、`confidence: inferred` になる一方、`planning_period` / `planning_start_date` missing は消える。次の interpreter summary は confidence を見ず `state.range` の存在だけで `planning_range` を confirmed に入れる。scheduler もこの current-time window を使う。
- 期待挙動: 開始日時が発話にないなら pending/missing のまま質問するか、少なくとも inferred を confirmed と同一扱いせず、仮定としてレビュー可能にする。
- 影響: ユーザーが指定していない開始日・開始時刻で preview が生成され、後続 AI の範囲 command も `confirmed-slot-overwrite` で拒否され得る。
- 原因: `parseWeeklyPlanningRange` が duration-only 入力を現在日時に lower し、reducer と `confirmedSlotsFromState` が provenance/confidence を readiness に反映しない。
- 既存テスト未検出理由: current-time fallback の shape/confidence は許容されているが、「inferred が missing を解消し confirmed slot を占有してはならない」という横断 invariant が検証されていない。
- 重要度理由: silent な期間確定が実際の配置日時を変え、AI 支援はユーザー意図を黙って確定しないという契約に違反するため MAJOR。

### M2. unit-rate の裸の数値に単位 provenance がなく、同じ「3」で3分・180分の双方が受理される

- 場所: `weeklyPlanningCandidateValidator.ts:207-231,358-375` (`explicitNumberValues` / `explicitMinuteValues` / `set_unit_rate` grounding)、`weeklyPlanningIntakeReducer.ts:397-406`、`weeklyPlanningMissingStatus.ts:48-65`
- 再現: 直前質問 `slotKey: unit_rate`、発話 `3`、既知 scope `year_field_chunk` の状態で `minutesPerUnit: 3` と `minutesPerUnit: 180` を別々に validator へ渡すと、両方 `accepted` になる。
- 現在挙動: 直前質問と数字の存在だけで duration evidence とし、明示単位がない場合 `explicitMinuteValues` が空なので command 値との一致検証をスキップする。いずれも正の `year_field_chunk` rate として missing/readiness を解消する。
- 期待挙動: 単位なし短答は確定しない（単位を聞く）か、question contract が明示した単位へ一意に変換し、その一つ以外を拒否する。
- 影響: 60倍の workload 差がそのまま preview、配置可否、残作業量へ伝播する。
- 原因: 「数値がある」ことと「minutesPerUnit の値・単位が grounded」であることを分離していない。
- 既存テスト未検出理由: `3時間です` → 30分拒否のような明示単位ケースは覆うが、単位を省略した短答について複数の構造化値を同じ入力へ当てる反例がない。
- 重要度理由: 値の存在だけで readiness が成立し、主要な見積りを大幅に誤るため MAJOR。

### M3. priority は先頭要素しか grounding せず、対象分野の欠落や後続順の逆転でも readiness を満たす

- 場所: `weeklyPlanningCandidateValidator.ts:277-289,377-393` (`priorityHeadGrounded` / priority grounding)、`weeklyPlanningIntakeReducer.ts:360-369`、`weeklyPlanningDraftRequestAdapter.ts:48-52,64-83`
- 再現: known fields `[OS, ネットワーク, データベース]`、発話「OSから進め、次にネットワーク、最後にデータベースです」に対し、order `[OS]` と `[OS, データベース, ネットワーク]` がともに `accepted`。
- 現在挙動: order の各要素が既知分野であることと先頭 `OS` のみを確認する。全 known field の被覆、発話内の2番目以降の相対順を確認しない。reducer は priority missing を無条件に除去し、draft adapter は non-empty order だけで通す。
- 期待挙動: 明示された対象分野を欠落させず、発話で明示された全相対順と一致した order のみを confirmed priority とする。不完全なら質問を維持する。
- 影響: ユーザーが指定した優先順と異なる順で過去問が配置されるか、残り分野が暗黙順へ落ちる。
- 原因: priority grounding が head-only で、scope coverage / full-order relation を readiness invariant にしていない。
- 既存テスト未検出理由: 2分野の完全逆転は先頭不一致で検出できるが、先頭を保った3分野の末尾逆転と partial order は検証されていない。
- 重要度理由: 学習順序は draft 内容を直接決め、誤った order が confirmed として保存経路まで進むため MAJOR。

### M4. life-constraint の時刻 grounding は精度と clause 対応を検証せず、誤った睡眠時間で sleep slot を解消する

- 場所: `weeklyPlanningCandidateValidator.ts:234-270,291-312,450-461` (`normalizedTextContainsValue` / `lifeConstraintPayloadGrounded` / kind grounding)、`weeklyPlanningIntakeReducer.ts:350-357`
- 再現A: 「睡眠は23時30分から7時までです」に sleep `23:00`–`07:00` を渡すと accepted。
- 再現B: 「睡眠は23時から7時、夕食は19時から20時です」に sleep `19:00`–`20:00` を渡すと accepted。
- 現在挙動: `23:00` 用 regex の分部分が optional なので `23時30分` の `23時` prefix に一致する。また kind keyword と start/end が発話のどこかに別々にあればよく、同じ clause/segment に属することを要求しない。accepted command は sleep missing を除去する。
- 期待挙動: 発話に分が明示されたら分まで一致させ、複数制約があるときは kind と時刻を同じ source segment へ結び付ける。曖昧なら確認へ回す。
- 影響: 実際の就寝時間を30分ずらす、または夕食時間を睡眠時間として扱い、睡眠中に学習予定を配置できる。
- 原因: presence-based grounding で temporal precision と semantic association を保持していない。
- 既存テスト未検出理由: `23時`/`23:00` 正規化、誤 `22:00`、単一 sleep 発話は覆うが、分付き入力と複数 kind/clause の cross-association は覆っていない。
- 重要度理由: hard 生活制約の意味を誤って confirmed にし、配置の安全性を直接損なうため MAJOR。

### M5. `buffer` が睡眠 subtype と同一扱いされ、睡眠情報なしで confirmed draft readiness に到達する

- 場所: `weeklyPlanningIntakeReducer.ts:134-155` (`removeMissingForLifeConstraint`)、`weeklyPlanningMissingStatus.ts:32-45` (`hasConfirmedSleepCycle`)、`weeklyPlanningDraftRequestAdapter.ts:64-98`
- 再現: 他条件を満たし `missing: ['sleep_cycle']` の state に `update_life_constraint(kind: 'buffer', 18:00-18:30)` を適用して finalize すると、missing `[]`、status `draft_ready`、`shouldCreateDraft: true`、confirmed draft request 非 null になる。
- 現在挙動: reducer は `sleep || buffer` で sleep missing を除き、missing helper も同じ定義を使う。draft request には meal と buffer はあるが sleep はない。
- 期待挙動: buffer/休憩は独立 subtype とし、sleep slot は sleep（または睡眠に必要な明示情報）だけで解消する。
- 影響: 睡眠時間未確認のまま confirmed preview を生成し、既定 session policy へ黙って依存する。
- 原因: subtype dependency の誤った同一視。
- 既存テスト未検出理由: AI validator の「睡眠発話を meal として受理しない」境界はあるが、state-level の `buffer => sleep_cycle confirmed` を draft adapter まで横断していない。
- 重要度理由: required life-constraint slot を別概念の値だけで満たし、confirmed readiness を偽陽性にするため MAJOR。

## MINOR

### m1. hard `unavailable` は fixed event と認識されるのに missing が残り、同じ fixed-event 質問を再提示する

- 場所: `weeklyPlanningIntakeReducer.ts:333-349`、`weeklyPlanningMissingStatus.ts:23-29`、`weeklyPlanningDialogueManager.ts:114-135,338-343`
- 再現: `missing: ['fixed_events']` の state に hard `add_unavailable` を適用して finalize。`hasConfirmedFixedEvents(state) === true` だが `state.missing` は `fixed_events` を保持。
- 現在/期待: 現在は stored unavailable を fixed event として draft 側で使いつつ質問を再掲する。hard unavailable を fixed-event 回答として採用する現行定義なら missing も除くべき。採用しないなら helper/draft 分類を統一すべき。
- 影響: 正しい回答後も redundant な質問が続き、confirmed completion に余分な1 turn が必要。
- 原因: `add_fixed_event` hard は missing を除く一方、`add_unavailable` branch は constraints だけ更新する非対称。
- 既存テスト未検出理由: `hasConfirmedFixedEvents` と reducer missing の一貫性を同じ state transition で確認していない。
- 重要度理由: データ破壊ではなく回避可能な会話反復だが、低摩擦入力の UX 契約に反するため MINOR。

## 誤検知として除外した候補

- `year_field_chunk` 以外の正の unit rate だけで院試 readiness が成立する候補: `applyUnitRateMissingState` と `createWeeklyDraftRequestFromIntakeState` が `year_field_chunk` を要求するため除外。
- 明示入力「3時間です」を30分として受理する候補: `explicitMinuteValues` は180分を導出し、30分 command は value mismatch で拒否するため除外（ただし単位なし「3」は M2）。
- 2分野の優先順を完全逆転して受理する候補: 先頭 grounding が拒否するため除外（ただし3分野の tail permutation / partial order は M3）。
- sleep 発話を meal kind として受理する候補: kind keyword grounding が拒否するため除外（ただし複数 clause の時刻取り違えは M4）。
- 「23時」/「23:00」→ sleep `23:00`、および誤 `22:00` の境界: exact hour の正方向と22時の不一致は実装上判別されるため除外（ただし「23時30分」→23:00 は M4）。
- `set_unit_rate` の unit mismatch が一時的に reducer missing を消す候補: `finalizeState` が year-field rate 不在なら missing を再追加するため除外。

## 監査完了時 git status

`## agent/fix-weekly-planning-trace-and-dialogue-final...origin/agent/fix-weekly-planning-trace-and-dialogue-final`

作業ツリーは clean。監査専用一時ファイルは残っていない。Git/GitHub write は実施していない。

