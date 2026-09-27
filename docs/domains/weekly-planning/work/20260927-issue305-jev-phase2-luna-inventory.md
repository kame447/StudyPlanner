# Issue #305 第二段階 — Luna 責務の再棚卸しと次の置換単位の判断

Status: 判断記録（runtime 変更なし）/ 次候補 C9 は前提条件が未充足
Updated: 2026-09-27
Tracking: Issue #305（品質証拠 #333、安全性回帰 #335、memory rerank は #294 で別 purpose）

## 結論

置換単位1〜5（#337〜#341）の後に、`origin/main` `07498d78` の実コードから Luna の呼出し経路を再度すべて辿った。その結果、この cycle で Jev の bounded closed-set judgment へ移せる単位は**なかった**。runtime、`JEV_MODE=off`、`JEV_CANARY_PERCENT=0` は変更していない。

- 採用：なし
- no-go：effort tuple の categorical head（C1）、effort question 中の quantityRole（C1'）、no-op completeness の確認 gate（C3）、user context の kind（C8）、user context の編集 routing（C6）
- 保留：provisional_timebox（C2）、dense turn audit の complete（C4）、閉じた選択肢を持つ pending question（C5）
- 次候補（前提条件つき、未実装）：提示済みの学習方略 proposal 一件への純粋な reject（C9）

独立監査は ProudMaxwell（Codex gpt-6-astra）が行った（Orrery Mail #1796、#1797、#1799）。C3 を当初の最有力候補としていたが、監査の P1 指摘3件と P2 指摘1件を受け入れて no-go とした。C9 は監査側が提案した候補である。その後の自己反証（提示時の binding がない、collective reject、採算が未証明）を受け入れ、実装前の前提条件として残した。Jev で理論上判断できることは、採用の理由にしていない。

## 棚卸しの方法と範囲

`weeklyPlanningSemanticNormalizerV5.ts` の `normalize()` における呼出し順（focused contextual（retry を含めて最大2回）→ focused authorization → generic initial → dense audit →（incomplete の場合）文書全体の再生成 → no-op completeness retry → focused repair → generic repair →（repair 後に no-op になった場合）no-op completeness retry）と、Worker の purpose（`workers/ai-proxy/src/modelPolicy.ts` の `AI_CHAT_PURPOSE_MODELS`、`worker.ts` の `classifyFocusedDecisionContext`）を辿った。user-context の経路（`interpretUserPlanningContextNaturalLanguageV2`）と renderer の経路も対象にした。#246 の TurnPurpose（`consultation/`）は model を呼ばない dormant foundation なので、現行の Luna 削減には数えない。BehaviorAware の dialogue planner は別の optional pipeline であり、Stable V5 renderer と二重に数えない。

表の「済」は、Jev 第一経路を実装し、テスト環境で評価したことを表す。本番では `JEV_MODE=off` / canary 0 であり、本番で置換されたことを意味しない。

| 経路（file / function） | 出力 | 1) deterministic / parser | 2) Jev の閉集合判断 | 3) Luna に残すもの |
| --- | --- | --- | --- | --- |
| `tryFocusedContextualAnswerRouteV5`（`weeklyPlanningSemanticFocusedPreRoutesV5.ts`。contract は `weeklyPlanningFocusedContextualAnswerV5.ts`） | decision + effortTarget / effortMeasurement / minutes / precision / quantityRole | eligibility、exact target への binding、document の構築 | quantity role、definite fallback（#338 で済） | effort tuple 全体、provisional_timebox、dual-target retry |
| `tryFocusedAuthorizationRouteV5` | create_plan / fallback | eligibility、document の構築 | 済（#337） | 保留・境界の判断 |
| generic initial（`run.callGeneric`） | 文書全体 | validator、canonicalizer | — | 開集合の抽出 |
| dense turn audit（`weeklyPlanningSemanticDenseTurnCompletenessV5.ts`） | complete / incomplete + missingFacts（自由文）。incomplete の場合は文書全体を再生成し、無効なら generic repair へ進む | 対象の判定（byte 数） | C4（保留） | missingFacts、完全性の判断、再生成 |
| no-op completeness retry（`weeklyPlanningSemanticNoOpCompletenessRetryV5.ts`） | Luna の focused temporal（その前に置く Jev gate は #341 で不採用）→ generic retry 最大2回 | eligibility | C3（no-go） | 文書全体の再生成 |
| focused repair：user context の日付、planning window（`weeklyPlanningFocusedUserContextDateRepairV5.ts`、`...PlanningWindowRepairV5.ts`） | ISO 日付・範囲 | typed な日付計算、canonical start/end → value | — | 相対日付の解釈（生の日本語文を regex で決定論化しない） |
| focused repair：temporal scope | plan_unavailable / uncertain | eligibility、typed patch、参照を保った再検証 | 済（#340） | 保留した判断 |
| generic repair（`weeklyPlanningSemanticGenericRepairRouteV5.ts`） | 文書全体。repair 後に no-op になった場合は no-op completeness retry へ進む | validator | — | 全体 |
| `interpretUserPlanningContextNaturalLanguageV2` | targetDomain / kind + label / value / displayText | 保存・lifecycle | 新規入力の external domain（#339 で済） | kind、自由文の field、編集 |
| Stable V5 renderer（`weeklyPlanningStableV5AiDialogueRenderer.ts`。初回と、`repeated_question_text` / `grounding_contract_mismatch` の場合の repair 1回） | actionId / actionKind（決定的な選択の echo）+ text | action の選択、応答の検証 | — | 文章の生成 |
| BehaviorAware dialogue planner（別の optional pipeline） | 同上 | 同上 | — | 文章の生成 |
| Worker の planning attachment（`weekly_planning_attachment`。Luna と同じ internal model の vision） | 添付の読み取り | — | — | 画像の読み取り |
| Worker の timetable OCR（Gemini）/ planning transcription（別の transcription model） | 文字起こし | — | — | Luna とは別の model・purpose なので、Luna 削減の対象外 |

