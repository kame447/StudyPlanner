# Stable V5 full debug trace

Status: active development-only observability overlay
Updated: 2026-07-27
Scope: Draft PR #86 / branch `agent/studyplanner-refactor`

この文書は、実ユーザー投入前のStable V5デバッグ期間に限り、意味解釈と決定処理を再現可能にするための完全トレース契約を定める。この期間はprompt、provider raw response、validation result、repair request、canonicalization result、scheduler input、判断根拠を暗号化せず既存週間計画trace repositoryへ保存する。

この開発時overlayは、`weekly-planning-current-contract-v5.md` §10にあるraw provider response非保存方針より優先する。実ユーザー投入前に保存範囲、暗号化、アクセス制御、retentionを再設計し、このoverlayを終了またはproduction向け契約へ置換する。

## 1. request単位の収集

各Stable V5 requestは`traceRequestId`を相関IDとして、実行開始時にrequest-local collectorを初期化する。収集eventはrequest内で単調増加するsequence、stage、occurredAt、severity、dataを持つ。

collectorは同時実行requestを混在させない。完了、失敗、stale discard、commit rejectのいずれでも一度だけ取り出し、既存turn traceへ保存した後にmemoryから消費する。active requestの上限は128とし、無制限なmemory保持を避ける。

## 2. 保存する段階

次の段階を順序付きで保存する。

```text
runtime_turn_input
runtime_configuration_evaluated
runtime_session_context_prepared
semantic_pipeline_input
semantic_normalizer_prepared
semantic_provider_request
semantic_provider_response
semantic_provider_error
semantic_validation_result
semantic_repair_prepared
semantic_normalizer_decision
semantic_normalization_completed
contextual_question_inference
contextual_answer_binding_evaluated
semantic_canonicalization_evaluated
scheduler_compilation_evaluated
semantic_pipeline_decision
runtime_semantic_result_received
runtime_graph_staged
runtime_scheduler_dialogue_evaluated
runtime_preview_scheduler_evaluated
runtime_branch_selected
runtime_turn_output
runtime_turn_threw
```

初回provider callとrepair callは`attempt=initial|repair`で区別する。providerへ実際に送ったmessages、temperature、response format、purpose、max completion tokensを保存する。providerから返った文字列を加工前の`rawResponse`として保存する。

## 3. 判断根拠

単なる最終statusではなく、各決定の入力、候補、採否、理由を保存する。

contextual short-answer bindingでは、直前assistant message、文字列一致rule、選択されたquestion code、user text length、sourceText一致、expected revision、actual graph revision、semantic document内の各fact件数、binding適用結果を保存する。

canonicalizationでは、入力Graph、AI semantic document、conversation、turn、expected revision、contextual bindingと通常canonicalizerのどちらを使ったか、result status、diff、local IDからcanonical fact IDへの対応、rejection errorを保存する。ここでの`diff`を採用operation一覧として扱う。

runtimeでは、AI設定の採否、commit前Graph、active planning window、計画期間解決規則、選択日、recent conversation、public state summary、staged Graphを保存する。API key等のcredentialは保存しない。

最終schedulerでは、active Graph view、resolved horizon、named time period、existing plans、時間割、calendar source失敗、compile結果を保存する。semantic pipeline内の予備compileと、runtimeで外部予定を加えた最終compileを別stageとして記録する。

dialogueでは、全issue、blocking判定、domain priority、sort key、選択されたquestion、質問対象label、rendered messageを保存する。作成許可についてはAI documentのplanning intentと`planningIntent === create_plan`という判定式を保存する。

previewでは、scheduler version、全入力、既存予定、時間割、day start/end、break、session分割、buffer、all-or-nothing規則、候補、未配置work itemを保存する。各return分岐ではbranch名、判断根拠、最終compatibility state、assistant message、candidateを保存する。

## 4. 保存形式

各logical debug stageを、既存trace repository内の独立した`internal_event`として保存する。event typeは次である。

```text
stable_v5_debug_stage
```

各entryは同じ`requestId`を持ち、payloadに`debugSequence`、`stage`、`stageOccurredAt`、`data`を保持する。これにより一つの巨大state snapshotに全データを押し込まず、stage単位で検索、比較、再構成できる。

