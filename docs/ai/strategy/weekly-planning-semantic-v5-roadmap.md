# 週間計画 Stable V5 Semantic / Orchestration ロードマップ

Status: canonical / PR #130 conversation grounding and Luna simplification audit
最終更新: 2026-08-15

- Main roadmap: [weekly-planning-roadmap.md](weekly-planning-roadmap.md)
- Current status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
- Current execution task: [../tasks/20260814-weekly-planning-conversation-quality-luna-audit.md](../tasks/20260814-weekly-planning-conversation-quality-luna-audit.md)
- Human grounding / dynamic dialogue policy: [../tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md](../tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md)
- Test philosophy: [../testing/weekly-planning-test-philosophy.md](../testing/weekly-planning-test-philosophy.md)

## 0. Semantic ownership

ユーザー発話と会話文脈の意味理解はAIが担当する。

```text
user utterance + relevant conversation + machine-readable state
→ machine-state semantic routing
→ focused または generic AI semantic interpretation
→ structural / evidence / reference validation
→ formal binding / canonical commit
→ Fact Graph V5
```

禁止:

```text
raw user utterance
→ regex / keyword / dictionary / deterministic parser
→ AI意味の置換・補完・上書き
```

deterministic routerはpending question、target fact、runtime phase等のmachine stateだけでrouteを選ぶ。focused routeでも意味解釈はAIに残す。

## 1. Current semantic routes

```text
machine-state routing
├─ focused authorization AI
├─ focused contextual-answer AI
│  ├─ missing_effort_estimate
│  └─ quantity_role_unresolved
└─ generic open-ended semantic AI
   → response normalization
   → validation
   → 必要時AI repair 最大1回
→ accepted current-turn delta
→ existing entity binding / correction / no-op
→ canonical commit
→ Fact Graph V5
```

SemanticDocumentはcurrent-turn deltaでありaccepted state snapshotではない。publicStateSummary / recentConversation / episodicMemoryは意味解釈contextであり、過去Factをcurrent deltaへ再コピーする根拠ではない。

## 2. Current semantic contracts

- workloadをeffort estimateのformal targetにできる。
- pending effort / quantity-roleの短答はmachine pending targetへformal bindingする。
- creation authorizationはfocused AIが意味判定する。
- current-turnに根拠のない過去Factコピーをvalidatorで拒否する。
- existing entity continuationはpublic IDを明示的に扱う。
- no-op turnでFact revisionを増やさずidempotency履歴は保持する。
- standard date / weekday / clockの意味構造化はAIが担当する。
- representation contractはvalidator / canonical contractで検査する。
- renderer文面をsemantic targetのsource of truthにしない。
- provider / validation failureからraw-text parserへfallbackしない。

### 2.1 Human grounding / dialogue realization contract

Conversation quality は、固定質問文を正しく順番に出すことではなく、発話系列を通して共同理解が観察可能に形成されることを基準とする。

