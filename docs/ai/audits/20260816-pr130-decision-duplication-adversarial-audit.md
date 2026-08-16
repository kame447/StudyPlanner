# PR #130 判断重複・会話パイプライン敵対的監査

Status: active / adversarial architecture audit
Updated: 2026-08-16
Branch: `agent/weekly-conversation-quality-luna-audit`
Scope: Markdown audit only. Production code is intentionally unchanged by this audit.

## 1. 監査目的

今回の監査では、コード行数やファイル数そのものを複雑性の指標にしない。最重要指標は「同じ意味の判断を、独立した複数箇所が所有していないか」である。

StudyPlanner 全体については、現時点でも「複雑だが構造化されている」という評価を維持する。Fact Graph、semantic boundary、scheduler、preview、approval、save、persistence の責務は概ね分離されており、アプリ全体をスパゲッティと判定する根拠は確認できなかった。

ただし Stable V5 の会話 orchestration には、過去の段階的な修正を積み重ねた結果として、同一判断の再表現、再推論、再コンパイルが集中するホットスポットがある。PR #130 の次のリファクタリングでは、ここをコード量ではなく decision ownership の一意性で削るべきである。

## 2. 判定基準

単なる値の受け渡しや validation は、同じ意味判断の重複とは数えない。上流の typed decision を下流が検証するだけなら責務分離として妥当である。

一方、下流が上流の typed decision を参照せず、別の状態や別の条件から同じ結論をもう一度導出している場合は重複とみなす。また、同じ会話 action を複数の policy が独立に上書きできる場合も、decision ownership が分散しているとみなす。

この基準で見ると、現在の主な危険箇所は effort question、next conversational action、scheduler readiness、preview authorization compatibility である。

## 3. 最重要所見: effort question の意味が複数層で再導出されている

最も強い重複は「この workload に effort を聞く必要があるか」と「何の時間を聞くか」である。

`src/features/weeklyPlanning/semantic/weeklyPlanningGenericWorkItems.ts` は effort estimate が存在しない workload に `missing_effort_estimate` を発行する。ここは scheduler readiness の観点から質問必要性を決める正当な owner である。

その後 `src/features/weeklyPlanning/semantic/weeklyPlanningEffortQuestionPolicyV5.ts` が page / problem なら `duration_per_unit`、それ以外なら `total_duration` という measurement を決める。ここも measurement policy の owner として理解できる。

しかし memory proposal が accepted された場合、`src/features/weeklyPlanning/application/weeklyPlanningStableV5PlanningEvaluation.ts` は `missing_effort_estimate` を別途手作りし、`session_duration` を要求する。さらに `src/features/weeklyPlanning/application/weeklyPlanningStableV5ResponseRouting.ts` が accepted memory proposal を再検出して `questionIntent: 'session_duration'` を設定し、`src/features/weeklyPlanning/application/weeklyPlanningStableV5CompatibilityState.ts` も questionIntent が明示されていない場合に accepted proposal record から `session_duration` を再推論する。

加えて `src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5DialogueContext.ts` は pending question の measurement がなければ `createWeeklyPlanningEffortQuestionPlanV5` を再実行し、`src/features/weeklyPlanning/semantic/weeklyPlanningStableV5ContextualAnswer.ts` も回答を Fact 化する直前に pending measurement がなければ同じ policy を再実行する。

つまり、質問必要性、measurement policy、memory override、compatibility projection、renderer projection、answer application が一つの typed question contract へ収束しきっていない。独立した policy decision と downstream re-derivation を分けて数えても、少なくとも三つの decision site と複数の再導出 site が存在する。

この状態は現時点で動作していても、将来 `session_duration` の条件を変えた際に一部だけ更新される危険が高い。PR #130 で最優先に ownership を一本化すべき箇所である。

## 4. 高リスク所見: 「次に何をするか」の owner が一段ではない

`src/features/weeklyPlanning/semantic/weeklyPlanningStableDialoguePolicyV5.ts` は blocking issue を priority 順に並べ、baseline の質問を一つ選ぶ。ここは本来、question priority の中心 owner に見える。

