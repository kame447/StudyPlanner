# 生活制約の全計画日展開と配置反映(睡眠・食事・風呂が実際に空くようにする)

> **完了記録(2026-07-07・コミット `79157c4`)**: (a) `shouldExpandAcrossPlanningDays` で date なし・時刻あり(`hasSchedulableTime`)の meal/bath/sleep を全計画日へ展開、(c) `removeMissingForLifeConstraint` で missing 除去を kind 単位(sleep/buffer→sleep_cycle、meal/bath→meal_bath_constraints)へ分離し、両方が揃った時のみ life_constraints を解消。generator テスト(+333行)/edge cases で meal/sleep の全日回避と missing 粒度を red→green で固定。(b) 時刻不定の生活制約は展開対象外=floating のまま(本タスク未実装・設計報告どおり)。weeklyPlanning 344 passed / build 成功。md 5点すべて整合。

継続対話スモークで、ユーザーが睡眠・昼食・(日によって変わる)夕食・風呂を伝えたのに、生成された週間計画が非常に密で **夕食時間が実質確保されていない**。生活制約の保持・表現・配置反映のギャップを埋める。**文言問題ではなく scheduling / データ表現の問題**として扱う。

本mdの範囲外へ進まない。git add / commit / push はしない。

## 確定している事実

コード確認済み:

- `expandRecurringUnavailableConstraints`(constraintScheduling)は **`kind === 'unavailable'` かつ `date` なしの constraint のみ**を全計画日へ展開する。`meal` / `bath` / `sleep` は date なしでも展開されない。
- generator の `constraintToBusyInterval` は date なし constraint に `fallbackDate = planningStartDate` を与えるため、**date なしの meal/bath/sleep は初日1日分しか busy interval にならない**。2日目以降は塞がれず、そこに学習ブロックが詰め込まれる → 夕食が確保されない直接原因。
- 時刻のない生活制約(「日によって変わる夕食」)は `constraintToBusyInterval` が interval を作れず `floatingConstraints` に落ち、配置に一切反映されない(decisionTrace に出るのみ)。
- reducer の `update_life_constraint` apply は1件で `sleep_cycle` / `meal_bath_constraints` / `life_constraints` の3 missing を一括除去する(既知の粗い粒度。睡眠1件で食事・風呂の不足まで解決済み扱いになり、聞き取り漏れが起きる)。

つまり原因は3層: (a) 日次繰り返しの生活制約が全計画日に展開されない(unavailable 以外)、(b) 時刻不定の可変制約(曜日で変わる夕食)を表現・確保する手段がない、(c) missing 粒度が粗く、生活制約の聞き取りが早期に打ち切られる。

## 実装範囲

- **(a) 全計画日展開**: date なしの `meal` / `bath` / `sleep`(時刻ありのもの)を、`unavailable` と同様に全計画日へ日次展開する。展開責務は `expandRecurringUnavailableConstraints` の一般化、または並置する日次展開 helper に持たせる(既存 unavailable の挙動は不変に保つ)。展開後は既存の `constraintToBusyInterval` が各日で busy interval を作る。
- **(c) missing 粒度の分離**: `update_life_constraint` apply が、その constraint の kind に対応する missing のみを除去するようにする(sleep → sleep_cycle、meal/bath → meal_bath_constraints)。1件で全部を消さない。`life_constraints` 総括キーの扱いは、個別 kind がすべて充足したときのみ除去する形に整理する。
- **(b) 時刻不定の可変制約**: 曜日で変わる夕食のような「時刻範囲が日により異なる/未定」の表現をどう保持・確保するかは**設計判断が必要**。本タスクでは (a)(c) を実装し、(b) は「時刻不定制約は現状 floating に落ちて未反映」という事実と、必要なら曜日別 or デフォルト時間帯での確保案を**発見事項・後続設計として報告**する(実装は範囲外)。

## 回帰テスト

- date なし・時刻あり の meal(例: 19:00-20:00)が、計画全日で busy interval となり、その帯に学習ブロックが置かれないこと。
- sleep(0:00-8:00)が全日で確保されること。
- `update_life_constraint`(sleep のみ)apply 後、`sleep_cycle` は除去されるが `meal_bath_constraints` は missing に残ること(粒度分離)。
- 既存の unavailable 全日展開テスト、constraint busy interval テストが期待値変更なしで green。

## 完了条件

- 日次の生活制約(sleep/meal/bath)が全計画日で確保され、夕食帯に学習が詰め込まれないことがテストで固定される。
- missing 粒度が kind 単位に分離され、生活制約の聞き取りが1件で打ち切られない。
- 時刻不定の可変制約の扱いが発見事項/後続設計として報告される。
- 既存テスト全 green、build 成功。

## 触らない範囲

- 応答文言・トーン(文言問題と混同しない)。
- placement scoring 本体の重み調整、休憩挿入ルール(R8)。
- 時刻不定の可変制約の実装(設計報告まで)。
- AI interpreter、UI、保存導線。
- unavailable の既存展開挙動の変更。

## 停止条件

- (a) の展開一般化が unavailable の既存挙動を変えずには実現できないとき。
- (c) の粒度分離が `life_constraints` 総括キーの下流(dialogue/missingStatus)に広く波及するとき(波及範囲を報告して判断を仰ぐ)。
- 変更が constraintScheduling / generator / reducer と対応テストの外へ波及するとき。
- 説明できない新規テスト失敗が出たとき。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/scheduling/weeklyDraftCandidateGenerator.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```