必須参照は [PR #130 Human Grounding / Dynamic Dialogue Policy](../tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md) とする。

- deterministic code は「何を確認するか」「何が未確定か」を所有するが、正常系の完成済み日本語質問文を source of truth にしない。
- AI renderer は typed application decision と grounded context を受け、直前発話への acknowledgement / confirmation / paraphrase / grounded consequence 等を必要に応じて自然に統合する。
- acknowledgement を毎回同じ文言でprefixするなど、別の固定templateへ置き換えない。
- user は完全なform入力者ではなく、短答・省略・後出し・訂正を行う economical participant として扱う。
- conversation-quality acceptance は固定 transcript の全文一致ではなく、各 assistant turn を確認してから次の user utterance を生成する dynamic turn-by-turn real-API evaluation を必須とする。
- fixed unit/integration test は semantic / deterministic invariant の検査として維持するが、自然な対話本文の固定oracleにしない。
- 同じ question code でも発話系列や共有状態が異なるなら、rendererの表現が自然に変化することを許容・要求する。
- provider failure等の最小fallbackは保持できるが、fallbackの存在を正常系 deterministic question bypass の根拠にしない。

このcontractに反する fixed realization、deterministic question bypass、特定発話専用prompt rule は PR #130 の監査対象とする。

## 3. Prompt complexity audit

2026-08-12のreal API trace:

- generic initial semantic request: 23,014 bytes
- generic system prompt: 10,404 bytes / 53 lines
- generic response: 1,957 chars
- repair: なし
- focused contextual導入前の`8分くらいです。`: 25,239 bytes generic request

system prompt 53行のうち38行には`never` / `must` / `only` / `do not`のいずれかが含まれている。すべてが過剰制約という意味ではないが、instruction densityが高いことは明確である。

現在generic一回に含まれる主な意味責務:

- task / study classification
- decompositionStatus
- component hierarchy
- workload / effort
- quantity role
- planning window
- date / weekday / clock
- recurrence
- hard / soft constraint
- event occurrence / task deadline
- durable context / concern
- existing entity continuation
- modifier scope / ambiguity
- relations
- external source request
- correction / decision
- current-turn delta / sourceText grounding

context-window不足より、同時に守るsemantic / representation contractの多さが主要リスクである。

## 4. Prompt肥大化防止contract

新しいreal API failureを見つけても、generic system promptへ規則を追加することを第一選択にしない。

判断順序:

1. JSON Schemaで表現できるrepresentation constraintか。
   - schemaへ寄せる。
2. 意味を選び直さないdeterministic normalizationか。
   - canonicalizerへ寄せる。
3. machine pending stateがexact targetを既に持つか。
   - focused semanticへ分離する。
4. AIによる修復が必要だが変更対象fieldが限定できるか。
   - field-scoped focused repairを優先する。
5. 自由入力の複数意味を統合する必要がある場合だけgeneric semanticを使う。

同じrepresentation ruleをsystem prompt、validator、repair promptへ無条件に三重実装しない。

Prompt budget:

- generic system prompt <= 11,000 bytes
- representative generic request including JSON Schema <= 24,000 bytes
- focused authorization <= 2,500 bytes
- focused contextual answer <= 4,000 bytes
- focused request < generic / 4

`weeklyPlanningSemanticPromptBudget.test.ts`でCI gate化する。閾値を超えたら、まず責務分離を行い、上限を安易に緩めない。

## 5. Public state budget

AIへ渡すpublic stateもpromptの一部である。

初回real API user prompt 1,603 bytesのうち、訂正対象が存在しないにもかかわらず`correctionContract`が約908 bytesを占めていた。

現在はactive correction targetが存在する場合だけcorrectionContractを渡し、empty Graphでは省略する。stale summary由来のcorrectionContract / episodicMemoryをそのまま再送せず、current Graphから再構築する。

今後もpublicStateSummaryへ説明文を足す前に、machine-readable compact representationで代替できないか確認する。

## 6. Repair policy

repairは最大1回を維持する。

ただし「full documentを書き直すrepair」に新しいspecial caseを積み続けない。

real APIで既に観測したrepresentation failure:

- absolute planningWindowがnon-ISO / missing range
- exact clockをcustom namedTimePeriodへ格納
- bare weekday token

これらは意味全体を再解釈する問題ではない。

現在はrepresentation-only repair preservation guardで、修復対象外のtask / availability / intent等が変化したrepairをrejectする。

次の改善候補は、対象fieldだけをAIに再解釈させdeterministic mergeするfield-scoped repairである。これによりfull-document destructive repair自体を減らす。

## 7. Selective orchestration

初回自由入力は当面generic一回を維持する。

理由:

- task / workload / period / availability / modifier / relationが同じ発話で相互参照する。
- 根拠なく複数callへfan-outするとentity identityとmodifier scopeの統合が難しくなる。
- call数増加はlatency / cost / merge failure pointも増やす。

一方、machine stateでsemantic targetが確定した継続turnはfocused routeを優先する。

既に分離済み:

- authorization
- effort answer
- quantity-role answer

次の有力候補:

### pending work_breakdown

exact targetPublicIdがmachine stateで分かっている。現状はgeneric prompt、work-breakdown validator、repair directiveへ同じ責務が分散しているため、focused semantic schemaへ切り出す価値が高い。

ただしtask constituent extraction自体はAI意味理解なので、deterministic breakdown parserへ置き換えない。

### field-scoped temporal repair

planningWindow / weekday / clockの対象fieldがvalidation errorから確定している場合、全SemanticDocumentを再生成させず局所AI repairする。

## 8. Overconstraint review

hard contractとして残すもの:

- schema / type / ID / reference validity
- current-turn evidence
- exact machine pending target
- no application/scheduler/save command
- deterministic readiness / scheduling / persistence ownership

AI semantic guidelineとして簡潔に残すもの:

- workload vs effort
- quantity meaning
- task vs goal event
- hard vs soft preference
- ambiguity / uncertainty
- modifier scope

promptから追い出す方向で検討するもの:

- schemaで表現可能なtoken spelling
- provider formattingだけを補う詳細規則
- machine-pending subtype専用の長いgeneric instruction
- validator errorごとのfull-document repair special case

AIの意味理解を弱めるのではなく、意味理解以外のformat / state責務をAI promptから外すことを目的とする。

## 9. Real API investigation protocol

```text
machine route
→ actual AI input bytes / context
→ AI raw semantic output
→ schema表現可能性
→ validation
→ repair route / repair scope
→ formal binding
→ canonical commit / revision
→ scheduler / dialogue
→ renderer
→ preview / approval / save
```

問題発生時はこの順序を確認する。自然言語ルール追加を最初の修正にしない。

成功するまでAPIを再試行するだけの検証は禁止する。失敗shapeを保存し、契約漏れかmodel varianceかを分離する。

## 10. PR #120 semantic gate

- prompt budget tests green
- focused/generic orchestration regression green
- representation-only repair preservation green
- current-turn evidence / entity continuation / correction / no-op回帰green
- typecheck / full Vitest / build / diff check green
- 最終HEADの逐次real API preview到達
- 最終HEADの通しreal API preview到達
- prompt / orchestration final auditでBLOCKER/MAJORなし

このgate完了前にsemantic layerを「完成」としない。
