# 7日目予備日(6日配置+1日予備)を新 intake path に反映する

> **完了記録(2026-07-07・コミット `7b3e288`)**: 新 intake path の generator に「最終日を予備日として通常配置から外し、溢れた分のみ回す」挙動を追加。weeklyPlanning テスト green / build 成功。6等分・1日上限(capacity 配分)は本タスク範囲外で R8 へ。

以前の週間計画には「6日間に配置し、残り1日を予備日として扱う」設計があったが、今回の生成では7日目にも説明なく通常の学習予定が配置されている。

本mdの範囲外へ進まない。git add / commit / push はしない。

## 確定している事実 / 調査前提

コード確認済み:

- `weeklyDraftCandidateGenerator.findNextSlot` は `dateIndex < planningDayCount`(UI から 7)で**全7日を等しく配置対象にする**。予備日の概念が無い。
- 予備日(`reserveDate`)は legacy 側(`weeklyPlanningTransforms.ts` / `weeklyPendingConfigUpdater` / `availabilitySlots`)にのみ存在。新 intake path の generator には移植されていない。
- roadmap では spec §3「6等分・7日目予備日」は R8(配置品質)の未実装項目として整理されている。

判定: legacy path には予備日があったが、**新 intake path は最初から予備日未実装**。「意図的に7日通常配置へ変更した根拠」は task md / roadmap に見当たらない。よって新 path における**未移植(実質 regression)**として扱う。Phase 1 で legacy の予備日仕様(何日目を予備にするか、予備日に何を回すか)を確認し、新 path の最小仕様を確定する。

## 実装範囲

- generator に「7日目(または planningDayCount の最終日)を予備日とし、1〜6日目に配置しきれなかった分・後ろ倒し分のみ最終日に回す」挙動を追加する。最小実装として「通常配置は最終日を除く日数で行い、溢れた work item のみ最終日に配置する」で足りるか Phase 1 で確定。
- 予備日を使った場合はその旨を diagnostics に出す(spec §5.4 の「7日目を使う場合は警告」に対応、UI 文言は本タスク外)。
- capacity 超過時(そもそも6日に入らない大量 work item)の扱いは R8 の6等分・上限とセットになるため、本タスクは「最終日を予備扱いにして通常配置から外す」基本挙動までとし、6等分配分は触らない。

## 回帰テスト

- 6日に収まる work item 群が1〜6日目に配置され、7日目には配置されないこと。
- 6日に収まらない分だけが7日目に回り、diagnostics に予備日使用が出ること。
- planningDayCount が7以外の場合の最終日予備扱いの整合(境界)。
- 既存の generator テストのうち全日配置前提のものは「現状固定 → intended 変更」を明記して更新。

## 完了条件

- 通常配置が最終日を予備として扱い、溢れた分のみ予備日に回ることがテストで固定される。
- 予備日使用が diagnostics で観測できる。
- 既存テスト全 green、build 成功。

## 触らない範囲

- 6等分・1日上限(R8 の capacity 配分)。本タスクは「最終日を予備にする」まで。
- placement scoring の重み、休憩ルール。
- 既存予定除外(別タスク)、UI 文言・警告表示。
- legacy availability path の予備日実装の変更(参照のみ)。

## 停止条件

- 予備日の最小実装が capacity 配分(6等分)なしには実用挙動にならないと判明したとき(基本挙動まで実装し、配分は R8 へ回して報告)。
- 変更が generator / dailyDistribution と対応テストの外へ波及するとき。
- 説明できない新規テスト失敗が出たとき。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/scheduling/weeklyDraftCandidateGenerator.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```
