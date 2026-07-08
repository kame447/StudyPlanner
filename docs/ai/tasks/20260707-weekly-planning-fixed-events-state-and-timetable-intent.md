# fixed_events の状態区別と「予定表を使う」意図の受理

ユーザーが授業・バイトを伝えても fixed_events が再質問される。fixed_events が「予定なし / 予定ありだが時刻不足 / 既存 timetable を使う」を区別できず、「予定表の通り」という timetable 参照意図を受理できないのが原因。

本mdの範囲外へ進まない。git add / commit / push はしない。

## 背景(実例)

実例2:
```text
ユーザー: 大学院入試の過去問を進めていきたい。授業が木曜日の二コマの時間帯にあるのと今日の夜に18～20:30でバイトがあります
アプリ: 固定の予定があれば教えてください。   ← 授業・バイトを伝えたのに再質問
```
実例4:
```text
ユーザー: 授業は予定表に記載されている通りにあります
（後続で固定予定の扱いが反映されない）
```

## 現行原因(コード確認済み・一部は調査前提)

- `fixed_events` の充足は、`add_fixed_event`(hardness hard)apply による missing 除去、`note_no_fixed_events`(予定なし明示)、soft/uncertain fixed event の保持、で構成される。
- **「予定はあるが時刻が時間割依存で未確定(木曜二コマ)」と「予定なし」と「既存 timetable/calendar をそのまま使う」の3状態が区別されていない。** 「予定表に記載の通り」= 既存 timetable 参照意図を表す command / state がない(`existing-plans-availability-exclusion`(closed)は generator への busy interval 注入は解決したが、intake 側で「予定表を使う」と宣言して fixed_events を充足する経路は別)。
- 実例2 で授業(時刻曖昧)+バイト(18-20:30 明確)を伝えても再質問された直接原因は、interpreter が `add_fixed_event` を返せていない / 時刻不足で soft 化し missing が残る / validator で reject、のいずれか。**Phase 1 で実 AI トレース(または決定的 parser 経路)で確定する。**

## 対象範囲

### Phase 1: 原因の確定(調査のみ)

- 実例2・4 の入力に対し、interpreter / 決定的 parser が `add_fixed_event` / timetable 参照をどう扱うかを追跡。授業(時刻曖昧)とバイト(明確)がそれぞれ hard/soft/未受理のどれになり、`fixed_events` missing がなぜ残るかを1点特定。

### Phase 2: 修正(Phase 1 で確定)

- fixed_events の状態を「明示なし(未確認)/ 予定あり・時刻確定 / 予定あり・時刻未確定(要確認) / 予定なし明示 / 既存 timetable を使う」で区別できるようにする。
- 「予定表に記載の通り」= 既存 timetable/calendar を fixed events として採用する意図を command/state で受理し、`fixed_events` missing を充足する(実データの timetable 取り込みは `existing-plans` の busy interval 経路と接続。intake 側は「使う」宣言の受理まで)。
- 時刻未確定の予定(木曜二コマ)は、時間割から時刻を解決できるなら hard、できないなら「その予定の時刻を確認」に倒す(broad な「固定予定ありますか」の丸ごと再質問にしない)。

## 対象外

- generator への既存予定 busy interval 注入(`existing-plans-availability-exclusion` で完了済み)。
- 「固定の予定」という語の言い換え(renderer context タスク)。
- clarification request(別タスク)。
- timetable データ層の大改修(intake が受け取る宣言・参照までに留め、UI/データ配線が要るなら停止して報告)。

## 完了条件

- 授業・バイトを伝えたターンで fixed_events が充足し、broad な「固定予定ありますか」の再質問が止まる。
- 「予定表の通り」で既存 timetable 採用意図が受理され、fixed_events が充足する。
- 時刻未確定の予定は broad 再質問ではなく的を絞った確認に倒れる。
- weeklyPlanning テスト green / build 成功。

## 必要な regression test

- 「18-20:30 バイト」→ hard fixed event 受理、fixed_events 充足。
- 「予定表に記載の通り」→ timetable 採用意図受理、fixed_events 充足。
- 「木曜二コマ(時刻未確定)」→ 未確定として保持し、broad 再質問ではなく時刻確認に倒れる(または timetable 解決)。
- 「予定なし」明示は従来どおり(既存 note_no_fixed_events テスト不変)。

## roadmap 対応

R2-S 派生(fixed_events の状態表現)+ R5(生活プロファイル/カレンダー活用)の入口。`existing-plans-availability-exclusion`(closed)の intake 側続編。
