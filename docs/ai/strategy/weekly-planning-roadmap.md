# 週間計画 AI ロードマップ

Status: canonical / active
最終更新: 2026-08-03

- Runtime contract: [../weekly-planning-stable-v5-runtime-trial-contract.md](../weekly-planning-stable-v5-runtime-trial-contract.md)
- Current status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
- Semantic V5 queue: [weekly-planning-semantic-v5-roadmap.md](weekly-planning-semantic-v5-roadmap.md)
- Active-task inventory: [../audits/20260731-weekly-planning-active-task-inventory.md](../audits/20260731-weekly-planning-active-task-inventory.md)
- Semantic handoff audit: [../audits/20260731-weekly-planning-semantic-state-handoff-seven-audit.md](../audits/20260731-weekly-planning-semantic-state-handoff-seven-audit.md)
- P0 architecture reset: [../tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md](../tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md)

## 0. 最上位設計原則

週間計画機能では、次を変更不能な根幹原則とする。

> ユーザーの自然言語、会話文脈、指示・訂正・承認の意味理解はAIだけが担当する。決定論的な処理は、AIが出した意味表現に対する形式・参照・状態遷移・安全性の検証と適用だけを担当する。

この原則は、個別scenarioの成功、短期的な実装容易性、prompt短縮、API費用、既存test維持より優先する。

### AIが担当するもの

- 現在発話の意味理解
- 会話履歴を使った省略・照応・訂正・承認の理解
- 作業、数量、所要時間、日付、時間帯、関係の意味構造化
- 既存情報への訂正対象または回答対象の選択
- 不確実性の明示

### 決定論的処理が担当するもの

- schema、型、列挙値、数値範囲、時刻形式
- 参照先、参照種別、owner、revision、pending questionの整合性
- AIが選択した対象の正式IDへの結び付け
- 意味を変えない正規化と完全同一重複の除去
- Fact Graph lifecycle、transaction、rollback
- readiness、scheduler、preview、承認、保存、再読込
- stale、二重処理、owner混線の拒否

### 禁止事項

- AI出力とは別にユーザー文を正規表現・キーワード・辞書で再解釈する
- AI出力を検証する前にルール側の意味文書へ置換する
- 短答、訂正、作成承認、作業境界、数量欠落、日付意味を独立parserで判定する
- provider failureまたはvalidation failure時にparser fallbackする
- 特定発話、教科、数量、単位、scenarioを通すproduction patchを追加する
- schema不足を後段の自然言語処理で隠す

PR #109では、この原則に反する短答・訂正・承認の独自解釈が再導入されたため、実API改善ループを一旦停止し、P0 architecture resetを最優先とする。

## 1. Statusの読み方

```text
module implemented
→ runtime connected
→ local persistence connected
→ automated verified
→ browser verified
→ cloud synced
→ operationally deployed
→ default enabled
```

各段階を同一視せず、過去headの成功結果を現在headへ自動継承しない。

## 2. 現在の実装基盤

### Semantic/runtime

実装済み:

- AI-only initial semantic interpretation
- strict schema / max one repair
- Fact Graph V5 / lifecycle / active read view
- generic scheduler input / deterministic dialogue / preview
- staged Graph commitとexisting approval/save bridge
- rendererへの会話・Fact context
- renderer prompt/raw response/fallback/final decisionのtrace persistence

PR #109で検証・是正中:

- machine-readable pending question
- exact target short-answer binding
- renderer typed action contract
- actual OpenAI multi-turn conversation eval
- AI意味理解責務の回帰除去
- schemaとvalidatorの対象参照修正

未完了:

- generic semantic turn delta
- generic lifecycle applier
- evidence coverage registry
- actual AI/browser verification

### Application/persistence

実装済み:

- application request ownership
- stale discard
- close/reopen continuity
- local owner/week/conversation envelope
- conversation、Graph、messages、preview、draftのreload復元

未実装:

- cloud authoritative repository
- cross-tab sequence reservation
- cross-device conflict/offline reconciliation

### Trace

実装・自動検証済み:

- server-authoritative IDsとsame-handle recovery
- Stable V5 debug transport
- redaction/HMAC/admin export
- request/entry size batching
- prompt contextのpersistent outbox/Worker保持

未完了:

- production secret/TTL/Rules/Worker deploy
- Issue #89 post-merge verification
- abrupt-close final-turn durability
- pagination/versioned decoder

### Approval / Personalization

Approval core idempotencyは実装済みだがproduction Rules/TTL/multi-client未確認。Personalization foundationは実装済みだがobservation以降は未実装。

## 3. Current queue

`docs/ai/tasks/`直下のcurrent task recordは、roadmap上の独立実行単位だけとする。

### P0: architecture integrity

1. [AI semantic ownership reset](../tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md)

このtaskが完了するまで、PR #109へ新しい自然言語正規表現、語句辞書、scenario固有semantic patchを追加しない。

