# PR #130 週間計画 会話品質・Luna監査 引き継ぎ

Status: active / handoff
Created: 2026-08-16
PR: #130 `Audit weekly-planning conversation quality on Luna`
Branch: `agent/weekly-conversation-quality-luna-audit`
Base: `main`
Code baseline before this handoff-only commit: `981080506b155f958eb4acc1b61f6eee9c23dba1`

この文書は、別チャットでPR #130の作業をそのまま継続するための引き継ぎ正本である。

## 1. 最初に守ること

- 新しいbranch / PR / Issueを作らない。
- PR #130の同じbranchだけで続行する。
- PRはdraft・未mergeのまま維持する。明示指示なしにmerge ready化・mergeしない。
- raw Japaneseのregex / keyword / parserを追加してAI semanticを上書きしない。
- regression固有の日本語例文・固定文・prompt guardrailを増やして問題を隠さない。
- 失敗を見つけたら、その会話turnで止め、owner layerを特定して一般化した修正を行ってから次turnへ進む。
- exactな日本語文面一致を品質oracleにしない。semantic / Fact Graph / application stateの一致を見る。

Mandatory references:

- `docs/ai/tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md`
- `docs/ai/tasks/20260814-weekly-planning-conversation-quality-luna-audit.md`
- `docs/ai/strategy/weekly-planning-adaptive-memory-learning-policy.md`
- `docs/ai/strategy/weekly-planning-semantic-v5-roadmap.md`
- `docs/ai/weekly-planning-current-contract-v5.md`

## 2. 責務境界

基本原則:

```text
意味が曖昧な間 → AI
意味が一意になった後 → application / deterministic code
```

AIの責務:

- natural language / conversation meaning
- pronoun / contextual reference
- correction / contradiction meaning
- task / study semantic classification
- quantity role / date-time intent
- proposal response meaning
- natural language realization

Applicationの責務:

- schema / evidence / reference validation
- canonical binding / IDs
- Fact Graph lifecycle / revision / idempotency
- confirmation necessity
- proposal lifecycle / accepted scope
- readiness
- deterministic date / quantity conversion
- scheduler
- preview / approval / save
- persistence
- long-term memory / adaptation
- arithmetic / calibration / observed pace calculation

AIにcanonical IDや算術をやらせない。

## 3. Human grounding

内部heuristicや内部proposalを共有済み事実として話さない。

```text
internal heuristic
→ proposal becomes observable to user
→ accept / reject / modify
→ accepted scope only becomes shared ground
```

自然な会話では、必要に応じてacknowledgement、paraphrase、確定帰結、既出表現の再利用を用いる。ただし固定テンプレート化しない。

## 4. Memory / personalizationの三層

必ず以下を区別する。

1. current week / current conversation state
2. explicit durable preference
3. observed learning profile

一回の選択や過去の観測結果をdurable preferenceへ自動昇格しない。

observed profileはFact Graphのユーザー発話factではない。raw observationを保存し、derived paceを計算してscheduler estimate overrideとして使う。

## 5. ここまで完了した主要修正

### 5.1 `no_additional_constraint`

`今週は特に予定ない` / `ほか予定ない`等をpositive availabilityとして扱う不具合を修正済み。

- semantic kindとして`no_additional_constraint`を導入。
- Fact Graphにはabsenceとして保持。
- scheduler availability projectionからは除外。
- raw-text normalizer workaroundは使わない。

Real Lunaでも、`来週英単語220語覚えたい。ほかは特に予定ないよ`からpositive availabilityを作らず処理できている。

### 5.2 暗記を一般化

vocabulary / English専用heuristicを撤回済み。

- semanticは`memorization_retrieval`。
- 100語threshold削除。
- vocabulary由来の朝昼夜自動配置削除。
- fixed review count / fixed 1-3-7 scheduleを標準規則にしない。
- `unitCode === word`だけでexecution profileを決めない。
- cold-startではspacing / retrievalの一般原則をtyped proposalとして提示。

### 5.3 proposal lifecycle

現在のtyped learning proposal:

- `spaced_memory_practice`
- `calibrate_memory_pace`

`それで`等の承認はproposal referenceへbindする。

`20分くらい`は`session_duration=20`として扱い、total durationにはしない。

### 5.4 observed pace

暗記の実績から本人の学習速度を観測する仕組みを実装済み。

例:

- 20分で35語進んだraw observationを保持。
- raw paceから220語のbase estimateを導出。
- observed profileをFact Graphの偽factとして注入しない。
- current explicit estimateがある場合はそれを優先。
- returning observed userでも、過去のsession durationをPreferenceとして勝手に再利用しない。

### 5.5 estimated duration safety reserve

estimated study timeには安全余白を設ける。

重要な分離:

```text
raw estimate
→ personal observed estimate
→ safety reserve
→ scheduling quantum / accepted session alignment
```

- estimated durationのみreserve対象。
- explicit durationは増やさない。
- default reserveは概ね10%。
- buffered durationを将来のpace学習に使わない。
- floating-point境界バグ修正済み。

例:

