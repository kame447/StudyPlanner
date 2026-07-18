# 週間計画の履歴活用・同期・個人最適化設計

Status: draft
Created: 2026-07-16

## 1. 目的

週間計画を、その場限りの会話から予定を生成する機能ではなく、過去の相談、計画、実行結果、生活リズムを継続的に利用して、各ユーザーが実際に勉強しやすい配置へ改善される仕組みに発展させる。

本設計では、次の要求を同時に満たす。

1. 週の途中で計画を作る場合、過去の時刻へ新しい予定を配置しない。
2. 会話は週単位で管理し、別端末でも直近の相談を再開できるようにする。
3. 長期的には、完全な会話本文ではなく、計画最適化に必要な構造化観測値と個人パラメータを保持する。
4. 過去の全記録を利用しつつ、古い情報と最近の情報を同じ重みでは扱わない。
5. 初期段階では説明可能なヒューリスティックと統計モデルを用い、十分なデータが蓄積した後にcontextual banditや系列モデルを比較する。
6. ユーザーが相談をリセットした場合、誤入力を学習データへ残さない。
7. 現行の制約ベースschedulerを安全境界として維持し、機械学習モデルが固定予定、睡眠、安全条件を破壊できないようにする。

## 2. 基本思想

### 2.1 会話の単位と学習の単位を分ける

ユーザー向けの会話sessionは週単位とする。

```text
conversationSessionKey = userId + weekStartDate
```

一方、個人最適化モデルは複数週の観測値を横断して更新する。

```text
週ごとの会話
  -> 構造化された計画・行動・結果event
  -> 長期的な個人profile
  -> 次回の候補配置score
```

会話本文を無制限に連結してモデルへ与えるのではなく、各週の相談から得た情報をversion付きの構造化eventへ変換する。

### 2.2 過去の全記録を使うが、同じ重みでは使わない

利用可能な記録は原則として集計対象に含める。ただし、生活リズムや集中可能時間は変化するため、古い記録には時間減衰を掛ける。

```text
全期間の安定傾向
+ 最近数週間の変化
+ 当日の状態
```

を別々の特徴として保持する。

### 2.3 予測と安全制約を分ける

機械学習や統計モデルは、安全な候補の中でどれを優先するかだけを決める。

```text
hard constraints
  -> 候補生成
  -> 個人別score
  -> 候補選択
```

次の条件は学習モデルより先に適用する。

- 現在より前へ配置しない
- 固定予定と重ねない
- 明示された利用不可時間へ配置しない
- 睡眠や最低休息条件を破壊しない
- 承認済み予定を暗黙に移動しない
- 不正な日時や未解決の曖昧条件を勝手に補完しない

## 3. 週の途中から計画する場合の時間境界

### 3.1 planning horizon

会話sessionは週単位だが、実際の配置対象期間はplanning horizonとして別に保持する。

```text
sessionWeekStart: 2026-07-13
planningHorizonStart: 2026-07-16T16:30:00+09:00
planningHorizonEnd: 2026-07-19T22:00:00+09:00
```

### 3.2 開始時刻の優先順位

開始可能時刻は次の優先順位で決める。

1. ユーザーが明示した開始日時
2. ユーザーが明示した開始日と、既存session policyの開始時刻
3. 現在日時 + 準備猶予

```text
resolvedStart =
  explicitStartDateTime
  ?? combine(explicitStartDate, policyStartTime)
  ?? roundUp(now + preparationBuffer)
```

初期の準備猶予は60分とする。配置粒度が10分なら10分単位、30分なら30分単位へ切り上げる。

### 3.3 過去時刻の扱い

- 明示指定がない場合、現在より前は自動的に配置対象から除外する。
- 「今週」と指定されても、経過済みの日付を候補生成へ渡さない。
- ユーザーが過去の開始時刻を明示した場合、現在時刻へ黙って読み替えず確認する。
- すでに開始済みの学習を記録したい発話と、これから計画したい発話を区別する。

### 3.4 準備猶予の個人化

将来的には、計画依頼時刻と実際の最初の学習開始時刻の差から、ユーザー別の準備猶予を推定する。

```text
preparationDelay = actualFirstStartAt - planningRequestedAt
```

ただし、初期値60分を直接上書きせず、十分な観測数と不確実性を確認してから適用する。