### P0: scheduler safety

2. [current-time start boundary](../tasks/20260731-weekly-planning-midweek-current-time-start-boundary.md)

### P1: adoption/runtime integrity

3. [Stable V5 verification and cutover](../tasks/20260731-weekly-planning-stable-v5-verification-and-cutover.md)
4. [Stable V5 runtime followups](../tasks/20260731-weekly-planning-runtime-followups.md)
5. [autonomous conversation loop](../tasks/20260801-weekly-planning-autonomous-conversation-loop.md)

### P1-P2: production boundaries

6. [cloud conversation session store](../tasks/20260731-weekly-planning-synced-conversation-session-store.md)
7. [trace production privacy/lifecycle/scalability](../tasks/20260731-weekly-planning-trace-privacy-and-lifecycle.md)
8. [approval operational rollout](../tasks/20260731-weekly-planning-approval-operational-rollout.md)
9. [external source production adapter](../tasks/20260731-weekly-planning-external-source-production-adapter.md)

### P2+: learning/personalization

10. [personalization rollout](../tasks/20260731-weekly-planning-personalization-rollout.md)

旧日付の重複taskは、内容を現在化した上でcurrent taskへ吸収し、root queueとして使用しない。

## 4. 依存順

Immediate architecture path:

```text
semantic patch freeze
→ production semantic-path responsibility audit
→ schema / validator / binding redesign
→ rule-based semantic override removal
→ architecture regression tests
→ OpenAI semantic eval
→ OpenAI conversation eval
```

Stable V5 adoption:

```text
AI semantic ownership reset
→ current-time hard boundary
→ Stable V5 actual AI/browser verification
→ external source adapter verification
→ migration/shadow/rollback
→ default cutover decision
```

Structural semantic path:

```text
machine pending question
→ AI-readable contextual answer contract
→ exact formal target binding
→ generic semantic turn delta
→ generic lifecycle applier / coverage registry
```

Cloud/personalization:

```text
cloud conversation/Graph repository
→ observations
→ reset validity propagation
→ time-decayed aggregate
→ personalized ordering
```

Parallel operations:

```text
trace production deploy + Issue #89 verification
approval Rules/TTL/multi-client verification
```

## 5. Decision gates

### AI semantic ownership

raw user textの意味構造化と会話文脈解決はAIだけが担当する。deterministic coreはschema、reference、revision、formal target binding、conflict、readiness、scheduler、saveを管理する。

次が一つでも存在する場合、semantic architecture gateはredとする。

- production経路でユーザー文を再解釈する正規表現・キーワード・辞書
- validなAI responseを別の意味文書へ置換する処理
- short answer、correction、authorization、task boundaryを独立判断するparser
- provider failureまたはvalidation failureからのparser fallback
- schema不足を隠すscenario固有補正

直前の質問種別と対象はrenderer textから逆推定せず、machine pending questionを正とする。ただしmachine pending questionは、AIへ文脈を伝え、AI出力との整合を検証するために使う。後段が回答の意味を独自生成するためには使わない。

### Failure investigation order

実API失敗時は必ず次の順で確認する。

```text
AIへ渡したcontext
→ AI raw responseの意味
→ schema表現可能性
→ validator誤拒否
→ formal ID binding
→ Fact Graph apply
→ dialogue / preview / approval / save
```

この確認前に新しい自然言語ルールを追加しない。

### Current-time safety

明示開始がない当日計画ではrequest時刻より前へ配置しない。

### Session / trace authority

conversation、Graph revision、pending questionを同じsession revisionで保持する。same logical conversationに対するtrace handle/sequenceを継続し、Issue #89確認前にproduction完了としない。

### Default cutover

次が残る場合、Stable V5をdefaultへしない。

- semantic architecture gate red
- current-time boundary未実装
- actual AI/browser未実施
- renderer textが状態遷移へ影響する
- trace split/loss再発
- migration/rollback未検証
- unresolved blocker/major audit finding

## 6. Task MD運用

今後の週間計画実装は、コード変更より先に必ずroadmap上の位置を決め、`docs/ai/tasks/`へtask MDを作成または更新する。

各task MDには最低限、次を記載する。

- 目的と非目的
- roadmap上の位置と依存関係
- 守る最上位設計原則
- 変更対象と変更禁止範囲
- 失敗原因の抽象化
- 同じ原因で起こり得る別事例
- 実装順序
- テスト戦略
- 受け入れ条件
- 実測結果と未確認事項

作業中は、各調査・実装・Actions・実API結果をそのtask MDへ追記する。口頭説明だけで状態を更新しない。

```text
completed work unit
→ tasks/closed/

unfinished work absorbed by another current task
→ tasks/superseded/

independent current execution target
→ tasks/ root
```

完了時は、roadmap、task status、PR本文、実装、test、artifactを同じgateで同期する。