- 35語 / 20分 → 220語のraw estimate ≈ 125.714分。
- accepted session lengthが20分なら140分 = 20分×7回へalign。
- `20分だけ試す`は20分のまま。
- `1時間やる`は60分のまま。

### 5.6 task/component semantic boundary

崩れた入力

`英単語220 らいしゅう覚えたい ほか予定ない`

で、Lunaが

- task `atomic`
- しかしtaskと同義のcomponent `英単語`

を同時に作った問題を確認した。

一般semantic ruleとして、componentは独立したsubordinate targetを表し、taskの単なる言い換えやworkload containerのためだけに作らない、と整理した。

Real Luna再実行ではcomponents `[]`になり、構造的不整合は解消済み。

## 6. Prompt budgetの現在方針

以前はgeneric semantic request全体に`16,000 bytes`固定上限を置いていたが、これは削除済み。

理由:

- response JSON Schemaまで含むHTTP request全体の一枚岩上限であり、prompt責務を直接監視していなかった。
- 必要なsemantic ruleを数字合わせで削る逆転を招く。

残す監視:

- meaning policy size
- system prompt size
- orchestration overhead
- focused route個別budget
- focused routeがgeneric routeより十分小さいこと

16KBを16.5KB等へ引き上げたのではなく、全体固定上限そのものを削除した。

## 7. 現在のCI状態

Code baseline `981080506b155f958eb4acc1b61f6eee9c23dba1`では以下green。

- TypeScript checks
- full tests
- production build
- PR diff check
- Browser Regression run #606

handoff doc commitはdocs-onlyなので、次チャット開始時にcurrent HEADとCIを再確認すること。

## 8. 現在の最優先bug: workload `unitCode`のsemantic不収束

同じ意味の入力が、Real Lunaでcanonical representationまで収束していない。

通常の自然文では例として:

```text
unitCode: word
unitLabel: 語
```

一方、崩れた中学生風入力:

```text
英単語220 らいしゅう覚えたい ほか予定ない
```

では最新Real Luna runで:

```text
planningIntent: create_plan
planningWindow: next_week
activityKind: memorization_retrieval
amount: 220
unitCode: custom
unitLabel: 英単語
availability kind: no_additional_constraint
components: []
```

となった。

task/component構造は直ったが、`word` vs `custom`が残っている。

### 修正原則

やってはいけない:

```text
if sourceText contains "英単語" then unitCode = "word"
```

raw Japanese regex / keyword mappingは禁止。

まず問うべきこと:

- `unitCode`はAIが意味分類すべきsemantic fieldか。
- それともAIが返したtyped evidenceから一意にcanonicalizeできるapplication representationか。

意味分類が必要なら、finite unit codeの一般的な意味契約をsemantic policy/schema側へ最小限追加する。

決定論的に処理する場合もraw textではなくtyped semantic evidenceだけを使うこと。

`item`等の新unitを安易に増やさない。既存contractとscheduler mechanicsへの影響を監査してから判断する。

### 次の作業

1. current semantic meaning policy / schema / canonicalizer / workload testsを読む。
2. `word`と`custom`のownershipを決める。
3. one-elementの一般修正を行う。
4. targeted tests。
5. Real Lunaで同じ崩れ入力を再実行。
6. normal / broken inputsがapplication上同じ意味へ収束するか確認。

## 9. 次の未実装: insufficient capacity時のtyped proposal

現在、schedulerが`insufficient_capacity`を返すと概ね

```text
期間を広げる / 作業量を減らす / 利用可能時間を調整する
```

という一般statusになるだけ。

しかし暗記・想起系では現在のpolicyとして、容量不足時に段階的な選択肢を提案したい。

第一段階:

- new learningをやや長めのsessionへ。
- reviewを短く分散。
- mixed acquisition-review proposal。

それでも不足する場合:

- 全範囲をまず一巡する。
- 重要範囲へ絞って深める。
- 目標量 / planning horizonを変更する。

重要:

- applicationがtyped proposalを作る。
- Luna rendererは自然に説明するだけ。
- user acceptance前にschedulerへ勝手に反映しない。
- fixed Japanese branchを増やさない。

現在のlearning proposal kindは`spaced_memory_practice`と`calibrate_memory_pace`のみなので、この不足時proposal contractは未完成。

## 10. Real Luna persona auditの残件

一対話ずつ進める。

対象register / persona:

- lower elementary
- upper elementary
- middle school
- high school
- university
- adult
- casual / normal / polite / formal
- broken Japanese
- typo
- missing particles
- pronoun
- correction
- contradiction

既にlower / upper / university等で主要semantic convergence evidenceはあるが、最終semantic修正後に必要な範囲を再確認する。

特にhigh school / adult formalは完走evidenceが不足している。

exactなassistant文面は比較しない。

比較対象:

- planningIntent
- planning window
- task/category
- activityKind
- workload amount / quantityRole / canonical unit
- availability semantics
- proposal state
- Fact Graph active facts
- scheduler / preview consequence

## 11. Multi-turn Real Luna auditの残件

次の自然入力を一turnずつ使う。

