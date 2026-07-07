# note_no_fixed_events の丁寧形対応(「固定予定はありません」の受理)【完了 2026-07-05】

> **完了記録**: 実装・採用・コミット済み。継続対話スモークで「固定予定はありません。」が受理され、fixed_events の再質問が止まることを確認。

継続対話スモークで、「固定予定はありません。」が `note_no_fixed_events` として受理されず、`fixed_events` の missing が残り続けて同じ質問が繰り返される問題が確認された。丁寧形の語彙カバレッジを直す小タスク。

本mdの範囲外へ進まない。git add / commit / push はしない。

## 背景(調査で確定済み)

`parseNoFixedEventsSourceSegment`(`intake/weeklyPlanningConstraintParsing.ts`)の正規表現は `(?:他の)?固定予定.*ない|(?:他の)?予定.*ない|用事.*ない` で、否定の終止形「ない」しか拾わない。丁寧形の「ありません」には部分文字列「ない」が含まれないため、実会話の「固定予定はありません。」がマッチせず、command が生成されなかった。

## 実装内容

- 正規表現の否定部分を丁寧形・変形に広げる: 「ありません」「無いです」「ないです」を最低限カバーする(例: `(?:ない|ないです|無い|ありません)` 相当。過剰マッチを避けるため、肯定形「あります」「ある」を巻き込まないこと)。
- 対象は `note_no_fixed_events` の判定のみ。他の constraint parser の否定表現には広げない(気づきがあれば発見事項へ)。

## 回帰テスト(red → green)

- intended(現行 red): 「固定予定はありません」「固定予定はないです」「他の予定はありません」が `note_no_fixed_events` command になり、reducer 経由で `fixed_events` missing が除去されること。
- 非マッチ(現行どおり green 維持): 「固定予定があります」「予定が入るかも」「用事がある」が command にならないこと。
- 既存の note_no_fixed_events 系テスト(マッチ4件+非マッチ3件)が期待値変更なしで green。

## 対象ファイル候補

- `src/features/weeklyPlanning/intake/weeklyPlanningConstraintParsing.ts`
- `src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts`

## 触らない範囲 / 停止条件

- reducer / command 型 / adapter(3点セットは既存のまま。parser の正規表現とテストのみ)。
- 他の丁寧形対応(constraint 系全般の語彙拡張は別タスク)。
- 範囲を超えたら停止して報告。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```