## 4. 会話履歴と別端末同期

### 4.1 同期を早期に導入する理由

localStorageだけでは、別端末、別ブラウザ、端末変更時に相談を再開できない。週間計画は複数日にまたがるため、会話session、intake state、未承認の仮予定をクラウド上のユーザー単位データとして同期できる構造を早めに用意する。

### 4.2 直近の完全会話

完全な会話本文は、ユーザーが再表示・再開する必要がある直近期間だけ保持する。

```text
weekly_conversation_sessions
- sessionId
- userId
- weekStartDate
- planningHorizonStart
- planningHorizonEnd
- status
- messages
- intakeState
- draftBlockRefs
- featureExtractionVersion
- createdAt
- updatedAt
- invalidatedAt
```

保存期間や保持session数は設定可能にし、初期値を実装へ直書きしない。

### 4.3 長期保存する情報

長期最適化に利用するため、会話本文とは別に構造化eventを保持する。

#### planning observation

```text
planning_observations
- observationId
- userId
- sourceSessionId
- observedAt
- featureSchemaVersion
- requestedStartAt
- resolvedPlanningStartAt
- subject
- taskType
- plannedDurationMinutes
- plannedTimeOfDay
- dayOfWeek
- locationCategory
- precedingActivityCategory
- interruptionRisk
- sleepContext
- workloadContext
- schedulerPolicyVersion
```

#### outcome observation

```text
planning_outcomes
- outcomeId
- observationId
- actualStartAt
- actualDurationMinutes
- completionRatio
- startDelayMinutes
- interruptionCount
- rescheduledCount
- abandoned
- subjectiveFocus
- perceivedDifficulty
- recordedAt
```

### 4.4 元会話と構造化eventの関係

会話本文を削除しても、正当な計画・実行結果まで失われないようにする。一方、誤入力を含む相談がリセットされた場合、そのsession由来のeventを学習対象から除外できなければならない。

そのためeventには`sourceSessionId`と有効状態を持たせる。

```text
validity = active | invalidated | superseded
```

## 5. 「この週の相談をリセット」の意味

UI上の操作名は「履歴をクリア」より「この週の相談をリセット」を基本とする。

### 5.1 削除・無効化するもの

- その週の会話message
- その週のintake state
- 未解決質問と仮定
- そのsessionから生成された未承認の仮予定
- そのsession由来で、まだ確定した実績に結び付いていない学習event

### 5.2 削除しないもの

- 承認済みの通常予定
- 他の方法で登録されたカレンダー予定
- 実際に完了した学習実績
- 他sessionから得られた個人profile
- 正当な過去のoutcome

### 5.3 物理削除と論理無効化

ユーザー向けには即座に消えたように見せる。内部では、誤った相談を学習対象から確実に除外するため、同期済みsessionと派生eventを論理無効化してから保持期限に応じて物理削除する。

```text
session.status = invalidated
observation.validity = invalidated
```

## 6. 個人最適化に使う特徴量

### 6.1 時間特徴

- 時刻
- 曜日
- 休日・平日
- 計画依頼から開始までの猶予
- 前の予定からの経過時間
- 就寝予定までの残り時間

時刻は0〜23の直線値だけでなく、周期特徴量として扱う。

```text
sin(2 * pi * minuteOfDay / 1440)
cos(2 * pi * minuteOfDay / 1440)
```

### 6.2 学習内容特徴

- 教科
- 問題演習、復習、暗記、読解などのtask type
- 推定難易度
- 連続学習時間
- 同一教科の連続回数
- 試験までの残日数
- 未完了量

### 6.3 生活リズム特徴

- 睡眠時刻と睡眠時間
- 食事、入浴、通学、移動などの前後関係
- 当日の予定密度
- 直近の開始遅延
- 直近の中断傾向
- その曜日の通常生活パターン

### 6.4 行動結果特徴

- 開始遅延
- 完了率
- 実績時間
- 中断回数
- 予定変更回数
- 翌日への持ち越し
- 主観的集中度
- 主観的疲労・難易度

「ユーザーが好んで選ぶ配置」と「実際に成果が出る配置」は別の値として保持する。

## 7. 生活リズムの確率モデル

生活リズムは単一の固定時刻ではなく、分布として表現する。

例:

