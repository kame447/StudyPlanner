# Weekly Planning Natural Dialogue Improvement Spec

> **ステータス: superseded な条件 parser 改善案。** 通常経路を regex と operation の固定順で対話主導する方針は採用しない。時刻抽出など rules fallback の参考記録として残す。週間計画の現在の対話設計は [親設計 v4](../architecture/weekly-planning-dialogue-architecture-v4.md) を参照する。

作成目的

StudyPlanner の週間計画MVPについて、自然な条件変更対話と配置アルゴリズムの信頼性を改善する。

今回の目的は、通常予定パーサー全体を作り直すことではない。
通常予定入力の staged pipeline と週間計画MVP専用ロジックは分離したままにする。

対象は主に以下。

* src/features/weeklyPlanning/weeklyPlanningTransforms.ts
* src/features/weeklyPlanning/weeklyPlanningTransforms.test.ts
* src/components/NaturalLanguageAssistant.tsx

## 背景

現在の通常予定パーサーは、normalize、tokenize、clause parsing、AST、IR、compile、validate の staged pipeline を持っている。

一方、週間計画MVPは通常予定パーサーとは別の専用ロジックで、合計時間ベースの入力を受け取り、条件案を出し、pending config を保持して WeeklyPlanDraftBlock を作る。

この分離は維持する。

ただし、週間計画側の条件変更パーサーは、現状では定型文一致に寄りすぎている。

例:

* 7日間で
* 1回90分で
* 13時から22時で

のような文は扱えるが、

* 勉強開始は9時からで、お昼は13〜14時
* 勉強開始9時から
* 勉強可能時間9時から
* 9時から勉強できる
* 13時から14時は使わない
* 昼休みは13時から14時

のような自然な言い換えに弱い。

この問題は、例文を個別に増やすだけでは解決しない。
時刻表現と周辺文脈から intent を分類し、operation に変換する小さな条件変更パーサーが必要。

## 方針

週間計画の条件変更は、次の流れで処理する。

1. normalizeConditionText
2. splitConditionClauses
3. extractTimeMentions
4. extractDurationMentions
5. classifyConditionClause
6. applyWeeklyConditionOperations

直接「この文ならこの処理」と書くのではなく、以下のように処理する。

* 時刻表現を抽出する
* 時刻の前後にある語を見る
* intent を分類する
* WeeklyConditionOperation を作る
* pending config に operation を適用する

## 追加する operation

最低限、以下の operation を扱う。

```ts
type WeeklyConditionOperation =
  | { kind: 'setDayCount'; dayCount: number }
  | { kind: 'extendDayCount'; days: number }
  | { kind: 'setAvailableStartTime'; startTime: string }
  | { kind: 'setAvailableEndTime'; endTime: string }
  | { kind: 'setAvailableRange'; startTime: string; endTime: string }
  | { kind: 'addUnavailableRange'; startTime: string; endTime: string; reason: string }
  | { kind: 'removeUnavailableRange'; reason?: string }
  | { kind: 'setPreferredRange'; startTime: string; endTime: string }
  | { kind: 'setMaxSessionMinutes'; minutes: number }
  | { kind: 'setBreakMinutes'; minutes: number }
  | { kind: 'setSleepWindow'; startTime: string; endTime: string }
  | { kind: 'allowPartialPlacement' };
```

## 時刻表現の正規化

以下を同じように扱う。

* 9時
* 09:00
* ９時
* 9:00
* 9時半
* 13〜14時
* 13～14時
* 13時から14時
* 13:00-14:00
* 13時〜14時

全角数字は半角にする。
全角チルダ、波ダッシュ、ハイフン、「から」を時刻範囲として扱えるようにする。

## clause 分割

1文内に複数条件が含まれる場合がある。

例:

* 勉強開始は9時からで、お昼は13〜14時
* 9時から始めて、昼休みは13時から14時
* 7日間で、1回90分、休憩15分

読点、句点、改行、カンマ、「で」「あと」「それと」などを使って複数 clause に分け、複数 operation を適用する。

最初に一致した条件だけ処理して終わらないこと。

## intent 分類

### 勉強開始時刻

以下のような語が近くにある場合、setAvailableStartTime として扱う。

キーワード例:

* 勉強開始
* 開始
* 始める
* スタート
* 勉強可能
* 使える
* 何時から
* 朝は
* 午前は
* から勉強

対応例:

* 勉強開始9時から
* 勉強開始は9時からで
* 勉強可能時間9時から
* 9時から勉強できる
* 朝は9時から使える
* 午前は10時から

期待:

