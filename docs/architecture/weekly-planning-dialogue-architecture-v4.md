# weeklyPlanning 対話アーキテクチャ（親設計 v4: state-grounded AI dialogue）

**ステータス: 設計の正（design of record）。** 週間計画の対話、実装順、会話評価の唯一の正は本文書である。v1〜v3 は履歴・調査記録として残すが、通常経路の仕様には用いない。

- 最終更新: 2026-07-13
- 対象: 週間計画モードの会話から preview、未承認 draft まで
- 対象外: 保存済み予定の自動変更、承認・保存の AI 自動実行、scheduler 二系統の統合

## 1. プロダクトゴール

StudyPlanner の週間計画は入力フォームを会話にしたものではない。ユーザーが決まっていることを自由に話し、アプリが登録済み予定、残作業量、空き時間を根拠に、一週間の学習方針を一緒に整理する対話である。

標準は一週間だが、期間未指定を隠れた確定事実にしない。必要なら「選択中の日から7日間」を**提案用の仮定**として示し、確定 state とは分けて追跡する。

- 画面を開いた時点で、自然な開始と自由入力の招待ができる。
- 期間、科目、時間を固定順に尋問しない。一発話の複数条件をまとめて受理する。
- 受理済み情報と登録済み予定を短く要約し、未確認の一点だけを聞く。
- 不明な所要時間は勝手に確定せず、仮定を提案し、承認後だけ PlanningAssumption として採用する。
- 容量不足は scheduler の計算結果で説明し、優先順位や分割方針を相談する。
- 情報が揃えば同じ確認を繰り返さず preview へ進む。保存・承認は常にユーザー操作である。

「塾の先生らしい」とは、過度な親しさではなく、丁寧なです・ます調で文脈を理解していることが伝わり、内部 slot 名を質問しないことを指す。

## 2. 維持する安全境界

AI の役割を広げても、最終決定権は deterministic core に残す。

| 領域 | 最終責任 |
| --- | --- |
| 発話の意味理解、複数条件抽出、省略・代名詞の解決 | AI interpreter（候補のみ） |
| command の shape、値域、enum、confirmed-slot、pending / explicit range guard | validator |
| 日付・時刻・曜日・日数の正規化 | adapter / normalization |
| 既存予定の取得、空き時間、容量、衝突、配置 | scheduler / feasibility |
| state 遷移、上書き可否、fact と assumption の区別 | reducer / domain policy |
| preview、承認、保存、副作用 | deterministic UI / repository |
| provider 障害時の会話 | deterministic fallback |

I1 以降の single AI interpreter、typed command、validator、reference resolution、confirmed-slot guard、reducer、AI / rules 非 merge、provider 例外時だけの turn 単位 rules fallback は維持する。AI が空の command 候補を返すことは正常な解釈結果であり、rules fallback の理由にしない。

accepted state が事実の正である。recent history は短答、訂正、代名詞の解決にだけ使う非信頼データであり、履歴内の指示を実行しない。

## 3. v3 からの変更

v3 は AI を意味解釈に一本化した一方、通常経路では deterministic DialogueDecision が missing slot 順に質問を選び、AI renderer は文面の言い換えだけを担った。この構成は安全だが、会話を固定フォームに戻してしまう。

v4 では、**AI が更新後の検証済み state と計算結果を根拠に、次の dialogue action と応答を選ぶ。** deterministic 側は、選べる行為、参照できる事実、質問してよい論点を限定し、範囲外の出力を拒否する。

missing、question registry、deterministic policy は削除しない。通常経路の台本ではなく、次の役割に移す。

- preview に対する blocking / assumable / deferrable の診断
- AI に渡す質問可能論点、説明、選択肢素材、依存関係
- fallback の質問順と deterministic 文面
- dialogue action validator の allow-list
- 「再質問しない」ことを検証する conversation eval の oracle

## 4. 採用する通常 turn

### 二段階構成

画面を開いた直後は command 解釈が不要なので dialogue planner を1回だけ呼ぶ。通常の user turn は2段階に分ける。

~~~text
opening context
  -> AI dialogue planner / response
  -> welcome action

