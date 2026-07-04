# 短答 slot filling: 目安時間を聞いた直後の「3時間です」を受理する

R2 初期(実使用フィードバック対応)の最初のタスク。roadmap `docs/ai/strategy/weekly-planning-roadmap.md` §3「Phase R2 初期」の先行小タスク1に対応する。

**本mdに書かれた範囲を超えないこと。** 対象外の問題(total duration の無視、daily target、エラー分類、文言、年度範囲など)は R2 初期の別タスクであり、修正・調査せず発見事項として報告する。

## 背景

実ユーザーの利用で次の挙動が確認された。

```text
アプリ: 週間計画に必要な情報がまだ足りません。次に 1年分または1単位あたりの目安時間 を教えてください。
ユーザー: 3時間です
アプリ: 週間計画に必要な情報がまだ足りません。次に 1年分または1単位あたりの目安時間 を教えてください。
```

原因は実コードで確認済み: `parseUnitRate`(`intake/weeklyPlanningUnitRateParsing.ts`)は「1分野の1年分◯時間」の明示形か、`unitModel === 'year_field_chunk'` のときの「(1)年分◯時間」文脈形しかマッチせず、裸の時間回答(「3時間です」「3時間」「3時間くらい」)を受理する経路がない。intake は「直前に何を聞いたか」を parse に使っておらず、同じ質問が繰り返される。

なお「直前に目安時間を聞いた」ことは、会話ログを持たなくても **state から判定できる**: `missing` に `unit_duration_estimate` が含まれる(= status `needs_unit_rate` で質問が出ている)状態がそれである。

## 目的

`missing` に `unit_duration_estimate` が含まれる状態に限り、裸の時間回答を目安時間(`set_unit_rate` command)として受理し、同じ質問を繰り返さないようにする。intended behavior 変更であり、red → green の順で進める。

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/intake/weeklyPlanningUnitRateParsing.ts`(裸時間回答の parse 関数追加)
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts`(`parseWeeklyPlanningCommands` 内で、slot が開いているときだけ新 parser を呼ぶ)
- テスト:
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts`(intended behavior test と非ハイジャックの regression)
  - 必要なら `pipeline/weeklyPlanningIntakePipeline.test.ts`(質問が繰り返されないことの pipeline 経由確認)

command 型の追加は不要(既存の `set_unit_rate` を使う)。adapter の変更も不要のはず。これらに変更が必要になったら停止して報告する。

## フェーズ構成

### Phase 1: 現状確認(調査のみ)

1. `parseWeeklyPlanningCommands`(reducer 内)が `state` を持っており、`params.state.missing` を参照できることを確認する。
2. `missing` に `unit_duration_estimate` が入る経路(`set_exam_scope` の `unitModel === 'year_field_chunk' && unitRates.length === 0`、`set_planning_range` 後の流れ)と、除去される経路(`set_unit_rate` apply)を確認する。
3. 既存の unit rate 系テストの位置と期待値を確認する(壊してはいけない regression の把握)。

### Phase 2: intended behavior test の追加(red 確認)

1. roleplay helper 等で `missing` に `unit_duration_estimate` が含まれる状態を作り(例: `applyWeekendRangeAndExamScope()` の後に年度範囲・進捗を与えた状態。既存 helper `applyDetailsTextAfterExamScope` / fixture を再利用してよい)、そこへ「3時間です」を与えるテストを書く。期待値:
   - `unitRates` に `{ unit: 'year_field_chunk', minutesPerUnit: 180, source: 'user' }` 相当が入る。
   - `missing` から `unit_duration_estimate` が消える。
   - `questions` に目安時間の質問(「1つの年度×分野にだいたい何分かかりますか?」)が含まれない(= 同じ質問を繰り返さない)。
2. バリエーション: 「3時間」(です無し)、「3時間くらい」(uncertainty が `medium` になる)も期待値を書く。
3. **非ハイジャックの regression も同時に書く**(これらは現挙動固定であり、実装前後とも green のはず):
   - `missing` に `unit_duration_estimate` が**ない**状態(例: 初期 state)で「3時間です」を与えても `unitRates` に入らない。
   - slot が開いていても、「1年分は3時間」のような既存パターンにマッチする入力は従来どおり既存経路で受理される(期待値変更なし)。
4. この時点で intended behavior test が **red であることを確認して報告する**。

### Phase 3: 最小実装

1. `weeklyPlanningUnitRateParsing.ts` に、裸の時間回答を parse する関数を追加する(例: `parseBareDurationAsUnitRateCommand(text): SetUnitRateCommand | undefined`)。
   - マッチ対象: 「N時間です」「N時間」「N時間くらい/ぐらい/だいたい」程度に絞る(N は算用数字・漢数字。既存の `parseSmallInteger` を再利用)。**入力全体が短答であること**を要求する(segment 内に他の長い文が続く場合はマッチさせない。目安: normalize 後のテキストが時間表現+語尾程度で構成される)。
   - `unit: 'year_field_chunk'`、`minutesPerUnit: N * 60`、`source: 'user'`、`uncertainty` は くらい/ぐらい/だいたい を含むとき `'medium'`(既存 `buildYearFieldUnitRate` の規則に合わせる)。
2. reducer の `parseWeeklyPlanningCommands` で、**`params.state.missing` に `unit_duration_estimate` が含まれるときだけ**新 parser を呼び、結果を `optionalCommands` に加える。既存の `parseSetUnitRateCommand` が command を返した場合はそちらを優先する(両方が返る入力では既存を採用)。
3. 適用は既存の `set_unit_rate` case が行う(変更不要)。missing 除去・質問消滅は既存ロジックで自動的に起きる。
4. Phase 2 の intended test が green になり、既存テストがすべて期待値変更なしで green のままであることを確認する。

### Phase 4: 検証して停止

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check
git diff --stat
git status -sb
```