一方 `src/features/weeklyPlanning/semantic/weeklyPlanningStableRepairPolicyV5.ts` は deferrable issue を除外した compilation に対して同じ dialogue policy を再利用し、repair question を選ぶ。これは priority logic 自体を複製していないので、単純な重複ではない。ただし planning evaluation では repair question が baseline dialogue を上書きするため、最終 action の ownership は一段増える。

さらに `src/features/weeklyPlanning/application/weeklyPlanningStableV5PlanningEvaluation.ts` は memory session duration question を独自に注入し、repair question より後、baseline dialogue より前の優先順位を持たせている。

その後 `src/features/weeklyPlanning/application/weeklyPlanningStableV5ResponseRouting.ts` は `learningStrategyProposals.pendingProposal` を dialogue より先に処理し、`dialogue.status === 'nothing_to_schedule'` の場合には scheduler issue ではなく Graph を再走査する `stableV5MissingSchedulableWorkQuestion` によって別の質問を生成する。

したがって「次の assistant action は何か」という一つの意味判断が、baseline dialogue、repair override、memory-question override、proposal short-circuit、missing-work fallback の複数段で構成されている。各段の理由は理解できるが、優先順位の全体像が一つの typed decision policy に閉じていないため、追加 feature ごとに if 分岐が積層する構造になりやすい。

ここは現在の会話パイプラインで最もスパゲッティ化しやすい境界である。

## 5. 中高リスク所見: scheduler readiness が同一 turn で二度 compile される

`src/features/weeklyPlanning/semantic/weeklyPlanningSemanticPipelineV5.ts` は canonicalization 後に `compileGenericSchedulerInput` を実行し、`scheduler_ready`、`scheduler_needs_resolution`、`scheduler_empty` を pipeline status として返す。

しかし `src/features/weeklyPlanning/application/weeklyPlanningStableV5SemanticTurn.ts` は provider / normalization / canonicalization failure だけを failure として扱い、scheduler status によって runtime branch を確定しない。

その後 `src/features/weeklyPlanning/application/weeklyPlanningStableV5PlanningEvaluation.ts` は observed pace override、memory proposal、accepted session projection 等を加えた状態で `compileGenericSchedulerInput` を再実行し、こちらの compilation を dialogue と preview の実質的な判断材料として使う。

同じ compiler を使っているため実装ロジックの複製ではないが、同一 turn に scheduler readiness が二種類存在し得る。前者は semantic pipeline の status、後者は enriched planning evaluation の authoritative compilation である。

この二重化は trace を読む人間に「どちらが正本か」を考えさせる。前者が diagnostics 目的だけなら status として持つ必要性を再検討し、production decision の owner を planning evaluation 側へ明示的に一本化した方がよい。

## 6. 中リスク所見: preview authorization は責務分離されているが representation が多い

raw user text が draft 作成許可だけを意味するかは `src/features/weeklyPlanning/semantic/weeklyPlanningFocusedAuthorizationV5.ts` の AI semantic route が分類する。これは semantic ownership として妥当である。

実際に preview を作ってよいかは `isWeeklyPlanningStableV5PreviewAuthorized` が `planningIntent`、previous status、previous `draftGenerationIntent`、semantic change、machine pending question を使って決める。ここも application decision として妥当である。

問題は、その結果を `src/features/weeklyPlanning/application/weeklyPlanningStableV5CompatibilityState.ts` が再び `draftGenerationIntent: 'user_authorized'` として durable compatibility state へ投影し、次 turn の authorization 判定がその compatibility state を再入力として使う点である。

この構造は legacy compatibility を保つ目的として理解できるが、`planningIntent`、`authorized`、`draftGenerationIntent` が同じ概念に近接しており、将来の変更時に authority が曖昧になりやすい。削除を急ぐ必要はないが、compatibility state は source of truth ではなく projection であることを contract 上さらに明示すべきである。

また `evaluateWeeklyPlanningStablePreviewGateV5` という別 gate abstraction も存在する。少なくとも main 側の repository search では production call site が明確ではなく test 中心に見えるため、PR #130 のコード変更を再開する際に branch HEAD で reachability を確認する。未使用なら「安全 gate が二つある」という誤った mental model を残さないよう整理対象にする。

## 7. renderer regex は raw-user semantic parser と同列に扱わない

`src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5DialogueValidation.ts` には clock、date、preview count、execution claim を検出する regex が残っている。