```text
P(study_start_time | weekday, subject, prior_activity, sleep_context)
P(completion | time_of_day, subject, duration, workload)
P(reschedule | time_of_day, preceding_event, duration)
```

時刻は円環データなので、次のいずれかを比較する。

- sin/cos特徴を使う回帰モデル
- circular KDE
- von Mises分布
- 時間帯bucketごとのベイズ推定

初期実装では、観測数が少なくても壊れにくい時間帯bucketと平滑化を優先する。KDEや分布モデルは十分な観測数が得られた後に追加する。

## 8. 過去データの時間減衰

### 8.1 基本式

古い観測値には指数減衰を適用する。

```text
weight = exp(-age / tau)
```

または半減期で表現する。

```text
weight = 2 ^ (-age / halfLife)
```

### 8.2 特徴ごとに減衰速度を分ける

同じ半減期をすべての特徴へ適用しない。

| 特徴 | 変化速度の想定 |
|---|---|
| 好みの時間帯 | 遅い |
| 教科と時間帯の相性 | 中程度 |
| 集中可能な連続時間 | 中程度 |
| 睡眠・生活リズム | 速い |
| 試験直前の優先度 | 非常に速い |
| 当日の疲労 | 当日限定 |

### 8.3 減衰率の調整

減衰率を勾配降下法だけで直接決めるのではなく、時系列順のwalk-forward validationで評価する。

```text
week 1..8で推定 -> week 9を評価
week 1..9で推定 -> week 10を評価
week 1..10で推定 -> week 11を評価
```

複数の半減期候補または連続パラメータを比較し、将来期間の予測誤差または配置rewardが最も良い値を採用する。

生活環境の急変を検知した場合は、長期profileを破棄せず、短期profileの混合比を増やす。

## 9. 個人別配置score

### 9.1 初期モデル

初期段階では説明可能な線形scoreを用いる。

```text
finalScore =
  heuristicScore
  + personalizedScore
  - riskPenalty
  - uncertaintyPenalty
```

```text
personalizedScore = userParameterVector dot candidateFeatureVector
```

ユーザー別パラメータが不足している場合は、全体prior、類似ユーザー群、既定ヒューリスティックの順でfallbackする。

### 9.2 scoreの説明可能性

予定を提案する際、主要な寄与要因を表示できるようにする。

例:

```text
この時間帯は過去4週間で開始遅延が少ないため優先しました。
英語は短い区切りの方が完了率が高いため30分に分割しました。
```

内部scoreと説明文生成を同じ特徴量IDに基づける。

## 10. contextual bandit

候補配置が複数ある場合、contextual banditで探索と活用を制御できる。

```text
context = user state + current week + candidate features
action = safe candidate schedule
reward = completion, start delay, interruption, user correction
```

ただしbanditは安全な候補集合の外へ出られない。

### 10.1 rewardの例

```text
reward =
  + completionRatio
  - normalizedStartDelay
  - interruptionPenalty
  - reschedulePenalty
  + subjectiveFocusBonus
```

rewardの各係数は明示的にversion管理する。

### 10.2 探索制約

次の状況では探索率を下げる。

- 試験直前
- 高重要度task
- 睡眠不足
- 固定予定が密集している日
- ユーザーが安定配置を明示的に希望した場合

## 11. RNN・系列モデルの位置付け

RNNやTransformer系の系列モデルは、複数週の状態変化や行動系列を表現できる。ただし、個人ごとのデータ量が少ない段階で、各ユーザー専用RNNを直接学習するのは過学習しやすい。

導入順は次とする。

1. ヒューリスティックと構造化eventを整備する
2. 時間減衰付き統計profileを導入する
3. 線形または木ベースの個人別scoreを導入する
4. contextual banditを導入する
5. 全ユーザー共通の系列encoderと個人embeddingを比較する
6. オフライン評価で明確な改善がある場合だけ本番候補にする

系列モデルを採用する場合も、最終配置は制約ベースschedulerを通す。

## 12. データversioningと再計算

過去の会話本文をすぐ完全削除すると、特徴抽出方法を改善した際に再計算できない。一方、全文を無期限に保持するとストレージとプライバシー負担が増える。

そのため次を分離する。

```text
recent full conversation
structured canonical events
versioned derived features
user profile snapshots
```

各派生値は次を持つ。