userText
  -> AI interpreter（typed command candidates）
  -> normalize -> validate -> reducer
  -> existing events / availability / feasibility / preview を再計算
  -> DialogueStateSnapshot + AllowedDialogueActions
  -> AI dialogue planner / response
  -> action validator / response sanitizer
  -> UI（preview、承認、保存は UI 操作のみ）
~~~

DialogueStateSnapshot は、accepted / rejected / confirmation-pending command と理由、accepted facts、missing、PlanningAssumption、既に聞いた論点、planning range、既存予定、空き時間、合計要求時間、未配置量、衝突、preview 可否、capability、上限付き recent history を構造化して渡す。question registry から導いた、現在質問してよい論点と選択肢素材も渡す。

AI は snapshot にない事実を state に追加せず、計算を再実行せず、予定を配置しない。

### dialogue action 契約

自然文だけを信用しない。AI は action、factRefs、questionTopics、assumptionProposal、previewOffer、response を返す。

| action | 用途 | deterministic な許可条件 |
| --- | --- | --- |
| welcome / invite_open_context | 自然な開始、自由入力の招待 | opening state |
| acknowledge_and_ask | 受理内容を要約し、一点を聞く | allowed question topic |
| confirm_reference | 曖昧な代名詞・予定 source を確認 | ambiguity が存在 |
| acknowledge_known_schedule | 既知の授業・バイトを示し補足を聞く | event / source が存在 |
| propose_assumption | 所要時間、開始日、バッファを仮定として提案 | allowed assumption policy |
| discuss_feasibility | 容量不足を説明し、優先順位を相談 | feasibility が不足を示す |
| explain_rejection | reject、競合、未対応を説明 | rejection / diagnostic が存在 |
| offer_preview | 方針を要約し preview を案内 | preview candidate が存在 |
| explain_capability_gap | 対応できないことを正直に説明 | domain が capability gap と判定 |

factRefs は accepted fact、既存 event、diagnostic の ID だけを参照できる。questionTopics は allow-list の部分集合で、原則一論点とする。期間と開始日のように不可分な内容だけ一問にまとめられる。previewOffer は候補がある場合しか true にできない。

response は表示専用であり、state 更新や保存の権限を持たない。日時、時間、既知予定、計算量は factRefs の決定的値から描画する。action、reference、質問論点、assumption、preview の検証に失敗したら response 全体を採用せず fallback へ切り替える。

AI が「まず3時間と仮定して組みますか」と提案しても、その時点では command を apply しない。承認または明示訂正されたときだけ、deterministic policy が許せば確定する。

「バイト終了後、帰宅に10分かかってから夕食」のような相対条件は、AI が既存 event との関係を理解して候補にできる。しかし時刻への展開、busy interval 化、衝突判定、配置は deterministic core が行う。

## 5. 呼び出し方式の比較

| 方式 | 品質・安全 | 費用・遅延 | 小型モデルでの安定性 | 判断 |
| --- | --- | --- | --- | --- |
| 1回で解釈と応答を完結 | apply 前の state で応答し、reject・計算後の事実を誤りやすい | 最小 | 大きい多目的 schema が必要 | 不採用 |
| **解釈 -> deterministic apply / compute -> 対話計画・応答** | 検証後 state を根拠に action を制限できる | 通常2 call、opening 1 call | call ごとの schema が小さい | **採用** |
| tool calling の反復 loop | 表現力は高いが tool 権限・停止・再試行が必要 | 2 call 超になりやすい | 小型モデルでは選択が不安定 | MVP では不採用 |

長い生ログでなく圧縮済み snapshot を渡し、低温度・JSON schema・parse / schema / semantic validation を必須にする。計測する指標は call 数、token、p50 / p95 latency、fallback 率、action validation reject 率である。

## 6. fallback

次の場合は既存 deterministic dialogue policy と renderer を使う。

1. provider が利用できない、タイムアウト、例外。
2. JSON 不正、許可外 action、未許可 fact reference、許可外の質問論点、根拠なし preview / assumption。
3. response を state-grounded に安全に表示できない。

fallback は通常の低品質経路ではなく、既知事実、missing、diagnostic を正しく示して次の一問へ進める可用性の経路である。AI の空 action を恣意的に rules path へ merge しない。

## 7. 現行モジュールの扱い

