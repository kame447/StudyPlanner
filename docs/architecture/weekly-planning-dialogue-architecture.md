# weeklyPlanning 対話アーキテクチャ(親設計 v2: draft-first / progressive refinement)

**ステータス: 設計の正(design of record)。** v1(2026-07-10 午前)は「対話の入口・grounding・語彙の欠落」を直す段階設計だった。**v2(2026-07-10 改訂)は最上位思想を修正する**: 週間計画の目的は必要情報を集め切ることではなく、**得られている情報 + 既存カレンダー・時間割 + 既定値 + ヒューリスティック scheduler で、可能な限り早く有用な仮予定を提示し、preview を対話の材料として反復改善すること**である。

- 基本ループ: **理解 → 必要最小限の仮定 → 仮予定生成 → preview → ユーザーの修正 → state 更新 → 再計画**
- v1 の成果(grounding / entry intent / 語彙 / taxonomy)は破棄しない。**「missing 解消 → 条件充足 → draft」を通常系とする接続だけを差し替える。**
- 関連: `weekly-planning-nl-capability-model.md`(capability 分離・診断原則)/ `docs/ai/strategy/weekly-planning-dialogue-design-review.md`(実測調査)/ spec §5–6(質問しすぎ防止)・§10(仮表示と承認)・§13(最終方針)
- 本文書は Codex に直接渡さない。実装単位は §7 の task md。
- 最終更新: 2026-07-10(v2)

## 1. v1 からの思想修正(なぜ変えるか)

v1 は「質問が出せない・答えを受理できない」という欠落を直す設計であり、その修正自体は正しい。しかし v1 の decision 接続は既存実装と同じく **slot filling を通常系**としていた:

```text
(現状・v1 とも) missing が1つでもあれば質問 → 全 slot 充足 → draft request → preview
```

これは spec §6(質問するべき度 = 影響×不確実性−コスト)と §13(聞きすぎない・仮置きして最後にまとめて承認)の思想に反する。**missing であることと、いま質問すべきであることは別**である。既存実装には仮定を表現する語彙(`assumptions: string[]` / `UnitRateEstimate.source: 'assumption' | 'default'` / `PlanningRange.confidence: 'inferred'` / dry-run diagnostics)が既に存在するのに、dialogue policy がそれを使っていない。

## 2. 中核原則(v2)

1. **preview は成果物ではなく対話の材料。** 初回から完全な予定を作ることを目標にしない。修正されることを前提に early preview を出す。
2. **slot は3分類で扱う**(名称は実装候補。分類は T5 registry の slot 定義に持たせる):
   - `blocking`: 無いと意味のある仮予定を生成できない(例: 学習対象が皆無、期間 scope が実日付に解決不能)。→ 質問する。
   - `assumable`: 既定値・既存アプリ情報・ヒューリスティックで合理的に仮置きできる(例: 単位あたり所要時間、優先順、対象年度(総数既知)、生活制約の既定枠、scope 内の開始日)。→ 仮置きして preview を出し、仮定を追跡する。
   - `deferrable`: 初回 preview に不要で、結果を見たユーザーの修正で改善される(例: 進捗ゼロ仮定、細かな優先度)。→ 聞かない。
3. **質問するのは次の場合を中心**: (a) blocking が残る、(b) 合理的な仮定候補が複数あり選択で予定結果が大きく変わる。質問は preview と同時に添えてよい(preview を止めない)。
4. **仮定は構造化して追跡する**(どの slot を・何で・なぜ仮置きしたか)。確定事実と区別して応答・summary に反映し、後続の修正発話で置換できる。全部を長文で説明はしない。
5. **deterministic の防衛線は不変**: scheduler・busy interval・duration 計算・hard constraint validation・値域検証・range/pending guard・confirmedSlots・保存・承認・副作用。AI は配置と保存の最終決定をしない。
6. **AI の役割**は「parser 失敗時の command 分類器」から「対話状態・capability・仮定・preview 結果を踏まえた意味解釈と応答支援」へ広げる。ただし解釈結果は従来どおり validator/reducer を通る。

## 3. 目標ループ(モジュール対応)