- source event ID
- feature schema version
- model version
- calculatedAt
- validity

特徴量定義を変更した場合、保持されているcanonical eventから再計算する。

## 13. ストレージ方針

### 13.1 完全会話

- 直近の再開・確認に必要な範囲だけクラウド同期する
- 保持session数または日数は設定値とする
- ユーザーがsessionを削除できる
- モデル学習利用の同意状態を別に持つ

### 13.2 構造化event

- 長期傾向の計算に必要な最小情報を保持する
- 自由記述本文を安易に複製しない
- 個人を直接特定する不要な文字列を特徴量へ含めない
- 無効化・削除要求を派生profileまで伝播できるようにする

### 13.3 profile

profileは元データではなく再計算可能なcacheとして扱う。profileだけを唯一の記録にしない。

## 14. オフライン評価

本番で個人化を有効にする前に、時系列を守った評価を行う。

### 14.1 評価指標

- 完了率
- 開始遅延
- 中断率
- 予定変更率
- 翌日持ち越し率
- ユーザーによる手動修正量
- 主観的集中度
- 制約違反数

### 14.2 比較対象

- 現行ヒューリスティック
- 時間減衰なしprofile
- 固定半減期profile
- 自動調整半減期profile
- 個人別線形score
- contextual bandit
- 系列モデル

### 14.3 本番導入条件

平均指標だけでなく、次を満たすこと。

- 制約違反が増えない
- 一部ユーザーだけが大きく悪化しない
- データ不足時に既定ヒューリスティックへ安全に戻る
- scoreの主要因を説明できる
- モデルversionを切り戻せる

## 15. 段階的ロードマップ

### Phase P0: 時間境界

- 現在日時をpipelineへ渡す
- 明示指定がなければ現在 + 60分から開始する
- 過去区間を候補生成から除外する
- 過去の明示指定は確認へ倒す

### Phase P1: 会話session同期とreset

- 週単位sessionのクラウド保存
- 別端末での復元
- 直近全文の保持
- 「この週の相談をリセット」
- session由来の未承認仮予定削除
- 派生eventの無効化

### Phase P2: canonical event store

- planning observation schema
- outcome observation schema
- sourceSessionIdとversion
- 実績入力との接続

### Phase P3: 統計profile

- 時間帯別完了率
- 開始遅延
- 教科・時間帯相性
- 準備猶予
- 時間減衰
- 不確実性

### Phase P4: 個人別placement score

- 候補特徴量
- score API
- fallback policy
- 説明可能な寄与表示
- offline evaluation

### Phase P5: bandit

- reward定義
- safe candidate action
- 探索率制御
- logged policy evaluation

### Phase P6: 系列モデル研究

- 共通encoderと個人embedding
- RNN/Transformer比較
- walk-forward evaluation
- 本番採否判断

## 16. 現時点で確定する方針

1. 会話sessionは週単位にする。
2. planning horizonは会話sessionと別に保持する。
3. 週途中で明示指定がなければ、現在時刻 + 60分以降だけを配置対象にする。
4. 過去の曜日・時刻へ新しい予定を配置しない。
5. 直近の完全会話は早期にクラウド同期する。
6. 長期計算にはcanonicalな構造化eventと個人profileを使う。
7. 過去の利用可能な記録は原則利用するが、特徴ごとに時間減衰を適用する。
8. 減衰率はwalk-forward validationで調整する。
9. 生活リズムは固定値ではなく時間帯分布と不確実性を持つ。
10. 初期は説明可能な統計profileと個人別scoreを使う。
11. contextual banditは安全な候補集合の選択にだけ利用する。
12. RNNなどの系列モデルは、十分なデータが蓄積した後の比較対象とする。
13. 「この週の相談をリセット」で会話、intake、未承認仮予定を削除する。
14. リセットされたsession由来の未確定データは学習対象から除外する。
15. 承認済み予定と確定した実績は相談resetで削除しない。

## 17. 後で決める事項

- 完全会話を保持する具体的なsession数または日数
- 同期backendとアクセス制御
- 学習利用の同意UI
- rewardの係数
- 主観的集中度の入力方法
- location categoryの取得方法
- 生活環境のchange point判定
- 古いcanonical eventの物理削除条件
- 全体priorと個人priorの混合方法
- 個人化を開始する最低観測数
