# 睡眠終了時刻と学習開始可能時刻を別概念として保持する(availability / daily routine)

「2時に寝て9時に起きる」と分かっても、9時から即座に勉強できるとは限らない(朝食・身支度・通学)。ただし準備/朝食/移動を一項目ずつ質問しない。「普段は何時ごろ起きて、勉強は何時ごろから始められそうですか?」程度の自然な質問で、内部では **sleep end** と **study available start** を必要に応じて別概念として保持する。

本mdの範囲外へ進まない。git add / commit / push はしない。

## 責務境界の判断(life-constraints-placement とは別 task にする)

`20260707-weekly-planning-life-constraints-placement.md` は「既に取得した生活制約(sleep/meal/bath)を全計画日へ展開し、busy interval として配置に効かせる」scheduling/reducer 修正が主眼。本タスクは「**新しい概念(study available start)を intake データモデルに追加し、sleep end と分離して保持し、自然な1問で取得する**」intake データモデル+availability の設計であり、層が異なる。よって統合せず別 task とする。ただし配置反映は life-constraints-placement の全日展開経路に乗る(依存)。

## 確定している事実 / 調査前提

- 現状、睡眠は `update_life_constraint`(kind: sleep)で保持され、その時間帯が busy interval になる。sleep end 直後から学習可能とみなされ、朝の準備・朝食・移動の余白がない。
- `study available start`(その日に学習を始められる最早時刻)という概念は intake / availability に存在しない。generator は `dayStartTime`(UI 固定 09:00)を一律使う。
- Phase 1 で、sleep end と study available start を別々に保持する最小データ表現(例: daily routine に study_available_start を持たせる / sleep constraint に付随する buffer)を設計する。曜日により起床・開始が変わりうる点(life-constraints の「日によって変わる」論点)とも整合させる。

## 実装範囲

### Phase 1: 設計(文書のみ)

- sleep end と study available start を分離保持するデータモデルを設計する。generator が `dayStartTime` 一律ではなく、その日の study available start を availability 下限に使える経路を示す。
- 自然な1問(「普段は何時ごろ起きて、勉強は何時ごろから始められそうですか?」)から sleep end と study start を取り出す解釈方針(parser / AI interpreter のどちらが担うか)を決める。質問文生成は `question-rendering-separation` 側、質問計画は `staged-dialogue-known-info` 側の責務であることを明記し、本タスクはデータモデルと availability 反映に限定。

### Phase 2: 最小実装(Phase 1 で確定)

- study available start を保持し、generator の1日あたり配置下限に反映する最小実装。曜日別の差はデフォルト+例外で表現できる範囲に留める。

## 回帰テスト

- study available start(例: 10:00)を持つ日で、学習ブロックが 10:00 より前に置かれないこと(sleep end が 08:00 でも準備余白が確保される)。
- study available start 未指定の日は従来どおり `dayStartTime` を使うこと(回帰なし)。
- 自然な1問からの解釈テスト(sleep end と study start が別値で取り出される)。

## 完了条件

- sleep end と study available start が別概念で保持され、後者が generator の配置下限に反映されることがテストで固定される。
- 一項目ずつ聞かず自然な1問で取得する解釈方針が示され、最小解釈が実装されている。
- 既存テスト全 green、build 成功。

## 触らない範囲

- 質問文の日本語生成(`question-rendering-separation`)、質問計画(`staged-dialogue-known-info`)。
- 移動時間・場所別 buffer の本格モデル(spec §4 の event_type_buffers)は将来。本タスクは study available start の1概念に絞る。
- placement scoring、予備日、既存予定除外。
- 生活制約の全日展開そのもの(life-constraints-placement)。本タスクはその下限反映のみ利用。

## 停止条件

- study available start の保持が daily routine / プロファイルの新規永続化(spec §4 の生活プロファイル保存)を要すると判明したとき(セッション内保持まで実装し、永続化は R5 生活プロファイルへ回して報告)。
- 変更が intake データモデル / generator の availability 下限 と対応テストの外へ波及するとき。
- 説明できない新規テスト失敗が出たとき。

## 依存

- 配置反映は `life-constraints-placement` の全日展開経路に乗る(その完了後が安全)。
- 自然な1問の質問文・提示は `question-rendering-separation` / `staged-dialogue-known-info` に依存(本タスクはデータと解釈方針まで)。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/scheduling/weeklyDraftCandidateGenerator.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```


## Implementation record (2026-07-07)

### Phase 1 design decisions

- State / constraint expression: keep the value in session intake data as `LifeConstraint.studyAvailableStart`, attached to the relevant `sleep` life constraint. No persistence or profile model is introduced.
- Generator route: derive a per-date lower-bound map from constraints before placement. Date-less `studyAvailableStart` applies to every planning day; dated constraints act as that date's override. If no value is present, placement falls back to the existing `firstDayStartTime` / `dayStartTime` behavior.
- Interpretation responsibility: deterministic parser handles the explicit natural one-answer form where wake time and study-available start are both present. AI interpreter schema and prompt behavior are unchanged in this task.
- Weekday/date differences: this task supports the minimal default-plus-dated-exception shape through date-less versus dated constraints. A persisted weekday routine model remains out of scope.

### Phase 2 implementation notes

- Added `studyAvailableStart` to the life constraint command/domain path.
- Added generator lower-bound handling independent from busy intervals.
- Added regression tests for separated sleep end / study start, fallback to `dayStartTime`, and natural one-answer parsing.
