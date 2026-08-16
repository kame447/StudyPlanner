# PR #130 週間計画 会話品質・Luna監査 引き継ぎ

Status: active / final verification
Updated: 2026-08-16
PR: #130 `Audit weekly-planning conversation quality on Luna`
Branch: `agent/weekly-conversation-quality-luna-audit`
Base: `main`

この文書はPR #130を別チャットから継続するための現在状態だけを示す。過去の詳細なReal Luna evidenceは監査文書へ分離し、この文書へ古い未解決事項を積み重ねない。

## 1. 守ること

- 新しいbranch / PR / Issueを作らない。
- PR #130の同じbranchだけで続行する。
- PRはdraft・未mergeのまま維持する。明示指示なしにmerge ready化・mergeしない。
- raw Japanese regex / keyword parserでsemanticを上書きしない。
- regression固有の日本語固定文やphrase-specific guardrailで問題を隠さない。
- 失敗を見つけたturnで止まり、owner layerを特定して一般契約として直してから続行する。
- assistant文面の完全一致ではなく、semantic / Fact Graph / application state / preview consequenceを品質oracleにする。
- checkpoint確認は単発成功で終えず、10-loop単位で状態持ち回りを確認する。

Mandatory references:

- `docs/ai/tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md`
- `docs/ai/tasks/20260814-weekly-planning-conversation-quality-luna-audit.md`
- `docs/ai/strategy/weekly-planning-adaptive-memory-learning-policy.md`
- `docs/ai/strategy/weekly-planning-semantic-v5-roadmap.md`
- `docs/ai/weekly-planning-current-contract-v5.md`
- `docs/ai/audits/20260816-pr130-context-reference-persona-luna-audit.md`
- `docs/ai/audits/20260816-pr130-ten-loop-checkpoint-audit.md`

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
- scheduler / preview / approval / save
- persistence
- observed pace calculation / long-term adaptation

AIにcanonical IDや算術をやらせない。

## 3. 現在までに解消した主要論点

### semantic unit convergence

以前残っていた`英単語`の`word` vs `custom`不収束は解消済み。

Real Luna 10-loopの初回turnで、英単語180語は`word` / `語`、数学40問は`problem` / `問`へstandard unitとして収束している。

raw Japanese keyword mappingは追加していない。

### insufficient capacity proposal

古いhandoffでは未実装だったが、現在は`mixed_acquisition_review` typed proposalが存在する。

`insufficient_capacity`かつaccepted spaced-memory proposalの対象が未配置の場合、applicationがtyped proposalを生成し、Lunaはそれを説明する。ユーザー承認前に勝手に適用しない。

### no additional constraint / memorization generalization / proposal lifecycle / observed pace

以下は実装・監査済み。

- `no_additional_constraint`をpositive availabilityへ誤変換しない。
- vocabulary固有heuristicを標準規則にしない。
- `spaced_memory_practice` / `calibrate_memory_pace` proposal lifecycle。
- qualitative progressから具体量を捏造しない。
- observationとdurable preferenceを分離。
- estimated durationのsafety reserveとexplicit durationを分離。
- task/component boundaryを一般semantic契約として整理。

## 4. 今回の10-loopで追加修正した内容

### repair policy重複

relative date canonicalizationを全repair requestへ無条件に足していたため、error-local repair契約とprompt budgetを壊してCIがredになっていた。

relative date解釈を共有semantic meaning policyへ戻し、repairは実際に出たvalidation errorだけに反応する形へ整理した。

### uncertainty self-reference

referentが未確定のuncertaintyが自分自身をtargetにしても通る穴をdeterministic evidence validationで閉じた。

referent自体が未確定ならdocument/root、既にsupportされた対象がある場合だけそのfactへ向ける。

### effort measurement drift

Real Lunaでapplicationが`1問あたり`を尋ねる判断をしているのにrendererが`1回あたり`と発話するsemantic driftを発見した。

数学固有の固定文ではなく、rendererへ一般契約として次を与えた。

```text
duration_per_unit = 1単位あたり
session_duration = 1回
total_duration = 全体
```

修正後の同一turn Real Luna rerunでは`数学の問題40問は、1問あたり何分くらいかかる想定ですか？`へ収束した。

## 5. 10-loop Real Luna checkpoint

詳細は `docs/ai/audits/20260816-pr130-ten-loop-checkpoint-audit.md`。

同一conversationを10 turn継続して以下を通した。

1. 英単語180語 + 数学40問を同時投入。
2. spaced-memory proposalへの短答承認。
3. `20分くらい`を英単語session durationへbinding。
4. pace-calibration承認後、数学のper-problem effort質問。
5. `5分くらい`を数学1問あたりへbindingしてpreview。
6. 数学40問→30問へpreview後訂正。1問5分を新workloadへcarry。
7. 英単語=金曜、数学=日曜の別deadlineを同一turnで追加。
8. 英単語=夜のsoft preferenceと火曜18:00-20:00 unavailableを同一turnで追加。
9. `数学の方はやっぱ土曜までで`で数学deadlineだけを訂正。
10. `英単語は夜じゃなくて朝がいい`でpreferenceだけを訂正して再preview。

最終active meaning:

- 英単語180語。
- 英単語は1回20分のpace calibration、金曜まで、朝希望。
- 数学30問。
- 数学は1問5分、土曜まで。
- 火曜18:00-20:00利用不可。
- uncertaintyなし。
- preview candidate 3件。
- 全candidate未承認。

最終preview:

```text
2026-08-17 06:00-06:20  英単語180語（ペース計測）
2026-08-18 09:00-10:25  数学の問題 15問（1〜15問）
2026-08-19 09:00-10:20  数学の問題 15問（16〜30問）
```

Turn 6/9/10で旧workload / deadline / preferenceはそれぞれsupersededされ、unrelated active factsは維持された。

## 6. Fallback / dynamic dialogue

静的監査と10-loop実測で確認済み。

- normal successful turnはLuna renderer。
- fallback用固定日本語はnormal Luna promptへ渡していない。
- 10-loopのassistant outputはnormal AI path。
- provider/system failure時のみdeterministic fallbackを使う責務境界を維持。

## 7. 現在の残件

10-loop checkpoint自体は完了した。

PR #130をmerge-readyとみなす前に残る確認は次。

- 最終文書同期後HEADでfull CI green。
- 同じHEADでBrowser Regression green。
- 必要ならone-shot vs gradualの追加semantic convergence evidenceを取る。ただしproposal lifecycleを含む会話では、one-shotとmulti-turnの表面状態を無理に完全一致させず、同じ明示factのcanonical meaningを比較する。
- persona batchで新しいsemantic contract変更の影響が疑われる場合だけ、既存Real Luna evidenceから不足箇所を追加確認する。既に通った全personaを機械的に再実行しない。

## 8. 完了判定

次の全条件が満たされたときだけclean checkpointとする。

- 10-loop監査完了。
- 10-loop中に見つかった一般バグのtargeted regression testあり。
- normal rendererがapplication decisionの意味を変えない。
- correction後にstale active factが残らない。
- previewがactive constraintsを使う。
- user approval前に保存しない。
- final HEADのCI green。
- final HEADのBrowser Regression green。
- PRはdraft / unmergedのまま。
