# 週間計画 汎用意味モデル Stable V5 ロードマップ

Status: canonical / active post-runtime-integration queue
最終更新: 2026-08-03

- [Runtime trial contract](../weekly-planning-stable-v5-runtime-trial-contract.md)
- [Current contract](../weekly-planning-current-contract-v5.md)
- [Current status](../weekly-planning-current-contract-status.md)
- [Active-task inventory](../audits/20260731-weekly-planning-active-task-inventory.md)
- [Semantic handoff audit](../audits/20260731-weekly-planning-semantic-state-handoff-seven-audit.md)
- [Verification/cutover task](../tasks/20260731-weekly-planning-stable-v5-verification-and-cutover.md)
- [AI semantic ownership reset](../tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md)

## 0. 非交渉の意味理解原則

Stable V5では、ユーザーの自然言語と会話文脈の意味理解をAIだけが担当する。

```text
user utterance + recent conversation + machine-readable state
→ AI semantic interpretation
→ structural/reference/safety validation
→ formal ID binding
→ Fact Graph lifecycle
```

禁止する経路:

```text
user utterance
→ regex / keyword / dictionary / parser
→ AI responseを置換または上書き
```

決定論的処理は、AIが選んだ意味を再選択してはいけない。担当範囲はschema、reference、revision、owner、formal target binding、transaction、readiness、scheduler、preview、approval、saveに限定する。

AIが意味的に正しい構造を返したのにschemaまたはvalidatorが拒否した場合、schema・validator・bindingを修正する。ユーザー文を後段で読み直して通してはいけない。

## 1. 到達済みruntime

```text
自然文
→ Stable V5 AI Semantic Normalizer
→ strict validation / max one AI repair
→ SemanticDocument V5
→ lifecycle canonicalizer / Fact Graph V5
→ active read view
→ generic scheduler input
→ deterministic dialogue / preview
→ AI renderer
→ existing approval / Plan save
```

Feature flagで既存UIへ接続済み。Graph更新はrequest単位にstageし、PlanningState commit受理後だけfinalizeする。

## 2. semantic handoff findingと2026-08-03回帰

従来はshort answerの質問種別をAI rendererが生成した日本語文面の部分一致から推定していた。また、既存Factへの回答を直接表すschemaがなく、minimal taskを生成してquestion code別binderで再結合していた。

machine-readable pending questionにより、question code、target fact、graph revisionを保持し、renderer文面をsemantic bindingへ使用しない方向へ進めた。

しかしPR #109の実API失敗対応で、次の回帰が発生した。

- short answerを正規表現で解釈し、AI出力より先に別の意味文書を生成
- correctionを訂正語・作業名・数量で再解釈
- creation authorizationを語句列挙で判定
- user textから作業と数量を再抽出してAI出力を監査
- task boundaryを後段で意味的に分割
- relative date source textを読み直してAI出力を上書き

「40問にかかる時間は3時間」の失敗では、AIの意味理解よりも、effort targetがworkloadを参照できないschema・validator制約が主要因だった。したがって、意味補正を増やすのではなく表現力と参照設計を修正する。

## 3. Gate status

### V5-A: schema/document generation

Status: runtime connected / P0 architecture reset required

完了:

- generic task/component/workload/effort/temporal/recurrence/relation
- availability、fixed commitment、source request
- provider failure fail closed、parser fallback禁止
- machine-readable pending question context

P0残件:

- effort estimateがworkloadを正式targetとして参照できる契約
- short answerで既存task構造を再生成しない表現方法
- correction、answer、authorizationの会話行為表現の再評価
- AI outputを意味的に置換する経路の除去
- architecture regression guard

後続残件:

- generic semantic turn delta
- evidence coverage registry
- actual AI real-eval

### V5-B: Fact Graph lifecycle/transaction

Status: runtime connected / generic update incomplete

完了:

- active/superseded/removed lifecycle
- formal IDs/revision/diff
- staged Graph、active scheduler view
- planningWindow single-active enforcement
- machine pending questionのexact target保持

P0残件:

- AIが選んだworkload targetへのeffort binding
- AIの意味を変えないformal ID binding
- schema変更時のcorrection application整合

