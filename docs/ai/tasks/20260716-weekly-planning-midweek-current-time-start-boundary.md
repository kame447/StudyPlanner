# Stable V5で現在時刻より前へ予定を配置しない

Status: active / unimplemented hard-safety boundary
Priority: P0 after `20260727-weekly-planning-trace-empty-session-recovery.md`
Created: 2026-07-16
Updated: 2026-07-28
Tracking: Issue #47
Depends on: none

## 1. 現在の実装差分

`weeklyPlanningStableV5PreviewScheduler.ts`はplanning horizon内の日付ごとに既定`09:00–22:00`のplacement windowを作る。scheduler inputまたはruntime contextにrequest開始時刻がなく、当日の現在時刻より前を除外しない。

したがって、午後に「今日」「今週」の計画を作ると、空いていれば同日09:00から候補を生成し得る。

これはpersonalizationではなくhard safety boundaryである。profile、履歴、scoreより先に実装する。

## 2. 固定contract

開始可能境界の優先順位:

1. userが明示した将来の開始日時
2. userが明示した開始日 + explicit/default day start
3. request開始時に一度だけ固定した`currentDateTime` + preparation buffer

- preparation buffer初期値は60分
- scheduler粒度へ切り上げる
- 同一request内でclockを再取得しない
- 明示開始が過去なら黙って現在へ補正せず、確認または再調整へ倒す
- planning sessionの`weekStartDate`と配置可能horizon開始を分離する

## 3. 実装範囲

- application request contextへIANA timezone付き`currentDateTime`を注入
- pureなplanning start boundary resolver
- Stable V5 generic scheduler inputまたはpreview scheduler inputへresolved earliest startを追加
- 当日windowのstartをearliest startまでclip
- 経過済みの日付を候補から除外
- explicit future startを優先
- explicit past startをblocking issue化
- reload/retryでも同じrequest identity内では同じclock snapshotを使う

## 4. Test matrix

- 朝・昼・夜の同日計画
- 60分bufferとscheduler粒度の切上げ
- day endを超えた場合の翌日移行
- 日跨ぎ、週末、月跨ぎ、年跨ぎ
- JSTとDSTを持つtimezone
- explicit future/past start
- non-consecutive allowed date
- availability windowとearliest startの交差
- fixed plan/timetable後のslot
- insufficient capacity atomic rejection
- fake clockによる再現可能性

## 5. 完了条件

- [ ] request単位clock snapshotをapplication boundaryで作る
- [ ] Stable V5 schedulerが同日現在時刻より前へ配置しない
- [ ] 経過済み日付へ候補を生成しない
- [ ] explicit future startを優先する
- [ ] explicit past startを無言で補正しない
- [ ] timezone/date boundary testを追加する
- [ ] existing plan、availability、task date eligibilityを壊さない
- [ ] legacy pathへ場当たり的な`new Date()`分岐を追加しない
- [ ] focused/full/typecheck/build/diff checkがgreen
- [ ] 実browserで現在時刻境界を確認する

## 6. 対象外

- buffer時間のpersonalization
- cloud session sync
- 過去実績の入力
- scheduler全体のscore変更
- user profile更新