## 候補ごとの判断

### C1 / C1' effort tuple の categorical head（no-go）

`effortTarget`、`effortMeasurement`、`precision` は、`minutes` と同じ tuple の意味である。`minutes` は開いた自然言語の数値抽出なので Luna が持ち、categorical head を Jev に分けても Luna の呼出しは減らない。`effortMeasurement` は minutes の換算方法（1単位あたりか合計か）と不可分で、`precision` は minutes の表現の精度そのものである。分けると、一つの意味に owner が二つできる。dual-target の retry（`DUAL_TARGET_CONTEXTUAL_REPAIR_INSTRUCTION`）も、minutes を得るには Luna が必要である。Jev を verifier として足す案は、呼出しが増えるだけになる。effort question では parser が `quantityRole=null` を強制しているので、quantityRole に未分離の部分は残っていない。

### C2 provisional_timebox（保留）

効果は「一問に対する二択」より広い。`resolveWeeklyPlanningProvisionalTimeboxV5` は `currentMissingEffortWorkloadFactIds` 全体に適用され、`projectWeeklyPlanningProvisionalTimeboxGraphV5` は workload が未登録の task にも投影する。さらに `provisionalTimeboxRequested` は、`isWeeklyPlanningStableV5PreviewAuthorized` で preview の許可を true にする。scope の containment が証明されるまで、Jev へは移さない。

### C3 no-op completeness の確認 gate（no-go）

案：pending question があり、initial generic が schema-valid な no-op だったとき、Jev が「supported な新規 proposition はない」と高確信した場合に retry（focused temporal 1回と generic 最大2回）を省く。

no-go の理由（監査の P1×3、P2）：

1. **context の同値性がない。** 現行の Luna は `createWeeklyPlanningSemanticBaseMessagesV5` を通じて、supplementalContext、selectedStarterTarget、recentConversation、registered materials を含む publicStateSummary を読む。user text と pending question の最小情報だけでは、「前の方で」「残り全部」のような new meaning の有無を決められない。
2. **no-op を受理しても影響がないとは言えない。** eligibility は planningIntent を検査しておらず、preview の許可は previousDraftGenerationIntent などに依存する。pending question を再度聞いても、同じ発話で横に述べられた訂正・予定不可・拒否が落ちたことは回復しない。initial no-op は、まさに難しい例に偏った分布である。
3. **評価で回収機構を反証できない。** 人工の no-op を replay しても、実 Luna が no-op にした入力に対する Jev の誤受理率は測れない。#341 の post-no-op の実測値は、受理1件あたりの削減額として全対象へ当てはめられない。

扱い直すなら、実 initial no-op の分布、context-rich な対照ペア、full-turn の paired 採点（再質問を成功と数えず、全 proposition の保存を採点する）を先に用意する必要がある。

### C4 dense turn audit の complete（保留）

本質は、「supported な命題がすべて揃っている」という普遍的な semantic claim と、自由文の missingFacts にある。文書を bounded な長さにしても解消しない。不確実な判定を incomplete に強制して現行の audit を飛ばすと、repair の契約が変わる。

### C5 閉じた選択肢を持つ pending question（保留）

対象は `conflicting_task_date_rule`、`constraint_source_unavailable`、`ambiguous_effort_estimate`、`ambiguous_planning_window`、`orphan_relation_task` / `self_relation`（`renderStableV5RuntimeQuestion`）。現在は generic Luna が回答を文書として encode している。`ambiguous_effort_estimate` で既存の完全な tuple を候補 ID で選ぶ形なら、C1 と違って意味の owner を割らない余地がある。ただし、現行の pending は候補 set と提示順を保持しておらず、選択から supersession への contract もない。発生頻度は未計測である。

### C6 / C8 user context の編集 routing と kind（no-go）

C6：編集の発生頻度、削減率、net の便益はいずれも未計測である。既存 record の文脈を含めた独立の評価もないため、今回は採用の対象外とした（新規入力の routing の 10.9% からは推定できない）。これは今回の案に限った判断であり、原理的に不可能だという意味ではない。
C8：label、value、displayText の生成が残るので、Luna の呼出しは減らない。

### C9 提示済み proposal への純粋な reject（次候補・未実装）