通常サイズのstageは次の形式で保存する。

```json
{
  "eventType": "stable_v5_debug_stage",
  "payload": {
    "debugSchemaVersion": 1,
    "debugSequence": 0,
    "stage": "semantic_provider_request",
    "stageOccurredAt": "2026-07-27T00:00:00.000Z",
    "storage": "inline_json",
    "serializedBytes": 1234,
    "data": {}
  }
}
```

state snapshot内には全eventを重複保存せず、次の要約だけを残す。

```json
{
  "__stableV5DebugTrace": {
    "schemaVersion": 1,
    "eventCount": 24,
    "storage": "stable_v5_debug_stage_entries"
  }
}
```

trace runtimeが生成するsnapshotには、logical event数に加えて、chunk分割後のphysical entry数である`persistedEntryCount`も記録する。

既存trace exportはinternal eventをそのまま含むため、別repository、別session、別export形式を増やさず、user turn、assistant turn、graph summary、compatibility stateと同じrequestIdで照合できる。

## 5. 大容量stageの無損失分割

1stageのUTF-8 JSONが350000 bytesを超える場合、そのJSONを350000 bytes単位へ分割し、各byte chunkをbase64へ変換して複数の`stable_v5_debug_stage` entryとして保存する。

```json
{
  "storage": "base64_utf8_json_chunk",
  "encoding": "base64-utf8-json",
  "chunkIndex": 0,
  "chunkCount": 4,
  "totalSerializedBytes": 1200000,
  "chunkBytes": 350000,
  "dataChunk": "..."
}
```

同じlogical stageから生成されたchunkは同じ`debugSequence`と`stage`を持つ。`chunkIndex`順にbase64 decodeし、得られたbyte列を連結してUTF-8 decodeした後、JSON parseすれば元のstage dataを再構成できる。

この方式により、一つのstageが大きい場合も800000 bytes超過による全payload縮約を避ける。各physical entryはFirestore一documentの上限より十分小さく保つ。

## 6. revisionの記録

基礎traceの`interpreter_started.previousGraphRevision`は、最終revisionから1を引いて推測しない。`runtime_session_context_prepared`または`semantic_pipeline_input`に記録された実際の入力Graph revisionを使用する。

各debug stage entryの`stateRevision`も、そのstage dataに含まれる`graphRevision`、`expectedRevision`、入力Graph、runtime session、result Graphから可能な範囲で決定する。判断に使用したrevisionそのものはstage dataにも残す。

これにより、実際のrevision巻き戻りと、ログ生成側の誤ったrevision推測を区別できる。

## 7. staleとcommit reject

staleになった非同期結果とcommit拒否もdebug collectorを破棄せず保存する。staleでは`stale_async_result_discarded`、commit拒否では`request_cancelled`を記録する。

破棄された結果のassistant messageとpreview candidateは診断metadataとして保存するが、実際のassistant turnや`preview_generated`としては記録しない。sessionの`hasPreview`も立てない。

## 8. credential除外

API key、authorization、password、cookie、access token、refresh token等のcredential fieldは従来どおり除外する。それ以外のprompt本文、provider raw response、Graph、validator output、scheduler inputとresult、判断基準は保存する。

大容量stageはcredential除外とJSON-safe変換を行った後にchunk化する。したがってbase64化によってcredential filterを迂回しない。

## 9. テスト

collectorについて、stage順序、record時clone、consume-once、request IDなしの無視を検証する。

semantic normalizerについて、完全なsystem/user messages、raw initial response、parse result、invalid initial response、repair messages、raw repaired responseを検証する。

runtime executorについて、configuration、session context、semantic result、staged Graph、最終scheduler、dialogue、preview、return branchを検証する。

trace runtimeについて、logical stageごとの独立entry、実入力revision、350000 bytes超過stageのchunk分割と完全再構成、stale結果の非preview扱いを検証する。

turn side effectについて、request-local debug event列がtrace runtimeへ渡され、state snapshotには要約だけが残り、保存後にcollectorから消費されることを検証する。

GitHub Actionsがrunner起動前にstep 0件で失敗している間は、テスト成功とは記録しない。focused test、full Vitest、typecheck、build、実ブラウザtrace exportの確認が完了するまでPR #86をDraftのまま維持する。
