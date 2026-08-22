# 週間計画 Human Grounding / Dynamic Dialogue Policy

Status: canonical policy
Updated: 2026-08-23
Applies to: Stable V5 dialogue realization, proposal/acceptance dialogue, repair agenda, real-API conversation evaluation

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

## Scope

`今回は` / `今週は` と `今後も` / `いつも` を別 state として扱う。week-local acceptance を durable preference へ暗黙昇格させない。

## Human input model

user は完全な form 入力者ではない。短答、省略、指示語、後出し、訂正、途中の別情報を通常ケースとして扱う。必要な理解証拠は acknowledgement、confirmation、paraphrase、user vocabulary の再利用、訂正反映、deterministic consequence などから自然に示す。毎 turn 固定の「分かりました」を要求しない。

既存のauthoritative app dataをすでに持っている場合、同じ情報を一から再入力させない。計画期間内の既存予定・時間割・accepted factsをgrounded summaryとして利用し、必要なら「追加分」「差分」「今回だけ違う点」を尋ねる。

summaryに含める予定名・日時・状態はauthoritative dataまたはaccepted stateからのみ生成し、rendererが補完・捏造しない。

## Repair / pass-over policy

すべての不確実性をその場で質問しない。

### Repair now

次のような不確実性は、先送りすると安全な計画や次の判断ができないため、その時点で解決する。

- task / target / referentが一意に定まらず誤った対象を更新し得る
- hard deadline / availability / authorization / required effort等、次のdecisionをblockする
- contradictory accepted factsのどちらを使うべきか決められない
- preview/save境界を安全に越えられない

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

## Question economy

question policyは「空いているslotを順番に埋める」ものではない。

- 一度に主となる未解決点を1つ、または同時に答えるのが自然な小さなまとまりへ絞る
- known dataを再質問しない
- safe finite proposal/optionを出せる場合は、自由回答の質問より先に提示できる
- userが「分からない」と言える余地を残す
- low-impact uncertaintyをblocking questionへ昇格させない
- unrelatedなside contributionを理解した場合は、それをなかったことにせず現在の主質問へ戻る

最後の項目について、複数の独立semantic changeを1 turnでどこまでatomicに受理するかはcurrent semantic contract/testsで保証された範囲に従う。部分受理をraw-text heuristicで実装しない。

## Responsibility

AI semantic layer:
- raw user text / conversation context の意味理解
- task / workload / quantity role / date-time / correction / contextual reference
- proposal response と scope meaning の構造化
- ambiguity / uncertaintyを意味として表現する

Deterministic application:
- schema / evidence / reference validation
- binding / Fact Graph lifecycle / revision / idempotency
- question necessity / priority
- repair agenda / defer / reopen boundary
- proposal lifecycle / accepted scope
- readiness / scheduler / preview / approval / save / persistence

AI renderer:
- typed application decision と grounded context を自然な対話へ実現する
- new fact、authorization、schedule、save decision を発明しない

raw Japanese を regex / keyword / dictionary / legacy parser で後段再解釈しない。

## Renderer / prompt policy

question code や proposal code ごとの完成済み日本語を source of truth にしない。prompt は collaborative dialogue、shared ground、untrusted context、focused unresolved point、no invented decision といった一般原則へ限定する。

rendererは、applicationがdeferした論点を勝手にblocking questionとして復活させたり、applicationが未解決とした論点を解決済みのように話したりしない。

## Proposal contract

```text
application candidate
→ renderer presents proposal
→ AI interprets user response
→ application accepts / rejects / modifies
→ accepted policy may affect scheduling
```

提示だけで accepted にしない。

## Memory grounding

- current-week acceptance: current plan の shared ground
- durable preference: 今後も使うことまで明示的に共有された owner-scoped preference
- observed profile: 実行結果から得た evidence。明示 preference とは別

長期記憶を再利用する場合も、必要なら短く再groundingし、絶対ルールのように黙って適用しない。

## Real API review

各 turn で semantic interpretation、accepted delta、Fact Graph、repair agenda、application decision、renderer、scheduler / preview を必要に応じて確認する。

次があればそのturnで停止し、owner layerを一般化して修正する。

- 明確な意味誤認
- 未共有前提
- 誤binding
- blocking uncertaintyの取りこぼし
- low-impact uncertaintyによる不要な会話停止
- deferred issueのreopen漏れ
- 未了承proposal適用
- scope leak / durable memory leak
