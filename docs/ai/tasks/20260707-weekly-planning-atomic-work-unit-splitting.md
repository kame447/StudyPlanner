# 意味のある作業単位(1年度分・1回分)の atomic / splittable 分割方針

「1年度分の過去問に3時間かかる」という unit rate 由来の work item が、総学習時間と同じように session chunking で自動分割(180分 → 120+60 など)されている。「合計10時間」のような総量は分割可能でよいが、「1年度分」「1回分」など**意味のある作業単位は原則一まとまりで扱う**か、分割可否をユーザーに確認したい。

本mdの範囲外へ進まない。git add / commit / push はしない。

## 確定している事実

コード確認済み:

- `WeeklyPlanningRemainingWorkItem` は `field / year / estimatedMinutes / unit / source` を持つが、**分割可否(atomic/splittable)の属性を持たない**。
- generator(`weeklyDraftCandidateGenerator`)は各 work item の `estimatedMinutes` を無条件に `splitDurationIntoSessionChunks` にかける。180分は `maxSessionMinutes`(既定120)を超えるため 120+60 等に分割される。
- session chunking は「与えられた総量を分割する」責務に閉じており、分割可否を判断する情報を持たない。unit model(`year_field_chunk` 等の `StudyScopeUnit`)は intake 側にあるが、work item / generator には分割方針として伝わっていない。

つまり **atomic/splittable の方針を持つべき層(work item)にその属性がなく、分割を実行する層(chunking)が一律分割している**のが原因。

## 実装範囲

- `WeeklyPlanningRemainingWorkItem` に分割方針(例: `splitPolicy: 'atomic' | 'splittable'`)を追加する。`year_field_chunk` のように「1年度分」を表す unit は atomic を既定にする。総量指定(`minutes` 等の集約 unit)は splittable。判定は unit model / source から決定的に導く(unit → splitPolicy の写像を1箇所に持つ)。
- generator が work item を配置する際、`atomic` の work item は `splitDurationIntoSessionChunks` にかけず、estimatedMinutes をそのまま1ブロックとして配置する(ただし `maxSessionMinutes` を超える atomic ブロックが計画ウィンドウ/空き枠に入らない場合の扱い — 未配置として diagnostics に出す — を定義する)。
- 「分割可否をユーザーに確認する」対話は本タスクに含めない。**本タスクは atomic を既定として一まとまり配置する決定的挙動で自己完結する**(確認対話に依存しない)。分割方針の確認対話は `staged-dialogue-known-info` が所有する(下記・責任の所在)。

### 分割確認対話の責任の所在(依存の整理)

本タスクは確認対話なしで完結する: 意味単位は atomic を既定とし、配置不能なら unscheduled として diagnostics に出す。これで「勝手に分割される」問題は解消する。

そのうえで「配置不能時に分割許可をユーザーに確認する」「最初に分割方針を聞く」という**確認対話は将来の上乗せであり、`staged-dialogue-known-info` の質問計画が所有する**(そちらの md に明示追加済み)。本タスク完了後、質問計画側が atomic work item の diagnostics(配置不能)を入力として分割許可を尋ねられる。責任が宙に浮かないよう、本タスクは「atomic 既定+diagnostics」、確認対話は「staged-dialogue-known-info」と分担する。

## 回帰テスト

- 180分・`year_field_chunk`・`atomic` の work item が単一 120分超ブロックとして扱われ、勝手に 120+60 等へ分割されないこと(配置可否は空き枠次第。分割されないことを固定する)。
- 総量 unit(splittable)の work item は従来どおり session chunking で分割されること(既存挙動の不変)。
- atomic ブロックが空き枠に入らない場合、unscheduled として diagnostics に出ること。
- 既存の generator / session chunking テストが期待値変更なしで green。

## 完了条件

- work item が分割方針を持ち、atomic な意味単位が一まとまりで配置される。
- unit → splitPolicy の写像が1箇所に集約され、決定的にテストされている。
- 既存テスト全 green、build 成功。

## 触らない範囲

- 分割可否/分割許可のユーザー確認対話(`staged-dialogue-known-info` が所有。本タスクは diagnostics を出すところまで)。
- session chunking のスコアリング/候補生成ロジック本体(atomic はそこへ渡さないだけ)。
- capacity 配分(6等分・上限)は R8 領域。
- unit rate parser、AI interpreter、UI。
- `StudyScopeUnit` の enum 追加(既存 unit の写像で足りるはず。新 unit が必要と判明したら停止して報告)。

## 停止条件

- atomic ブロックが `maxSessionMinutes` 超で「常に未配置」になり、capacity/枠設計の変更なしに実用挙動にできないと判明したとき(diagnostics 化まで実装し、配置改善は R8 へ回して報告)。
- 変更が work item / generator と対応テストの外へ波及するとき。
- 説明できない新規テスト失敗が出たとき。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/scheduling/weeklyDraftCandidateGenerator.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/scheduling/sessionChunking.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```