後続残件:

- add/update/remove/uncertainty resolutionのgeneric lifecycle applier
- dependent fact batch termination
- cloud Graph repository
- migration decoder

### V5-C: dialogue/scheduler

Status: runtime connected / actual AI verification blocked by P0

完了:

- deterministic blocking issue/question policy
- create authorization、preview gate、partial preview禁止
- renderer contextとtrace persistence

残件:

- semantic ownership reset後のtyped action contract verification
- current-time hard boundary
- browser roleplay
- external source production adapter

### V5-D: application/persistence

Status: local persistence connected

残件:

- cross-tab sequence
- cloud/cross-device repository
- offline reconciliation
- final trace durable delivery

### V5-E: quality trace

Status: implementation verified / production verification pending

追加P0要件:

- AI raw responseとaccepted documentの意味差分を追跡可能にする
- 後段のalgorithmic repairが意味要素を置換していないことをartifactで確認する

残件:

- Issue #89 same-conversation verification
- production secret/TTL/Rules/Worker
- pagination/versioned decoder

### V5-F-I

- external source: pure loader complete / production adapter pending
- real-eval/shadow: harness exists / architecture reset後に再開
- migration: design only
- default cutover/legacy deletion: not started

## 4. Current execution order

```text
semantic patch freeze
→ semantic-path responsibility inventory
→ schema / validator / binding redesign
→ AI output replacement経路の除去
→ architecture regression tests
→ focused/full deterministic verification
→ OpenAI semantic schema eval
→ OpenAI conversation eval
→ transcript / raw response audit
→ current-time hard boundary
→ browser roleplay
→ generic semantic turn delta / coverage
→ external source production verification
→ migration / shadow / rollback
→ default cutover
```

## 5. Failure investigation protocol

実APIまたは会話testが失敗した場合は、必ず次の順で確認する。

1. AIへ必要なcontextが渡ったか。
2. AI raw responseの意味が正しいか。
3. schemaがその意味を表現できるか。
4. validatorが正しい構造を誤拒否していないか。
5. formal ID bindingで対象が壊れていないか。
6. Fact Graph applyで壊れていないか。
7. dialogue、preview、approval、saveで壊れていないか。

上記を確認する前に、ユーザー文を読む新しいregex、keyword list、dictionary、parserをproductionへ追加しない。

## 6. Current active records

P0:

- [AI semantic ownership reset](../tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md)

Blocked until P0 completes:

- [autonomous conversation loop](../tasks/20260801-weekly-planning-autonomous-conversation-loop.md)
- [verification/migration/cutover](../tasks/20260731-weekly-planning-stable-v5-verification-and-cutover.md)

Following work:

- [current-time boundary](../tasks/20260731-weekly-planning-midweek-current-time-start-boundary.md)
- [runtime followups](../tasks/20260731-weekly-planning-runtime-followups.md)
- [cloud session store](../tasks/20260731-weekly-planning-synced-conversation-session-store.md)
- [external source adapter](../tasks/20260731-weekly-planning-external-source-production-adapter.md)
- [trace operations](../tasks/20260731-weekly-planning-trace-privacy-and-lifecycle.md)

## 7. Default cutover禁止条件

- production経路にAIとは別の自然言語parserが存在する
- validなAI responseを意味的に置換する後処理が存在する
- renderer textからquestion/targetを推定する経路が残る
- parser fallbackが存在する
- Graph/PlanningState commitが非原子的
- current-time boundary未実装
- trace split/loss再発
- actual AI/browser未実施
- migration/rollback未検証
- unresolved blocker/major finding

## 8. Task MD gate

semantic実装は、コード変更前に必ずroadmap上の位置を確定し、独立task MDを作成または更新する。

最低限、目的、非目的、責務境界、禁止事項、抽象化した原因、別事例、実装順、テスト、受け入れ条件、実測結果を記録する。

実装中は各ループをtask MDへ追記し、完了時はroadmap、task status、PR本文、test、artifactを同期する。完了foundationはclosed、別trackerへ吸収した旧work unitはsuperseded、rootには現在の独立taskだけを置く。