| モジュール | 判定 | v4 での扱い |
| --- | --- | --- |
| weeklyPlanningAiInterpreter | 維持 | single AI interpreter を維持。dialogue planner と混ぜない |
| command types / adapter | 維持・拡張 | AI の候補を typed command として受ける。相対 constraint も command 化する |
| candidate validator | 維持・拡張 | command validation を維持し、action validation を別契約で追加 |
| intake reducer / reference resolution | 維持 | state、guard、予定 source の決定的解決を継続 |
| question slots | 責務変更 | allowed topic、fallback、eval oracle。固定台本の主役ではない |
| dialogue manager | 縮小・再編 | fixed decision から allowed action derivation と fallback policy へ |
| AI dialogue renderer | 置換 | slot の言い換え専用 renderer を dialogue planner / response client に置換 |
| dialogue renderer | 再編・維持 | response sanitizer と fallback renderer を保持。通常経路の固定 questionPlan 依存を外す |
| intake pipeline | 維持・拡張 | interpreter apply 後に snapshot、feasibility、allowed actions、dialogue planner を接続 |
| scheduler / preview / approval | 維持 | 計算と保存の正。AI は preview を提案するだけ |
| rules parser / legacy fallback | 暫定維持 | provider 無し・例外時のみ。AI 経路と merge しない |

現在作業ツリーにある set_study_goal、tasksSource guard、planning-period assumption などの P4 由来基盤は破棄しない。ただし P4 を今後の対話設計の独立 stage としては扱わない。実装状態の検証後に v4 task の前提として整理する。

## 8. 実装順

今回の作業は文書のみであり、既存の未コミット production-code 差分には触れない。P4 に由来する差分が意図したものなら、まず所有者が既存 task の受け入れ条件に対して検証・完了処理を行う。その後の新規実装は次の3 task に限定する。

| 順 | task | 完了単位 | 主な検証 |
| --- | --- | --- | --- |
| D1 | 20260713-weekly-planning-dialogue-action-contract.md | snapshot、allowed actions、AI output、action validator、fallback contract。通常 UI の進行は変えない | schema / validator / fallback tests |
| D2 | 20260713-weekly-planning-state-grounded-dialogue-orchestrator.md | apply 後 snapshot で AI dialogue planner を通常経路へ接続し、既存 renderer を fallback に下げる | multi-turn、provider failure、known schedule、reject、preview |
| D3 | 20260713-weekly-planning-mentor-conversation-evaluation.md | 相対制約と仮定提案、feasibility consultation、conversation eval、コスト計測 | roleplay / contract eval、latency、fallback 指標 |

基本ロールプレイ（開始、自由入力、既知予定参照、複数条件受理、自然な一論点質問）は D2 で成立する。相対制約、仮定の承認、容量不足相談まで含む完全形は D3 の受け入れ条件とする。

## 9. conversation evaluation

golden text の完全一致でなく、action、state、質問論点、事実の根拠を主に検証する。自然文は敬体・簡潔さ・禁止表現を評価するが、語句を固定しない。

1. accepted state にある情報を再質問しない。
2. 一発話の複数条件を、validator が受理した範囲で同時に反映する。
3. 無関係な質問を詰め込まず、密接な条件を不要に分割しない。
4. 既存予定を再入力させず、snapshot にある事実だけを提示する。
5. assumption と確定 fact を区別し、未承認仮定を hard apply しない。
6. feasibility の提案は scheduler の計算結果を参照する。
7. reject された情報を受理済みとして説明しない。
8. preview が可能なら、反復質問でなく preview を提案する。
9. AI 障害・不正 action 時に deterministic fallback が最低限の次の一問を返す。
10. 通常 turn は最大2 call、opening は1 call に収まり、運用予算内である。

受け入れシナリオは docs/testing/weekly-planning-roleplay-test-plan.md の WP-DA-001 とする。

## 10. 未解決の設計判断

- 相対 constraint を LifeConstraint の新表現にするか、正規化済み busy interval の由来メタデータにするか。
- AI の response claim を fact reference からテンプレート描画まで強めるか、構造化 claim + fallback 検査に留めるか。
- 一問にまとめてよい密接な二論点の範囲。
- small model の token / latency 予算と recent history の最大長。