`learning_strategy_proposal` が pending のとき、自由文の返答は、generic Luna の初回の呼出しで `document.decisions`（`target.kind=proposal`）に encode されている。UI に quick-reply はない。検討した仕様は次のとおりである。

- **choice set：** Choice は `reject` / `luna`。Noul は `condition_change` と `independent_meaning`。accept、modify、defer、質問、条件付きのもの、混在、曖昧なものはすべて `luna` とする。accept は危険指標を分けたうえで別途扱う。
- **最小 context：** currentUserText、提示文、proposal の kind と suggestedSessionMinutes。option key と proposal.id の対応は client が持つ。
- **受理時の構築：** 既存の統合テストの `proposalDecisionDocument`（`weeklyPlanningHumanScaleConversationIntegrationV5.test.ts`）と同じ形（planningIntent=discuss、decisions は1件で reject）を client が決定的に構築し、既存の validator と canonicalizer を通す。
- **fallback：** abstain、障害、stale の場合は通常の generic Luna。

実装に入れない理由（監査 #1799）：

1. **提示時の freshness を証明できない。** `pendingQuestionFromState` は、提示時の revision ではなく現在の `graph.revision` を設定する。proposal の projection は `createdRevision` / `proposedAtTurnId` を含まない。`lastAssistantMessage` は最後の assistant 発話を検索しているだけである。proposal には作成 turn（`proposedAtTurnId`）がある。しかし、実際に提示された message / turn、その turn で描画された action の集合、そのときの revision を関連づける契約がない（`renderedActionIds` を扱うのは BehaviorAware pipeline だけ）。
2. **actionId が1件に一致しても、提示・参照された対象が一つとは限らない。** 「全部やめる」「前の案はやめる」「数学の方はやめます」「やめないで」がある。既存の validator は、side decision を pendingQuestion へ束縛しないことと collective consent を明示的に許している（`weeklyPlanningIssue152DecisionApproval.test.ts`）。したがって `independent_meaning` の定義には、他の proposal への decision と collective reject を含める必要がある。また、task label まで削ると、意味を識別する情報が足りなくなる可能性がある。
3. **提示文は untrusted である。** renderer は副次的な質問や grounding を並べて記述できるので、同じ「いいえ」でも否定している対象が変わる。formal な binding は machine metadata が持つ必要がある。
4. **誤 reject は blocking 指標である。** 同じ workload / kind には自動で再提示されず、reject が持続する（`createInitialMemoryProposal`、`existingCapacityProposalForWorkload`）。
5. **採算が未計測である。** eligible な turn のうち pure reject が占める率、Jev の直接受理率、abstain 時に直列で加わる Jev の latency と費用、dense / repair / renderer を含む end-to-end の差分が分かっていない。

着手の前提条件：

- (a) 提示された message / turn・action・revision を機械的に結びつける binding の契約を設計し、保存・復元の互換性を確認する。そのうえで、非同期応答の受理時に current state と target の active / supersession を再検証する。解法は新しい state field に限らず、既存の履歴への typed な参照なども候補になる。saved-data に関わる場合は、別の release unit とする。
- (b) 最初は単一の kind に限定し、未知の kind は fail closed にする。
- (c) 評価 corpus は tuning 前に封印する。層として、stale / duplicate / rebased target、複数 pending、collective reject、別 proposal だけの reject、省略した履歴だけが異なる minimal pair、否定疑問・二重否定・引用、reject と correction / availability / approval の混在、injection を含める。Jev の直接誤 reject と他の proposition の欠落を、fallback を含む最終結果とは別に採点し、次の turn（提案の消失、state、preview）まで見る。
- (d) eligible な turn での pure reject 率を実測し、net expected cost（全 eligible に加わる Jev 費用 − 実際に省いた Luna 費用 + downstream の差分）と paired end-to-end latency の基準を事前に決める。

#335 の不変条件（どの候補を実装する場合にも適用する）：Jev の応答は閉じた decision にしか写像しない。canonical ID、approval、save、scheduler の許可、lifecycle を付与しない。stale な応答や correlation の不一致は棄却する。injection、Unicode、role confusion は Luna へ戻すか、無害な閉じた出力に収める。Jev の障害時は実 Luna の fallback が動く。ここで Choice と Noul は同じモデルに由来して相関しているので、独立した安全層とはみなさない。

## 評価と label の扱い

この cycle では有料 API による評価を実行していない。holdout も開封・消費していない。synthetic label や限定 judge を human gold とは呼ばない。消費済みの holdout を再校正には使わない。誤りゼロで片側95%上限を 1% 未満にするには独立した negative が 299 件、0.5% 未満なら 598 件必要であり、言い換えは独立標本と数えない。

## 次の具体作業

1. C9 を進める場合は、上の前提条件 (a) の binding 契約を、owning Issue（#305、または保存 state の owner）で先に決める。
2. C3 を扱い直す場合は、実 initial no-op の分布を収集する方法（#213 の typed telemetry で、raw text を保存せずに route の件数を数える）を先に決める。C4 を扱い直す場合は、dense audit の対象となる実入力と候補文書のペアを、評価の前提として別に用意する。
3. 本番の canary の条件は、#305 の既存の checkpoint から変わっていない。
