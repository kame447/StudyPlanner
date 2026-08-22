# [Goal] branch B が tasks を埋めたとき tasks_or_goals missing を解消する(小)

このmdは小さい4フェーズ構成の goal 用タスクmdである。**本mdに書かれた範囲を超えないこと。** 対象外の問題を見つけた場合は、修正・調査をせず「発見事項」として報告するだけにする。

## 背景

fallback semantics goal で、legacy fallback の現状固定テスト追加と `weeklyPlanningLegacyFallback.ts` の挙動変更ゼロの薄化(branch A / branch B の named 関数分割)まで完了した。

その過程で固定された現挙動に、次の不整合がある: **branch B(revision merge fallback)が tasks を埋めても、`missing` に `tasks_or_goals` が残る。** 代表例は pipeline 経由の初回 setup-command turn(planning range + 複数 duration)で、tasks が2件埋まるのに `missing` に `tasks_or_goals` が残り、status が `needs_scope` になり、dialogue も tasks を再度尋ねる。この不整合を intended behavior 変更として解消する。

あわせて、採用前レビューで発見された separator 破損(`join('、')` が `join('?')` に化けていた。手動修正済み)の再発防止 regression を追加する。既存テストは `previousState.sourceTurns` が1要素のケースしかなく、join の区切り文字が使われないため、この種の破損を検出できない。

**このmdでは初回/継続ターン意味論全体には踏み込まない。** 対象は「branch B が tasks を埋めた場合に `tasks_or_goals` missing を除去する」ことだけである。

## 対象ファイル

原則として次の3ファイルに限定する。

- `src/features/weeklyPlanning/intake/weeklyPlanningLegacyFallback.ts`(Phase 3 の最小実装)
- `src/features/weeklyPlanning/__tests__/weeklyPlanningLegacyFallback.test.ts`(reducer 直呼び系のテスト)
- `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`(pipeline 経由系のテスト)

必要性が明確な場合のみ、`intake/weeklyPlanningMissingStatus.ts`(`removeMissing` の import 元として参照するだけなら変更不要のはず)や `testFixtures/` の追加(既存値の変更は不可)を候補に入れてよい。**これらの変更が必要になり、かつ範囲が広がる場合は停止条件とする。**

## フェーズ構成

### Phase 1: 現状確認(調査のみ)

1. `tasks_or_goals` 不整合を固定している既存テストを特定する。少なくとも:
   - `pipeline/weeklyPlanningIntakePipeline.test.ts` の「legacy fallback keeps tasks_or_goals missing after branch B fills first-turn setup tasks」(missing / status `needs_scope` / decision requiredFields を固定)
   - 他に `tasks_or_goals` の残存を期待値にしているテストがないか grep で確認する(reducer 直呼び側の branch B 系は missing に `tasks_or_goals` を含まない state から始まるはずだが、実コードで確認する)。
2. sourceTurns 2要素以上で branch B を発火させる separator regression が存在しないことを確認する。
3. Phase 2 で「期待値を変更するテスト」と「新規追加するテスト」の一覧を確定して報告する。production code・テストは変更しない。

### Phase 2: intended behavior test と separator regression の追加(テストのみ)

1. **intended behavior test**: branch B が tasks を埋めた場合に `missing` から `tasks_or_goals` が**除去される**期待値を書く。上記 pipeline テストの期待値変更(テスト名も「keeps」から実態に合う名前へ変更してよい)、または新規テスト追加で表現する。missing から `tasks_or_goals` が消えることに伴う `status` / `decision` の変化は、`weeklyPlanningMissingStatus.ts` の resolveStatus 規則から導いて期待値にする(例: 他の missing が残る場合は `needs_life_constraints` 等になるはず。最終値は Phase 3 実装後の観察で確定してよい)。
2. **この時点で対象テストが red であることを確認して報告する**(intended behavior が現挙動と異なることの証明)。
3. **separator regression**: `previousState.sourceTurns` が**2要素以上**の weekly state(examPrepScope なし、各要素にタスク表現を含める。例: `['来週、英語を3時間', '数学を2時間']`)を手組みし、3ターン目の revision を与えて branch B を発火させ、**過去2ターンの両方のタスクが merge 結果に現れる**ことを固定する。これは過去ターンが読点「、」で結合されて初めて成立する挙動であり、`join('?')` のような破損を red にすることが目的。
4. separator regression は現挙動で green になるはず(separator は修正済みのため)。green を確認する。

### Phase 3: 最小実装

