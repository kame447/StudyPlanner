# 週間計画 Human Grounding / Dynamic Dialogue Policy

Status: canonical / active
Updated: 2026-08-22
Applies to: Stable V5 dialogue realization, proposal/acceptance dialogue, real-API conversation evaluation

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

## Responsibility

AI semantic layer:
- raw user text / conversation context の意味理解
- task / workload / quantity role / date-time / correction / contextual reference
- proposal response と scope meaning の構造化

Deterministic application:
- schema / evidence / reference validation
- binding / Fact Graph lifecycle / revision / idempotency
- question necessity / priority
- proposal lifecycle / accepted scope
- readiness / scheduler / preview / approval / save / persistence

AI renderer:
- typed application decision と grounded context を自然な対話へ実現する
- new fact、authorization、schedule、save decision を発明しない

raw Japanese を regex / keyword / dictionary / legacy parser で後段再解釈しない。

## Renderer / prompt policy

question code や proposal code ごとの完成済み日本語を source of truth にしない。prompt は collaborative dialogue、shared ground、untrusted context、one unresolved point、no invented decision といった一般原則へ限定する。

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

各 turn で semantic interpretation、accepted delta、Fact Graph、application decision、renderer、scheduler / preview を必要に応じて確認する。明確な意味誤認、未共有前提、誤binding、未了承 proposal 適用、scope leak があればその turn で停止し、owner layer を一般化して修正する。