これは raw user text を semantic truth として再解釈する Issue #115 型の parser とは性質が異なる。AI renderer が typed application decision にない時刻・日付・実行済み claim を発明していないかを見る output guardrail であり、現時点で即時削除すべきとは判断しない。

ただし Japanese wording に依存する heuristic であることは事実なので、Luna で十分な typed-output safety を確保できるか one-element ablation の対象にする価値がある。削除判断は「regex が嫌だから」ではなく、実API failure rate と fallback quality を観測して決める。

## 8. prompt 肥大化は現時点の主因ではない

`src/features/weeklyPlanning/semantic/weeklyPlanningSemanticMeaningPolicyV5.ts` と `weeklyPlanningSemanticPromptAssemblyV5.ts` を確認した限り、semantic prompt は現在かなり一般原則へ寄っている。特定の日本語完成文を大量に並べる構造ではない。

`src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5DialoguePrompt.ts` も application decision、decided facts、undecided items、grounding context を渡し、自然な日本語 realization を Luna に任せる構造になっている。

また PR #130 の差分では、`weeklyPlanningStableV5DialogueRouting.ts` に存在した explanation-request 判定 regex と「通常 question は固定 renderer、説明要求だけ AI renderer」という分岐が削除されている。これは過去の応急処置を減らす方向として正しい。

したがって、現在の問題を「prompt が長すぎるから」とだけ捉えるのは誤りである。次に削るべき中心は prompt 文量より decision ownership の重複である。

## 9. 文書側の不整合

`docs/ai/weekly-planning-docs-index.md` は 2026-08-14 の PR #129 を current phase として残しており、PR #130 の current contract / task / grounding policy へ導く入口として古い。

`docs/ai/codex-task-guide.md` は `Status: active` のまま V4 architecture を正本として参照している。現在の Stable V5 sole-runtime contract と矛盾するため、実装判断の入口として利用してはいけない。

さらに PR #130 本文は `Closes #115` を含む一方、current roadmap と current status は Issue #115 の raw-text regex entry routing を別 scope としている。PR metadata の問題なので今回の Markdown-only 変更では PR 本文を変更しないが、merge 前に整合させる必要がある。

## 10. 現在の architecture 判定

現状を一文で表すと、StudyPlanner は「複雑だが構造化されている。ただし weekly-planning conversation orchestration の decision ownership に局所的な重複がある」である。

Graph、semantic、scheduler、preview、approval という大きな層は分かれているため、全面的なスパゲッティではない。危険なのは、feature を増やすたびに planning evaluation と response routing の間へ例外的な question / proposal branch を追加し続けることである。

今後のリファクタリングでは「ファイルを小さくする」「行数を減らす」より先に、各 decision について source of truth を一つ決める。

```text
semantic meaning
→ canonical typed state
→ one application decision owner
→ immutable typed decision
→ renderer / compatibility / trace は再推論せず投影
```

この形から外れ、下流が別の state から同じ意味を再導出している箇所を優先して削る。

## 11. 次のリファクタリング順序

最優先は effort-question contract の一本化である。question necessity、measurement、target、proposal-derived override を一つの typed decision にまとめ、response routing、compatibility projection、renderer context、contextual answer がそれを再推論しない形を目標にする。

次に next-action orchestration を一つの policy に寄せる。repair、proposal、missing information、authorization、preview readiness の優先順位を一つの typed action decision として確定させ、router は action を実行するだけにする。

その次に semantic pipeline 内の scheduler compile と planning evaluation 側の authoritative compilation の二重性を整理する。semantic pipeline 側が diagnostics 用ならその役割を明記し、不要なら除去候補とする。

その後、preview authorization compatibility state の projection 性を明確化し、最後に renderer regex guardrail と focused semantic routes を Luna one-element ablation で評価する。

Issue #52 の大規模 weekly UI 責務分離と Issue #115 の raw-text regex entry routing はこの監査の実装 scope に混ぜない。

## 12. 今回の変更境界

この監査では production code、test code、workflow、configuration を変更しない。変更対象は Markdown のみである。

次のコード変更 loop に入る前に、この audit を PR #130 の task、current status、docs index から参照できる状態にし、以後は「同じ意味の判断が何箇所にあるか」を refactor acceptance の主要指標として使う。
