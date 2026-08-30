# 週間計画 Human Grounding / Dynamic Dialogue Policy

Status: canonical policy
Updated: 2026-08-30
Applies to: Stable V5 dialogue realization, proposal/acceptance dialogue, repair agenda, real-API conversation evaluation, planned Issue #246 learning consultation

Learning consultation/advice requirement: [../spec/learning-consultation-and-advice.md](../spec/learning-consultation-and-advice.md)

## Core rule

application が内部で X を知っていることと、user と application が X を共有済みであることを分離する。

```text
application internally knows X
≠ user and application have mutually established X
```

内部 heuristic、推奨、推定を shared premise として話さない。必要な方針は observable に提示し、user の accept / reject / modify を経た scope だけを shared ground とする。

```text
internal candidate
→ proposal / explanation becomes observable
→ user accepts / rejects / modifies
→ accepted scope becomes shared ground
```

Issue #246のlearning adviceも同じ原則に従う。assistantが教材・学習順序・期限を勧めただけではuserの意向でもplanning conditionでもない。

## Scope

`今回は` / `今週は` と `今後も` / `いつも` を別 state として扱う。week-local acceptance を durable preference へ暗黙昇格させない。

consultation adviceの採用とdurable preference表明も分離する。

```text
「じゃあ今回はその方法で予定組んで」
→ current planning scope

「今後もその方法でやりたい」
→ durable meaning candidateになり得る
```

## Human input model

user は完全な form 入力者ではない。短答、省略、指示語、後出し、訂正、途中の別情報を通常ケースとして扱う。必要な理解証拠は acknowledgement、confirmation、paraphrase、user vocabulary の再利用、訂正反映、deterministic consequence などから自然に示す。毎 turn 固定の「分かりました」を要求しない。

既存のauthoritative app dataをすでに持っている場合、同じ情報を一から再入力させない。計画期間内の既存予定・時間割・accepted factsをgrounded summaryとして利用し、必要なら「追加分」「差分」「今回だけ違う点」を尋ねる。

summaryに含める予定名・日時・状態はauthoritative dataまたはaccepted stateからのみ生成し、rendererが補完・捏造しない。

consultationでも同じである。Bookshelf、goal/user context、既存予定、進捗等をread-only grounded contextとして利用できる場合、ユーザーへ再入力させない。ただしsource load failureを「情報が存在しない」と扱わない。

## Repair / pass-over policy

すべての不確実性をその場で質問しない。

### Repair now

次のような不確実性は、先送りすると安全な計画や次の判断ができないため、その時点で解決する。

- task / target / referentが一意に定まらず誤った対象を更新し得る
- hard deadline / availability / authorization / required effort等、次のdecisionをblockする
- contradictory accepted factsのどちらを使うべきか決められない
- preview/save境界を安全に越えられない

consultationでは「有用なrecommendation自体を成立させられない、または候補が大きく変わる不足」をrepair now候補にする。例えば志望試験も現在レベルも不明で、教材推薦を一意に断定するのが危険な場合が該当する。

### Pass over / defer

計画を安全に進められるlow-impact uncertaintyは、repair agendaとして保持したまま別のblocking pointを先に進めてよい。

例:

```text
「できれば夜がいい」
→ 夜というsoft preference自体は理解できている
→ exact clock precisionだけ不明
→ required effortが未入力なら、まずeffortを聞く
→ precisionがpreviewへ影響するならpreview前に再開する
```

pass-overは「無視」ではない。deferred issueはmachine stateに保持し、影響を持つ境界より前にreopenする。

```text
uncertainty
→ classify impact
├─ blocking/high-impact → repair now
└─ low-impact/non-blocking → defer
                         → reopen before affected boundary
```

この契約により、枝葉の曖昧さが主軸の会話を不必要に止めることを防ぐ。

consultationでは、前提を明示したprovisional adviceで十分役立つ場合、low-impactな不足を質問攻めの理由にしない。

## Question economy

question policyは「空いているslotを順番に埋める」ものではない。

- 一度に主となる未解決点を1つ、または同時に答えるのが自然な小さなまとまりへ絞る
- known dataを再質問しない
- safe finite proposal/optionを出せる場合は、自由回答の質問より先に提示できる
- userが「分からない」と言える余地を残す
- low-impact uncertaintyをblocking questionへ昇格させない
- unrelatedなside contributionを理解した場合は、それをなかったことにせず現在の主質問へ戻る