新規失敗ゼロを確認して停止する。追加の改善には進まない。

## 各フェーズの受け入れ条件

- **Phase 1**: 確認結果が報告され、`git diff` が空のまま。
- **Phase 2**: intended behavior test の red と、非ハイジャック regression の green が確認・報告されている。
- **Phase 3**: 実装が新 parser 関数+reducer の条件付き呼び出しに収まり、intended test が green、既存テストの期待値変更ゼロ。
- **Phase 4**: 全コマンド実行・報告、新規失敗ゼロ、そこで停止。

## 触らない範囲

- **R2 初期の別タスク領域**: total / subject duration の受理(過去問文脈との共存)、daily / weekday / weekend target、情報不足と矛盾の分類分離、応答文言・受理済みサマリ表示、年度範囲「から〜まで」。気づきがあれば発見事項へ。
- `unitModel` の解決規則(`resolveUnitModel`)、`set_exam_scope` / draft request の ready 条件。
- dialogue 層(`weeklyPlanningDialogueManager.ts` / `weeklyPlanningDialogueMessages.ts`)、`weeklyPlanningMissingStatus.ts` の質問文言と resolve 規則(missing 除去で質問が消えるのは既存挙動)。
- legacy fallback、pipeline の truthiness、looksLike 条件、UI、scheduling、保存・承認導線。
- 既存 regression テストの入力・期待値。

## 停止条件

- 実装が新 parser 関数+reducer の条件付き呼び出しの範囲で収まらないと判明したとき(command 型・adapter・missingStatus の変更が必要になった等)。
- 短答マッチの範囲判定(どこまでを「短答」とみなすか)が既存テストと衝突し、期待値変更なしで解けないとき。
- 「触らない範囲」に関わる変更・調査が必要に見えたとき(発見事項として報告し、進めない)。
- 説明できない新規テスト失敗が出たとき。

## テスト観点

- intended: 「3時間です」「3時間」「3時間くらい」の3表現 × slot が開いている状態。minutesPerUnit / uncertainty / missing 除去 / 質問の非繰り返しを固定する。
- 非ハイジャック: slot が閉じている状態では裸時間を受理しない。既存パターン(「1分野の1年分3時間」「1年分は3時間」)の挙動は不変。
- 過剰マッチ防止: 「3時間くらいかかるか分からない」のような長文中の時間表現を短答として受理しない(1ケースでよい。期待値は観察から)。
- スナップショット禁止、日本語は生文字列(`\uXXXX` 禁止)、「、」等のリテラルは diff で目視確認。
- test / build は Node 22 系で実行(Phase 4 の形式)。

## Codexへの実装指示

1. Phase 1 → 2 → 3 → 4 の順。**Phase 2 の red 確認より先に production code を触らない。**
2. 短答マッチは狭く始める(上記3表現+数字ゆれ)。対応表現を広げたくなっても、このタスクでは広げず発見事項に書く。
3. 既存 `parseSetUnitRateCommand` との優先関係(既存が勝つ)を実装とテストの両方で明確にする。
4. 期待値は観察してから書く(intended の missing / questions の最終形も、実装後に観察して確定してよい。ただし「unit_duration_estimate が消える」「質問が繰り返されない」は intended として先に書く)。
5. git add / commit / push はしない。コミットはユーザー指示後に行う。
6. `docs/ai/codex-task-guide.md` に従う。