proposal acceptance:

- `それで`
- `それでいい`
- `うんそれ`
- `その内容でお願いします`
- `その方針で問題ありません`

session duration:

- `20分くらい`
- `20ぷんぐらい`
- polite / formal equivalents

correction:

- `220語じゃなくて180語だった`

確認事項:

- prior 220 active factがsupersedeされる。
- active targetは180のみ。
- stale 220をschedulerが使わない。

context / pronoun:

- `これ来週まで。まだほぼやってない`

one-shot vs gradual:

- amount / deadline / availability / preference / material / progressを一発で与えるケース。
- 同じ情報を複数turnで徐々に与えるケース。
- 最終Fact Graph / application resultが意味上収束するか比較。

## 12. Fallback / dynamic dialogue audit

現状は大改修優先ではないが、最後に必ず確認する。

現在の構造:

- normal successful turn → `renderWeeklyPlanningStableV5AssistantMessage` → Luna renderer。
- provider/system failure → deterministic fallback / system message。

重要な確認:

- fallback用固定日本語をLuna promptへ渡していないこと。
- successful question/status/previewはdynamic Luna outputであること。
- provider failure時だけfixed fallbackが使われること。
- exact Japanese regression testがnormal-path品質仕様になっていないこと。

内部application textに固定日本語が残っていても、normal pathで最終発話として直接出ないなら即削除対象とはしない。owner boundaryを見て判断する。

## 13. Prompt simplificationの残件

Luna化で不要になったmodel-era scaffoldingは引き続き疑う。

原則:

- promptを長くして回避しない。
- regression固有exampleを増やさない。
- one-element ablationで削れるか確認する。
- meaning policy / schema / application validationの責務重複を探す。

特にfocused planning-window AI repairは再監査候補。

```text
AIが日付意味を理解
→ representation validation failure
→ raw date phraseをAIへ再送
→ canonical absolute windowを再生成
```

もしtyped evidenceから一意に決定できるならapplication converterへ移す。

ただしraw-text date parserを追加しない。

## 14. 実API workflow

Real Lunaの一turn検証は以下を使う。

Workflow:

`.github/workflows/weekly-planning-resumable-conversation-command.yml`

Command file:

`.github/weekly-planning-resumable-turn-command.json`

command fileを1回変更してpushすると、`gpt-5.6-luna`で1turnだけ実API実行する。

artifact:

`weekly-planning-resumable-conversation`

含まれるもの:

- checkpoint
- resume
- transcript
- latest-turn

重要:

- 連続pushしない。workflow concurrency cancellationを避ける。
- 1 runごとにassistant output / semantic raw output / graph / proposal / previewを確認してから次turnを決める。
- preset transcriptを品質oracleにしない。

最新の中学生boundary確認ではReal API run #160が成功し、task component issueは解消したが`unitCode: custom`を発見した。

## 15. 今やる順番

現在の推奨順序:

```text
1. unitCode semantic convergence
2. insufficient-capacity typed proposal
3. persona Real Luna completion
4. multi-turn correction / pronoun / short-answer audit
5. fallback / renderer final audit
6. prompt simplification final pass
7. docs / roadmap / contract synchronization
8. final CI + Browser Regression
9. final dynamic Real Luna conversation through preview
```

現時点で最初に触るのは`unitCode: custom` vs `word`問題。

## 16. PR completion gate

PR #130をmerge readyにする前に最低限以下を満たす。

- equivalent natural meanings converge to equivalent semantic/application state。
- no raw Japanese semantic regex/parser added。
- no stale vocabulary special heuristics reintroduced。
- proposal is not applied before acceptance。
- current-only acceptance is not silently promoted to durable preference。
- observed profile remains separate from explicit preference / Fact Graph utterance facts。
- estimated time reserve and explicit duration remain separate。
- correction supersedes stale active facts。
- insufficient-capacity behavior matches current typed proposal policy。
- normal dialogue is Luna-rendered; deterministic fixed text is fallback/system only。
- prompt responsibilities remain bounded without arbitrary whole-request byte guardrail。
- full TypeScript / Vitest / build green。
- Browser Regression green。
- final real-Luna dynamic conversation reaches preview and is human-reviewed。
- no save before explicit approval。
- roadmap / current contract / task docs match final HEAD。

## 17. 別チャット開始時の最初の指示として使える短縮版

```text
StudyPlannerのPR #130、branch agent/weekly-conversation-quality-luna-audit の作業を続けてください。
新branch/PR/Issueは作らず、mergeもしないでください。
最初に docs/ai/tasks/20260816-pr130-conversation-quality-handoff.md と mandatory references を読んでcurrent HEAD/CIを確認してください。
今の最優先は、Real Lunaで同じ意味の「英単語220語」が unitCode: word と unitCode: custom に揺れるsemantic convergence問題です。
raw Japanese regex/keyword/parserは禁止です。意味が曖昧な間はAI、意味が一意になった後はapplicationという責務境界を守って、owner layerを特定して一般修正してください。
修正後はtargeted test→Real Luna one-turn→結果確認の順で進めてください。
```
