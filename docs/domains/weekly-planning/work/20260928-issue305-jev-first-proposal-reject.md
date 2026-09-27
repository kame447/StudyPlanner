# Issue #305 第三段階 — C9 提示済み proposal への純粋な reject（Jev 第一経路）

Status: 実装中 / 評価設計を事前登録済み（tuning 前）
Updated: 2026-09-28
Tracking: Issue #305（前提条件 (a) は #348 の binding 基盤。棚卸しと no-go の記録は `20260927-issue305-jev-phase2-luna-inventory.md`）
Production rollout: 変更しない（`JEV_MODE=off`、`JEV_CANARY_PERCENT=0`、deploy しない）

## 範囲と安全境界

`spaced_memory_practice`（分散学習の提案）の pending な proposal が一件だけ提示されている turn に限る。対象の判断は、ユーザーの返答がその proposal だけを断る純粋な reject かどうかである。

- **Jev の出力**：閉じた `reject_only` / `other` の二択だけである。受理されるのは `reject_only` に限る。
- **受理時の処理**：client が次の document を決定的に構築し、既存の validator と canonicalizer を通す。
  - planningIntent=discuss
  - decisions は1件で、binding された proposal の ID への reject
  - その他は空
- **Jev の権限**：Jev は canonical ID、approval、save、scheduler、lifecycle のいずれにも権限を持たない。proposal ID は provider に送らない。
- **経路**：
  - client は generic Luna の初回 request（`weekly_planning_semantic_normalizer`）に、`proposal_response` の decisionContext を添付する。
  - Worker は canary に選ばれたときだけ Jev を先に呼ぶ。
  - off、shadow、非選択、abstain、障害の場合は、同じ request のまま generic Luna を実行する。したがって off 時の追加の往復はない。
  - shadow の場合は、Luna の document を「純粋な reject かどうか」に分類し、Jev の判定と並べて記録する。これにより、本番での pure reject 率（#347 の前提条件 (d)）を、応答を変えずに測れる。
- **eligibility**（すべて machine state で判定し、ユーザーの文は大きさしか見ない）：
  - #348 の binding が `fresh` で、同居がない（`isWeeklyPlanningQuestionPresentationUnaccompanied`）
  - 質問が `learning_strategy_proposal` である
  - pending の proposal がちょうど1件で、binding の actionId と一致する
  - kind が `spaced_memory_practice` である
  - task と workload が active である
  - 添付も starter もない
  - ユーザーの文は 600 byte 以下、提示文は 2,000 byte 以下
- **fail closed**：受理した判定が validator を通らない場合、または相関（requestId / inputRevision）が一致しない場合は、context を付けずに generic を再実行する。
- **Worker の検証**：未知の purpose は無視する（前方互換）。形式が不正な既知の purpose と、`weekly_planning_semantic_normalizer` 以外で使われた場合は 400 を返す。

## 評価の設計（tuning の前に固定する）

### Corpus

`workers/ai-proxy/src/decision/evaluation/proposalResponseCorpus.ts` を使う。

- **tuning**：lead が作成した。32 group × 2 = 64 件で、positive は 16 件、negative は 48 件である。
- **holdout**：tuning を見ていない独立の作成者が、同じ strata の仕様から作成した。32 group の構成は同じである。
- **最初の作成者の差し替え**：最初に依頼した作成者は、tuning の配列の一部を見てしまったと自己申告した。そのため、その作成者の出力は使わず、分離した directory だけで作業する別の作成者に差し替えた。
- **strata**：pure_reject、accept、modify、defer_or_question、mixed、negation、collective_or_other_target、non_presenting（fresh だが AI の文がこの proposal を尋ねていない。#348 の証拠の限界を覆う）、security。
- **label**：`synthetic_unreviewed` であり、human gold ではない。一致率を accuracy とは呼ばない。
- **分割の検証**：group と文が split をまたがないことを validator で検証する。

### 封印

holdout を追加した直後、tuning の provider 呼出しの前に、catalog / gate / corpus の SHA-256 を `proposalResponseHoldoutSeal.ts` に記録する。

- tuning で変更してよいのは、gate の閾値と catalog の文言だけである。corpus の hash は変えない。
- holdout の runner は、実行の直前に3つの hash を照合する。
- holdout は1回だけ実行し、その後は `consumed: true` にする。

### 実行

`scripts/jev-proposal-response-remote-eval.mjs` を使う。一時的な remote Worker で、既存の Worker の secret を使う。

- 実際の client normalizer（`createWeeklyPlanningSemanticNormalizerV5`）を、production の `dispatchProposalResponse` と実 Jev・実 Luna（gpt-5.6-luna）で動かす。
- 同じ case について、Jev-first（canary 100）と Luna-only（off）を paired で比べる。
- dense audit、no-op retry、repair を含む generic Luna の全呼出しを数える。
- evidence は型付きの値だけを残し、corpus の文、prompt、provider の出力は保存しない。
- fault split では、10種類の provider 障害を注入し、すべて generic Luna へ戻ることを確認する。

### holdout の採用 gate（事前登録。変更しない）

1. **blocking**：Jev が直接 reject を受理した件数のうち、negative（`other` の全 strata。security と non_presenting を含む）での誤りが 0 件であること。
2. Jev-first の最終的な誤 reject（最終 document が pure reject になった negative）の件数が、Luna-only 以下であること。
3. Jev-first で positive が最終的に pure reject になった件数が、Luna-only − 1 以上であること。
4. **効果**：Jev が positive 16 件のうち 4 件以上を直接受理し、generic Luna の呼出しを実際に減らせること。満たさない場合は、便益がないので no-go とする。
5. **latency**：pure_reject stratum で、Jev-first の p50 が Luna-only より小さいこと。全体の p95 の悪化は、Jev の直列分（abstain の場合）程度にとどまり、その値を記録すること。
6. containment error が 0 件であること。fault の10種類がすべて generic Luna で処理されること。

どれか一つでも満たさない場合は、採用しない（Jev の配線を外すか、off のまま保留とし、理由を記録する）。canary は、既存の #333 / #335 の gate とユーザーの承認なしには有効にしない。

## 検証（mock）

- `workers/ai-proxy/src/decision/proposalResponseDispatch.test.ts`：context と応答の契約、gate、mode、shadow の分類、dispatch（off / 非選択 / 受理 / 9種類の fallback / shadow / abort）。19 件。
- `workers/ai-proxy/src/decision/proposalResponseWorkerSecurityRegression.test.ts`：#335。#152 の adversarial corpus 全件について、実際の handler を通しても、応答は閉じた判定か未変更の Luna の document のどちらかに収まる。加えて、不正な既知の purpose、不正な purpose の組合せ、off の場合を検証する。32 件。
- `src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5ProposalResponse.test.ts`：単一の request に添付すること、受理時に reject の document になること、Luna の document は変更しないこと、相関の不一致・reject 以外・candidate なし・添付ありの場合、validator に失敗した場合の fail closed。
- `src/features/weeklyPlanning/application/weeklyPlanningStableV5ProposalResponseEligibility.test.ts`：eligible の場合と、16種類の ineligible の理由。