```text
userText
→ 解釈: deterministic parse + AI interpretation(grounding 済み・S1)
→ 適用: validator → reducer(不変)
→ 仮定合成(deterministic・新設): blocking が無ければ、assumable slot を
   既定値/導出値で埋めた「仮定つき draft request」を合成(state は汚さない)
→ dry-run 生成(既存 generator・不変)+ diagnostics
→ dialogue policy(改訂): preview があれば preview 提示を主応答にし、
   必要なら質問を1件まで添える。blocking 残なら従来の質問。
   preview 不能の理由は taxonomy で区別(開始前 / 機能未対応 / 配置不能 / 真の矛盾)
→ 応答生成: 受理事実 + 仮定の要点 + preview 案内 + 修正の招待(deterministic 文言 → 将来 AI 化)
→ preview 表示 / 承認・保存(既存 flow・不変)
→ 次ターン: 修正発話(「数学多め」「水曜は研究室」「今週じゃなく来週」)
   → command 適用 → 仮定の置換 → 自動再計画(毎ターン dry-run 再計算は既存挙動)
```

再利用できる既存資産(調査確認済み): dry-run は毎ターン再計算されており「再計画」は実質実装済み。preview 導線・個別削除・一括承認は完成済み。diagnostics(unscheduled / conflicts / totalMinutes)は decision summary へ流れている。`assumptions` は renderer の acceptedFacts/summary に表示される。**欠けているのは「仮定合成」と「decision の優先順位」だけ**である。

## 4. 例に対する到達挙動(判断基準)

- 例1「来週、院試の過去問を数学を含む5分野で7年分進めたい。数学を多めにやりたい」: exam prep scope の分野と総年数が既知で、所要時間・年度の実範囲・睡眠等が未指定でも、時間割・既存予定の回避(稼働済み)+ 既定 session 枠 + 単位時間の既定値 + 数学優先(明示)で仮予定を提示。開始日が「来週」内で未確定なら scope 先頭日を仮定し、preview と同時に開始日希望を1問添える。
- 例2「数学のテスト勉強をしたい」: 期間は現在日時から既定 7 日を仮定。非 exam のため候補生成には §7 P5(bridge)が必要 — それまでは正直に「目標は受理した・候補生成は過去問型のみ対応」(taxonomy)+ 期間/量の質問。P5 以降は暫定量で preview。
- 例3「来週どう勉強するか決めたい」: 対象が皆無 = blocking。質問から始める(従来どおり)。

## 5. 責任境界(v2 での変更点のみ)

| 責務 | v1 | v2 |
|---|---|---|
| 仮定の合成(既定値・導出) | 規定なし | **deterministic の新設層**(intake)。AI に仮定値を決めさせない |
| 質問の要否 | missing = 質問 | **preview 可否と仮定可能性で決定**(dialogue policy) |
| preview の位置づけ | 全条件充足後の出口 | **対話の中心材料**(decision の第一候補) |
| AI interpreter | 解釈(S1 grounding 済み) | 同左 + 修正発話を「仮定/直前 preview への修正」として解釈(P6) |
| renderer | 質問文の言い換え | 将来: preview 提示 + 仮定要約 + 修正招待を1応答に(P7) |

不変: parser 唯一の自然言語層 / validator の防衛線 / reducer guard / scheduler / 保存・承認 / `shouldSavePlan: false`。

## 6. 主要設計判断

1. **仮定は state に書き込まない。** `createAssumedWeeklyDraftRequest(state, context)`(名称候補)が「仮定つき draft request + 構造化仮定リスト」を返す純関数とし、確定 state と仮定を型で分離する。ユーザーが仮定を確定・修正したときだけ通常の command 経路で state 化する。
2. **分類と既定値は T5 registry に載せる。** slot ごとの `previewPolicy`(blocking/assumable/deferrable)と assumable の合成規則を registry で一元管理(planning_start_date の登録漏れ事故の再発防止)。
3. **仮定の追跡型**(候補): `PlanningAssumption { slot; source: 'default' | 'derived'; description }`。pipeline output と decision summary に流す。既存の `assumptions: string[]`(確認系の注記)とは別物として持ち、表示時に統合する。
4. **preview と質問の共存**: `offer_dry_run_preview` decision が questionPlan(最大1)を持てるようにする。質問対象は「選択で予定が大きく変わる assumable slot」(spec §6 の影響基準)。
5. **開始日の仮定と temporal guard の整合**: pending scope の実日付が既知(来週)の場合のみ scope 先頭日を仮定に使う。**state.range は書き換えない**(hard apply 禁止の既存原則維持)— 仮定は draft request 側にのみ現れ、ユーザーが開始日を答えたら通常経路で確定する。実日付不明の named period(夏休み)は blocking のまま。
6. **AI 常時解釈(旧 Stage 6)とコスト**: preview 中心化で「修正発話の解釈」が主戦場になるため、escalation 緩和の価値が上がる。ただしコスト判断が必要なため独立 stage のまま(P8)。

## 7. 実装計画(v2 再構成)

