# 完了実績ゼロでも draft request を生成できるようにする(最小修正)

> **完了記録(2026-07-07)**
>
> - 実装済み: createWeeklyDraftRequestFromIntakeState から progress.length === 0 を拒否理由にするガードを撤廃済み。!unitRate など他の既存ガードと hasCompletedYears による既存 progress の絞り込み意味論は維持。
> - 回帰テスト済み: 完了実績ゼロの draft_ready state から draft request が生成されること、5 fields x 7 years = 35件の remaining work items が生成されること、全件 estimatedMinutes: 180 であること、既存の完了実績あり roleplay が不変であること、pipeline e2e が cannot_create_draft から先へ進むことを確認済み。
> - 実装時検証: weeklyPlanningDraftRequestAdapter.test.ts 5 passed、weeklyPlanningRemainingWorkItems.test.ts 5 passed、weeklyPlanningIntakePipeline.test.ts 21 passed、src/features/weeklyPlanning 328 passed / 13 skipped / 5 todo、npm run build 成功、git diff --check 成功。
> - 継続対話スモーク(2026-07-07): 既存 pipeline e2e moves zero-progress exam prep past cannot_create_draft を含む matching cases を1コマンドで実行し green(2 passed / 19 skipped)。会話順は range -> exam scope -> yearRange + unitRate -> priority -> life constraints -> noFixedEvents。最終ターン前に exam scope / priority / constraints / unit rate が state に反映される前提の継続対話で、最終ターン後は cannot_create_draft にならず、draft request 生成後の remaining work items / generator / capacity 判定側へ到達した。観察された最終 decision kind は ask_relax_constraints。これは 5 fields x 7 years x 180分 = 105時間が計画ウィンドウに収まらない既知の容量超過挙動と整合する。保存可能な draft の生成成功は本確認の要求ではなく、zero-progress ガードを抜けて後段処理へ進む目的は満たした。
> - 本タスクは完了扱い。capacity 対応、scheduler 変更、generic error 分類分離、range 伝搬は本タスク外として未着手。

継続対話スモークの最終ターンで、すべての必要情報(exam scope・priority・constraints・unit rate)が揃い draft_ready / shouldCreateDraft: true に達したにもかかわらず、cannot_create_draft(「条件の整合性が取れず…」)に落ちる問題の最小修正タスク。

本mdの範囲外へ進まない。対象外の気づきは発見事項として報告する。git add / commit / push はしない。

## 背景(調査で確定済み)

直接原因は intake/weeklyPlanningDraftRequestAdapter.ts の createWeeklyDraftRequestFromIntakeState にあるガード:

const progress = state.progress.filter(hasCompletedYears);
if (progress.length === 0 || !unitRate) return null;

completedYears つきの progress が最低1件ないと draft request を作れない。これは「完了年度の申告がある」exam-prep ロールプレイ由来の暗黙前提で、完了実績ゼロ(まっさらから始める)ユーザーを構造的に弾く。draftRequest が null のため dialogueManager の shouldCreateDraft && !draftRequest 分岐で cannot_create_draft になっていた。

## 実装内容(最小)

- progress.length === 0 を draft request 生成の拒否理由にしない。progress が空 = 完了済み年度なし = 全 field x year が未完了として扱い、draft_ready かつ他の必要条件(missing 0 / yearRange / field_first priority / year_field_chunk unitRate)が揃っていれば draft request を生成する。
- WeeklyPlanningDraftRequest.progress は空配列を許容する(createRemainingWorkItemsFromDraftRequest は completedYears の Map が空なら全 field x year を展開する実装のため、下流の変更は不要の見込み。必要になったら停止して報告)。
- !unitRate など他のガードは変更しない。

## 回帰テスト(red -> green)

1. intended(現行 red): 完了実績ゼロの draft_ready state(exam scope: fields 5件・yearRange 2025〜2019・unitModel year_field_chunk、priority field_first、unitRate 180分、missing 空)から draft request が生成されること(null でないこと)。
2. remaining work items: 上記 request から remaining work items が 5 fields x 7 years = 35件生成されること(全件 estimatedMinutes 180)。
3. 既存不変: 完了実績ありの既存 roleplay(field-scoped completed years の除外を含む)がすべて期待値変更なしで green のままであること。
4. pipeline e2e(観察して固定): 完了ゼロの会話を pipeline 経由で流したとき decision が cannot_create_draft でなくなること。修正後の decision kind は観察して固定する。総量 35 x 180分 = 105時間が計画ウィンドウに入り切らないため、ask_relax_constraints(unscheduled あり)になる見込み。それ自体は正しい分類なので、この段階では観察結果をそのまま固定してよい。

## 対象ファイル候補

- src/features/weeklyPlanning/intake/weeklyPlanningDraftRequestAdapter.ts
- src/features/weeklyPlanning/__tests__/weeklyPlanningDraftRequestAdapter.test.ts
- src/features/weeklyPlanning/__tests__/weeklyPlanningRemainingWorkItems.test.ts
- 必要なら pipeline / foundation テストへの e2e ケース追加

## 触らない範囲 / 停止条件

- generic error の分類分離(adapter の理由つき結果返却、dialogueManager の decision 細分、文言)は別タスク(R2初期-2「情報不足と条件矛盾の分類分離」と一体で扱う)。このタスクでは adapter は従来どおり WeeklyPlanningDraftRequest | null を返す。
- capacity 対応(6等分・上限・入る分だけ提案)は R8 領域。
- state.range と generator の planning window の mismatch は別記録。
- generator / scheduler / dialogueManager / messages / UI / AI interpreter。
- hasCompletedYears による field-scoped 除外ロジック自体の変更。
- 下流(remaining work items / generator)に変更が必要と判明したら停止して報告。

## 検証(Node 22)

- env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningDraftRequestAdapter.test.ts
- env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningRemainingWorkItems.test.ts
- env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
- env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
- git diff --check && git diff --stat && git status -sb