- `weeklyPlanningLegacyFallback.ts` の `applyRevisionMergeFallback` で、**tasks を置換して返すパスに限り** `missing` から `tasks_or_goals` を除去する(`removeMissing(params.state.missing, ['tasks_or_goals'])` 相当。import は既存の `weeklyPlanningMissingStatus.ts` から)。
- **触らないこと**: branch B の発火条件(`shouldApplyRevisionMergeFallback`)、tasks の作り方(`toPlanningTasks` / merge 内容)、`sourceTurns` の積み上げ、branch A(`applyFirstAssessFallback`)、pipeline の初回 truthiness、draftRequest、looksLike 条件。
- Phase 2 の intended behavior test が green になり、それ以外の既存テストの期待値変更が Phase 1 で特定した一覧の範囲に収まっていることを確認する。

### Phase 4: 検証して停止

以下を実行し、既知の `scheduling/placementScoring.test.ts` 1件以外に新規失敗がないことを確認して停止する。追加の改善には進まない。

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningLegacyFallback.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check
git diff --stat
git status -sb
```

## 各フェーズの受け入れ条件

- **Phase 1**: 期待値変更対象テストと新規追加テストの一覧が報告されている。`git diff` が空のまま。
- **Phase 2**: intended behavior test が追加/変更され **red が確認・報告**されている。separator regression が追加され green。既存テストのうち一覧外の期待値は変更されていない。
- **Phase 3**: 実装は `applyRevisionMergeFallback` の tasks 置換パスへの missing 除去のみ。intended behavior test が green。branch A・発火条件・merge 内容・sourceTurns に diff がない。
- **Phase 4**: 上記コマンドがすべて実行・報告され、既知1件以外の失敗がない。そこで停止している。

## 触らない範囲

- UI / CSS、`scheduling/`(placement scoring・availability・draft 生成)、`preview/`、`dialogue/` の実装、保存・承認導線、通常予定導線。
- `weeklyPlanningTransforms.ts` の仕様変更(`assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision` / `looksLikeWeeklyPlanningRequest`)。
- `pipeline/weeklyPlanningIntakePipeline.ts` の `previousState ?? createInitialPlanningIntakeState()` の変更。
- **初回/継続ターン意味論の実装、`isFirstTurn` 導入、reducer 直呼びとの差分解消、branch B の発火条件変更、looksLike 条件変更** — Stage 4 相当の意味論整理は別作業として残す(調査も進めない)。
- branch A の挙動(branch A 側の missing 調整はこのmdの対象外。気づきがあれば発見事項へ)。
- `scheduling/placementScoring.test.ts` の既知失敗1件。

## 停止条件

- Phase 3 の実装が `applyRevisionMergeFallback` の tasks 置換パス以外に波及しそうなとき。
- `weeklyPlanningMissingStatus.ts` 本体や fixture の**変更**(import 参照を超える変更)が必要になったとき。
- 期待値変更が必要な既存テストが Phase 1 の一覧より大きく広がったとき(例: roleplay / edge cases の広範な変更が必要になった場合)。
- 「触らない範囲」に関わる変更・調査が必要に見えたとき(発見事項として報告し、進めない)。
- placementScoring の既知1件以外の説明できない失敗が出たとき。

## テスト観点

- intended behavior test は「branch B が tasks を埋めた場合に `tasks_or_goals` が missing に残らない」ことを、pipeline 経由(初回 setup-command turn)で必ず1件固定する。reducer 直呼び側で同じ意図を固定できるケースがあれば追加してよい(小さく)。
- separator regression は sourceTurns 2要素以上・3ターン目 revision で、**両方の過去ターン由来タスクが merge 結果に含まれる**ことをアサートする。可能なら、テスト作成時に separator をローカルで一時的に別文字へ変えて red になることを確認し、**確認後は必ず元に戻して diff に残さない**(検出力の確認。困難なら省略し、その旨を報告)。
- スナップショットは使わない。日本語は生の文字列で書く(`\uXXXX` エスケープ禁止)。**日本語リテラルを書き換えた行は、意図した文字になっているか(特に「、」)を diff で目視確認する。**
- test / build は Node 22 系で実行する(Phase 4 のコマンド形式を使う)。

## Codexへの実装指示

1. Phase 1 → 2 → 3 → 4 の順に進め、Phase をまたいで変更を混ぜない。**Phase 2 の red 確認より先に production code を触らない。**
2. Phase 3 は本mdに書いた最小実装のみ。差分が `applyRevisionMergeFallback` の missing 除去(+import 1行)を超えたら停止して報告する。
3. 期待値のうち status / decision の最終値は、実装後の観察で確定してよいが、「`tasks_or_goals` が missing に残らない」ことは観察に依らず intended として先に書く。
4. 不自然な挙動・対象外の気づき(branch A 側の missing、意味論の差分など)は修正せず発見事項として報告する。
5. git add / commit / push はしない。コミットはユーザー指示後に行う。
6. `docs/ai/codex-task-guide.md` に従う。
