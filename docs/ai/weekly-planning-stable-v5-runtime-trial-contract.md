# Weekly Planning Stable V5 Runtime Contract

Status: canonical / Stable V5 sole production runtime
Updated: 2026-08-11

注: ファイル名 `weekly-planning-stable-v5-runtime-trial-contract.md` は既存リンク互換のため残しているが、trial contractではない。本文が現在のruntime contractである。

## 1. Current runtime

Stable V5は週間計画の唯一のproduction runtimeである。

```text
NaturalLanguageAssistant
→ weeklyPlanningTurnExecutor
→ Stable V5 semantic normalization
→ validation / optional AI repair
→ Fact Graph V5
→ deterministic readiness / scheduler / dialogue decision
→ AI renderer
→ preview
→ draft / approval / save
```

legacy runtime selector、runtime mode setting、query parameterによる旧経路切替、runtime generation切替は存在しない。

旧保存形式・旧trace形式を読み取るmigration decoderは、既存data互換のために残ることがある。これは旧runtimeへrollbackする機構ではない。

## 2. AI / core boundary

AIはraw user textと会話文脈からsemantic meaningを構造化する。

AIが担当する:

- task / quantity / effort
- date / weekday / time period
- relation / availability / recurrence
- correction / decision / authorization intent
- pending questionに対する自然言語回答の意味

coreが担当する:

- schema / evidence validation
- formal ID / revision
- existing fact binding
- lifecycle / no-op / idempotency
- readiness / question target
- scheduler placement
- preview freshness
- approval / save
- persistence / recovery

provider failure、schema rejection、repair failureで自然言語parserへfallbackしない。

## 3. Session identity

conversation IDは一つの論理対話系列を表す。turn ID、request ID、message IDはconversation内で再利用しない。

```text
<conversationId>:turn:<sequence>
<conversationId>:request:<sequence>
<conversationId>:turn:<sequence>:user
<conversationId>:turn:<sequence>:assistant
```

ページ再読込・再マウント後はpersisted stateからsequenceの単調下限を復元する。

`clear_conversation`は表示messageだけを対象とし、同一sessionのGraph / preview / draft / request sequence / trace continuityを壊さない。

`reset_session`は明示的に新規conversationへ移行し、conversation-scoped stateを初期化する。

## 4. Browser persistence

Stable V5 sessionはowner・week・conversationへ拘束する。

一貫したenvelopeとして扱う対象:

- conversation ID
- 完了済みPlanningState
- Fact Graph V5
- preview candidates
- draft blocks
- saved timestamp / schema metadata

pending turnやpending approval中の半端なstateを保存しない。復元時にowner、week、conversation、Graph source、preview freshness、size、schemaを検証し、一部分だけ復元しない。

旧PlanningState/local payloadを読むmigrationは、owner整合性を検証してから現在形式へ移す。migration失敗を空stateとして黙って扱わない。

## 5. Fact Graph transaction

runtime executorはGraph変更をrequest単位でstageする。PlanningState側の同一turn commit成功後だけfinalizeする。

次ではstageを破棄する。

- stale request
- cancel
- week change
- commit rejection
- validation / provider failure

no-op turnではfact revisionを増やさないが、applied turn/idempotency履歴は保持する。

## 6. Preview / approval

previewはowner、conversation、Graph revision、source factsへ拘束する。

- Graph変更後のstale previewは承認不可。
- preview後の実変更は再preview。
- no-op turnでは既存previewを保持。
- preview candidateからdraft blockへの昇格は既存application contractを通す。
- approval/saveはdeterministic application責務。
- 二重承認、二重保存、owner mismatchを拒否する。

## 7. Trace continuity

trace scopeはowner + logical conversation IDである。

ページ再読込、module memory消失、表示messageのclearだけでphysical trace identityを切らない。明示reset、owner変更、week scope変更、新conversationだけが新しいidentityを作る。

traceはrequest、turn、revision、adopted response source、renderer decision等を観測可能にする一方、privacy/retention contractを守る。

legacy trace decoderが必要な場合はread compatibilityとして扱い、新しいruntime write pathへlegacy shapeを再導入しない。

## 8. External constraints

existing plans / timetable / fixed commitmentsの本文はsemantic AIへ送らずschedulerへ直接渡す。

external source acquisitionはsuccess(events) / failure(reason)を区別し、failureを予定0件として扱わない。

## 9. Verification

Stable V5 runtime変更では少なくとも次を確認する。

- typecheck
- deterministic weekly-planning regressions
- conversation foundation
- full Vitest
- production build
- storage/checkpoint recovery
- preview/approval freshness
- trace continuity

AIの意味理解・自然さはhuman-reviewed real-API observationで確認する。固定返答文を自動PASS条件にしない。

## 10. Current maintenance sequence

PR #109はmainへmerge済みである。

```text
legacy / 過去経路削除
→ 挙動不変リファクタ
→ 7視点再棚卸し
→ 新規改善
```

runtime contractを変更する新仕様はPhase 3 legacy cleanupへ混ぜない。