| # | 内容 | 状態 | task md |
|---|---|---|---|
| 済 | T1〜T3(guard/confirmedSlots/AI range 正規化)、T4(clarification 直交化)、S1(grounding)、T5(slot registry) | **実装済み・検証済み**(439 tests green) | closed 参照 |
| P1 | **仮定合成層**: registry へ previewPolicy + 合成規則、`createAssumedWeeklyDraftRequest`、`PlanningAssumption`、pipeline output への露出(**挙動中立** — decision は未変更) | 発行済み | `20260711-weekly-planning-preview-policy-stage1-assumption-synthesis.md` |
| P2 | **preview-first decision**: blocking 残のみ質問 / 仮定つき dry-run があれば preview 主応答 + 仮定 summary + 質問1件添付 | 発行済み | `20260711-weekly-planning-preview-policy-stage2-preview-first-decision.md` |
| P3 | 開始 intent + taxonomy 分離(旧 Stage 2 を v2 前提で改訂) | 発行済み(改訂) | `20260710-weekly-planning-dialogue-stage2-entry-intent-decision-taxonomy.md` |
| P4 | 学習目標受理 + fallback 保護(旧 Stage 3。goal は blocking 解消の中心語彙) | 発行済み(改訂) | `20260710-weekly-planning-dialogue-stage3-goal-acceptance.md` |
| P5 | **非 exam preview bridge**: tasks → 暫定量つき work items → 既存 generator(D2 の会話+preview slice。unitKind 全面一般化 = R3 本体はしない) | 未発行(P2・P4 後に切る) | — |
| P6 | preview 起点の修正 acts(corrects/answers envelope + DialogueContext Tier 2 + 仮定置換) | 未発行 | — |
| P7 | AssistantActPlan / renderer 一般化(preview 提示・仮定要約・修正招待を AI が1応答に) | 未発行(P2 と T5 後) | — |
| P8 | 解釈カバレッジ(常時解釈 + マージ、コスト判断) | 未発行 | — |
| P9 | dialogue contract suite(§8)+ T6 統合実行 | 未発行(最後) | — |

**推奨順: P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 → P9。** P1/P2 が思想転換の本体で、exam prep 経路(既存 generator)だけで例1を成立させる。P3/P4 は v1 から機構をほぼ流用(接続先の記述のみ改訂済み)。旧 Stage 4〜7 は P6〜P9 に読み替え(番号のみ変更、未発行のため文書更新は本表で完結)。

## 8. dialogue contract(v2 版)

契約は「会話が成立しているか」を pipeline レベルで固定する。assertion は decision kind / questionPlan / 仮定リスト / state 事実を主とする。

1. 対象すら不明な開始発話は質問から始まり、generic failure に落ちない。【P3】
2. 目標 + 期間 scope が分かれば、追加質問の完了を待たずに初回 preview を提示できる(例1)。【P1+P2】
3. 未指定 slot が assumable のみなら質問の連鎖をしない。質問は preview と同時に最大1件。【P2】
4. 仮定は構造化追跡され、応答で確定事実と区別され、修正発話で置換 → 再計画される。【P1+P2+P6】
5. 一度伝えた目標・事実は保持され再質問されない。【済(T1/T2)+P4】
6. 直前質問への短答・訂正が文脈付きで解釈される。【済(S1)+P6】
7. 1 turn の複数情報が部分処理で失われない。【済(T4)+P8】
8. AI が空結果・低信頼でも「条件矛盾」に落ちず次の行動を案内する。【P3】
9. 未対応機能は入力矛盾ではなく「できる/できない」の説明になる。cannot_create_draft は真に作れない状態に限定。【P3(P5 で範囲縮小)】
10. AI renderer は事実・仮定を捏造せず、仮定を確定扱いしない。【既存 sanitize + P7】

## 9. 既存文書・タスクとの関係

- **v1 の本文書**: 本 v2 が置き換え(git 履歴が経緯)。v1 の Stage 1〜3 の成果と md は継続(S1 済み、Stage2/3 = P3/P4 として改訂済み)。
- **T6**(multi-slot regression・open): 継続。P9 と統合実行。
- **backlog D2**: P5 が「会話 + preview」slice を先行消化(backlog 側に反映済み)。remaining work items / unitKind の本一般化は R3 のまま。
- **roadmap**: R4(質問計画)の「質問するべき度」は本設計の previewPolicy/質問添付規則として先取りされる。R8(capacity/6等分)は preview 品質改善としてこの後に接続する。
- **capability model**: 変更なし(GoalIntent 方針・診断原則は v2 でも有効。G 分類の追記提案は据え置き)。