* availableStudyRanges の startTime を指定時刻に更新する
* endTime は現在の終了時刻を維持する
* 例: 08:00-24:00 の状態で「勉強開始9時から」なら 09:00-24:00 にする

### 勉強終了時刻

以下の語が近くにある場合、setAvailableEndTime として扱う。

キーワード例:

* 終了
* 終わり
* まで
* 何時まで
* 勉強は何時まで
* 夜は

対応例:

* 22時までで
* 勉強は22時まで
* 夜は23時まで
* 終了は21時

期待:

* availableStudyRanges の endTime を指定時刻に更新する
* startTime は現在の開始時刻を維持する

### 勉強可能時間帯

開始と終了の両方がある場合、setAvailableRange として扱う。

対応例:

* 9時から22時で
* 09:00-22:00で
* 勉強可能時間は9時から22時
* 9時〜22時で

期待:

* availableStudyRanges を指定範囲に置換する
* preferredStudyRanges は必要に応じて更新する
* このとき食事などの unavailableRanges を勝手に消しすぎないこと
* ただし、ユーザーが明示した範囲を hard available として扱う場合は、表示と挙動を一致させること

### 食事・休憩・不可時間

以下の語が近くにある場合、addUnavailableRange として扱う。

キーワード例:

* 昼
* お昼
* 昼食
* 昼ごはん
* ランチ
* 夕食
* 夜ご飯
* 食事
* ご飯
* 休憩
* 空ける
* 使わない
* 除外
* 無理

対応例:

* お昼は13〜14時
* 昼休みは13時から14時
* 13時から14時は昼ごはん
* 13-14は空けて
* 12時から13時は使わない
* 夕食は18時から19時

期待:

* unavailableRanges に指定範囲を追加する
* 既存の昼食枠がある場合は、同じ reason の枠を置換してもよい
* 表示にも反映する

### 1回の学習上限

以下の語が近くにある場合、setMaxSessionMinutes として扱う。

キーワード例:

* 1回
* 一回
* 最大
* 上限
* セッション
* 連続
* ぶっ続け

対応例:

* 1回90分で
* 最大90分
* 120分じゃなくて90分
* 連続は60分まで

期待:

* maxSessionMinutes を更新する

### 休憩時間

以下の語が近くにある場合、setBreakMinutes として扱う。

キーワード例:

* 休憩
* 休み
* インターバル

対応例:

* 休憩15分で
* 休憩は20分
* 10分じゃなくて15分

期待:

* breakMinutes を更新する

### 睡眠時間

以下の語が近くにある場合、setSleepWindow として扱う。

キーワード例:

* 睡眠
* 寝る
* 就寝
* 起床
* 起きる

対応例:

* 睡眠は2時から9時
* 寝るのは1時から8時
* 2時に寝て9時に起きる

期待:

* sleepStartTime と wakeTime を更新する
* availableStudyRanges も睡眠時間に合わせて調整する

## hard constraint と soft preference の分離

以下を明確に分ける。

* availableStudyRanges: 勉強してよい時間帯
* unavailableRanges: 絶対に避ける時間帯
* preferredStudyRanges: 優先して置きたい時間帯

preferredStudyRanges は配置可能範囲ではない。
preferredStudyRanges 外でも availableStudyRanges 内なら、必要に応じて配置する。

空き時間があるのに preferred 外だから未配置、という挙動にしないこと。

## 3300分が入らない問題

現在、次の条件で 3300分が入り切らず、2880分だけ配置され、420分が未配置になることがある。

入力:

来週、英語10時間、計算理論10時間、線形代数8時間、確率統計6時間、卒研8時間、Java実装6時間、レポート作成4時間、Obsidian整理3時間やりたい

条件:

* 7日間
* 08:00-24:00
* 既存予定なし
* 合計3300分

この条件なら、単純な可用時間は 16時間 × 7日 = 6720分。
食事や休憩を引いても、3300分は基本的に入るはず。

画面上も空き時間が残っているため、容量不足ではなく配置探索失敗の可能性が高い。

## 配置ロジックで確認すること

以下を確認する。

* availableStudyRanges 全体を使っているか
* preferredStudyRanges だけに配置していないか
* dayCount を7に変更した後、内部探索日数も7になっているか
* unavailableRanges が過剰に効いていないか
* existingPlans が空なのに、既存予定バッファで枠を潰していないか
* 休憩10分が空き枠を過剰に分断していないか
* minStudyBlockMinutes が端数処理で過剰に効いていないか
* 科目分散や round robin の都合で空き枠をスキップした後、再探索していない問題がないか
* 1日の配置数や科目ごとの配置数に暗黙の上限がないか

## 未配置時の診断を追加する