最後の項目について、複数の独立semantic changeを1 turnでどこまでatomicに受理するかはcurrent semantic contract/testsで保証された範囲に従う。部分受理をraw-text heuristicで実装しない。

### Assistant clarificationとuser consultationを分離する

現行runtimeにおける`question`は、applicationが不足情報をuserへ聞くclarification actionとして利用されている。

Issue #246の「userがStudyPlannerへ質問する」consultationを同じmachine conceptへ雑に重ねない。

```text
assistant clarification
  application → user

user consultation
  user → application / advice answer path
```

consultationを検出した後、通常planningのslotを機械的に埋める質問列へ流さない。recommendationを実質的に変える不足だけを対象にする。

## Responsibility

AI semantic layer:
- raw user text / conversation context の意味理解
- task / workload / quantity role / date-time / correction / contextual reference
- proposal response と scope meaning の構造化
- ambiguity / uncertaintyを意味として表現する
- planned Issue #246では、current turnがlearning consultationを含むことと、その相談対象・比較・採用/修正/拒否referenceの意味を表現する

Deterministic application:
- schema / evidence / reference validation
- binding / Fact Graph lifecycle / revision / idempotency
- question necessity / priority
- repair agenda / defer / reopen boundary
- proposal lifecycle / accepted scope
- planned consultation context source selection / advice identity / lifecycle / staleness / promotion
- readiness / scheduler / preview / approval / save / persistence

AI renderer / answer purpose:
- typed application decision と grounded context を自然な対話へ実現する
- consultationではgrounded evidenceとassumptionを使って学習助言を生成できる
- new fact、authorization、schedule、save decision を発明しない

raw Japanese を regex / keyword / dictionary / legacy parser で後段再解釈しない。

## Renderer / prompt policy

question code や proposal code ごとの完成済み日本語を source of truth にしない。prompt は collaborative dialogue、shared ground、untrusted context、focused unresolved point、no invented decision といった一般原則へ限定する。

rendererは、applicationがdeferしたuncertaintyを勝手にblocking questionとして復活させたり、applicationが未解決とした論点を解決済みのように話したりしない。

consultation answerもproseを後からparseして正式stateを再構築しない。promotionに必要な候補はvalidated structured adviceとして生成・保持する。

## Proposal contract

```text
application candidate
→ renderer presents proposal
→ AI interprets user response
→ application accepts / rejects / modifies
→ accepted policy may affect scheduling
```

提示だけで accepted にしない。

Issue #246のAI-generated adviceもこの原則を拡張する。

```text
answer AI generates advice
→ application stores/presents advisory state
→ user accepts / modifies / rejects
→ application validates advice identity/revision
→ accepted scope may be promoted into normal planning input
```

advice acceptanceはpreview approvalやsave authorizationではない。

## Memory grounding

- current-week acceptance: current plan の shared ground
- durable preference: 今後も使うことまで明示的に共有された owner-scoped preference
- observed profile: 実行結果から得た evidence。明示 preference とは別
- consultation advice: assistant-generated advisory state。user fact / durable preferenceではない

長期記憶を再利用する場合も、必要なら短く再groundingし、絶対ルールのように黙って適用しない。

AI-generated adviceを長期記憶へ自動promoteしない。userが別途durable scopeを表明した場合だけ既存memory policyへ渡す。

## Real API review

各 turn で semantic interpretation、accepted delta、Fact Graph、repair agenda、application decision、renderer、scheduler / preview を必要に応じて確認する。

Issue #246実装後のconsultation turnでは、さらにconsultation route、selected context、advice assumptions/evidence、AdviceProposal lifecycle、adoption reference、promotion deltaを確認する。

次があればそのturnで停止し、owner layerを一般化して修正する。

- 明確な意味誤認
- 未共有前提
- 誤binding
- blocking uncertaintyの取りこぼし
- low-impact uncertaintyによる不要な会話停止
- deferred issueのreopen漏れ
- 未了承proposal適用
- scope leak / durable memory leak
- consultationを通常slot-fillingへ誤routing
- AI adviceをuser factとして扱う
- stale / ambiguous adviceのsilent promotion
