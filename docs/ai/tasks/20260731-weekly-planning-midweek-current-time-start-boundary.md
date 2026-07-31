# Stable V5で現在時刻より前へ予定を配置しない

Status: active / unimplemented hard-safety boundary
Priority: P0
Created: 2026-07-16
Updated: 2026-07-31
Tracking: Issue #47
Depends on: none

## 現在地

Stable V5 preview schedulerはplanning horizon内の日付へ既定`09:00–22:00`のwindowを作るが、request開始時刻をscheduler入力へ持たない。そのため午後に「今日」「今週」の計画を作ると、空いていれば同日の過去時刻へ候補を置き得る。

これはpersonalizationではなくhard safety boundaryであり、default cutover前に必須である。

## 固定contract

開始可能境界の優先順位:

1. userが明示した将来の開始日時
2. userが明示した開始日とexplicit/default day start
3. request開始時に一度だけ固定した`currentDateTime`とpreparation buffer

- preparation buffer初期値は60分
- scheduler粒度へ切り上げる
- 同一request内でclockを再取得しない
- 明示開始が過去なら黙って現在へ補正しない
- week scopeとplacement horizonを分離する

## 実装範囲

- application request boundaryでIANA timezone付きclock snapshotを作る
- pureなearliest placement resolverを追加
- generic schedulerまたはpreview inputへresolved earliest startを渡す
- 当日windowをclipし、経過済みの日付を除外する
- explicit future/past startを区別する
- retry/reloadで同じrequest identityなら同じsnapshotを使う

## 完了条件

- [ ] request単位clock snapshotを実装
- [ ] 同日現在時刻より前へ配置しない
- [ ] 経過済み日付へ候補を生成しない
- [ ] explicit future startを優先
- [ ] explicit past startをblocking issue化
- [ ] timezone、日跨ぎ、月跨ぎ、DST testを追加
- [ ] availability、fixed plan、task date eligibilityを壊さない
- [ ] focused/full/typecheck/build/diff checkがgreen
- [ ] 実browserで確認

## 対象外

- buffer時間のpersonalization
- cloud session sync
- scheduler score全面変更