未配置が出たとき、単に「入りません」と返さない。

最低限、内部的に以下を計算できるようにする。

```ts
interface WeeklyPlacementDiagnostics {
  requestedMinutes: number;
  placedMinutes: number;
  unplacedMinutes: number;
  totalAvailableCapacity: number;
  totalUnavailableMinutes: number;
  existingPlanBlockedMinutes: number;
  breakMinutesConsumed: number;
  unusedAvailableMinutes: number;
  dailyCapacity: Array<{
    date: string;
    availableMinutes: number;
    placedMinutes: number;
    unusedMinutes: number;
  }>;
  failureReason:
    | 'capacity_shortage'
    | 'search_failure'
    | 'min_block_fragmentation'
    | 'hard_constraint'
    | 'unknown';
}
```

診断ルール:

* totalAvailableCapacity < requestedMinutes なら capacity_shortage
* totalAvailableCapacity >= requestedMinutes かつ unplacedMinutes > 0 なら search_failure の可能性が高い
* unusedAvailableMinutes が多いのに未配置がある場合は search_failure として扱う
* 未使用枠が30分未満ばかりなら min_block_fragmentation として扱う

## ユーザー向けメッセージ

容量不足の場合:

この条件では配置可能時間が不足しています。
配置可能時間は xxxx分、必要時間は yyyy分です。
期間を延ばす、夜も使う、1回の上限を短くする、配置できる分だけ作成する、のいずれかを選べます。

探索失敗の場合:

空き時間は残っていますが、現在の配置ルールでは一部を置けませんでした。
配置順や分割方法を変えて再配置します。

この場合、ユーザーに条件変更を求めるより、内部で再探索する。

## 追加テスト

### 条件変更パーサー

以下のテストを追加する。

* 勉強開始9時から
* 勉強開始は9時からで
* 勉強可能時間9時から
* 9時から勉強できる
* 朝は9時から使える
* 22時までで
* 勉強は22時まで
* 夜は23時まで
* 9時から22時で
* 勉強可能時間は9時から22時
* お昼は13〜14時
* 昼休みは13時から14時
* 13時から14時は使わない
* 13-14は空けて
* 夕食は18時から19時
* 勉強開始は9時からで、お昼は13〜14時
* 7日間で、1回90分、休憩15分

期待:

* 条件変更文を具体例一致だけでなく、時刻表現と周辺語から operation 化できる
* 複合文では複数 operation を適用できる
* pending state がない短文は週間計画入力として誤爆しない

### 配置ロジック

以下のテストを追加する。

* 7日間、08:00-24:00、既存予定なしで3300分が全量配置される
* 7日間、09:00-24:00、昼13:00-14:00、既存予定なしで3300分が可能な限り配置される
* preferredStudyRanges 外の availableStudyRanges も必要なら使われる
* dayCount 変更後、内部探索日数も変更される
* 未配置時に capacity_shortage と search_failure を区別できる
* unusedAvailableMinutes が多いのに未配置がある場合、探索失敗として診断される

## 手動確認シナリオ

入力:

来週、英語10時間、計算理論10時間、線形代数8時間、確率統計6時間、卒研8時間、Java実装6時間、レポート作成4時間、Obsidian整理3時間やりたい

返信:

7日間想定でやってほしい

返信:

勉強開始は9時からで、お昼は13〜14時

返信:

この条件で作成

期待:

* 7日間が反映される
* 勉強可能時間が 09:00-24:00 になる
* 昼 13:00-14:00 が unavailableRanges に入る
* default に戻らない
* preferredStudyRanges 外の availableStudyRanges も使われる
* 空き時間が大量に残っているのに未配置扱いにならない
* 未配置が出る場合は、容量不足か探索失敗かが診断される

## 実装上の注意

通常予定の staged pipeline には混ぜないこと。

週間計画の pending state があるときだけ、この条件変更パーサーを優先する。

pending state がない状態で、

* 9時から
* 22時まで
* お昼は13〜14時
* 1回90分で

のような短文が来ても、新規週間計画として誤爆しないこと。

通常AI相談導線と通常予定保存導線を壊さないこと。

修正は最小差分にする。

## 検証コマンド

以下を必ず実行する。

```bash
git diff --check
npm run test
npm run build
```

## 報告してほしい内容

完了後、以下を報告する。

* 条件変更パーサーの構造
* 追加した operation
* 追加した対応表現
* 追加したテスト
* 3300分が入らなかった原因
* 修正後の配置結果
* 未配置時の診断内容
* まだ未対応の自然文表現
* test/build 結果
* package.json / package-lock.json に差分が出たか
* コミットしてよいか
