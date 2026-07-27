# Stable V5 full debug trace

Status: active development-only observability overlay
Updated: 2026-07-27
Scope: Draft PR #86 / branch `agent/studyplanner-refactor`

この文書は、実ユーザー投入前のStable V5デバッグ期間に限り、意味解釈と決定処理を再現可能にするための完全トレース契約を定める。この期間はprompt、provider raw response、validation result、repair request、canonicalization result、scheduler input、判断根拠を暗号化せず既存週間計画trace repositoryへ保存する。

この開発時overlayは、`weekly-planning-current-contract-v5.md` §10にあるraw provider response非保存方針より優先する。実ユーザー投入前に保存範囲、暗号化、アクセス制御、retentionを再設計し、このoverlayを終了またはproduction向け契約へ置換する。

## 1. request単位の収集

各Stable V5 requestは`traceRequestId`を相関IDとして、実行開始時にrequest-local collectorを初期化する。収集eventはrequest内で単調増加するsequence、stage、occurredAt、severity、dataを持つ。

collectorは同時実行requestを混在させない。完了または失敗時に一度だけ取り出して既存turn traceへ埋め込み、その後memoryから消費する。active requestの上限は128とし、無制限なmemory保持を避ける。

## 2. 保存する段階

次の段階を順序付きで保存する。

```text
runtime_turn_input
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
runtime_turn_output
runtime_turn_threw
```

初回provider callとrepair callは`attempt=initial|repair`で区別する。providerへ実際に送ったmessages、temperature、response format、purpose、max completion tokensを保存する。providerから返った文字列を加工前の`rawResponse`として保存する。

## 3. 判断根拠

単なる最終statusではなく、各決定の入力、候補、採否、理由を保存する。

contextual short-answer bindingでは、直前assistant message、文字列一致rule、選択されたquestion code、user text length、sourceText一致、expected revision、actual graph revision、semantic document内の各fact件数、binding適用結果を保存する。

canonicalizationでは、入力Graph、AI semantic document、conversation/turn/expected revision、contextual bindingと通常canonicalizerのどちらを使ったか、result status、diff、local IDからcanonical fact IDへの対応、rejection errorを保存する。ここでの`diff`を採用operation一覧として扱う。

schedulerでは、active Graph view、scheduler context、external source snapshot、compile結果、選択statusとその根拠を保存する。runtime出力ではcompatibility state、質問、lastQuestionContext、draft authorization、preview件数、failure、assistant messageを保存する。

## 4. 保存場所

request-local event列は既存`recordWeeklyPlanningStableV5TurnTrace`へ渡す`compatibilityState`内の次のfieldへ埋め込む。

```text
state.compatibilityState.__stableV5DebugTrace
```

構造は次の通りである。

```json
{
  "schemaVersion": 1,
  "eventCount": 0,
  "events": []
}
```

これにより既存trace exportへ自動的に含まれ、別repository、別session、別export形式を増やさず、user/assistant turn、graph summary、compatibility stateと同じrequestIdで照合できる。

## 5. 保存上限

Firestore一documentの制約を超えないよう、trace sanitizerの安全上限を`maxSerializedBytes=800000`とする。文字列上限は250000文字、配列要素とobject keyは各5000、depthは16とする。通常のprompt、raw response、Graph、scheduler resultはこの範囲内で全文保存する。

800000 bytesを超えたpayloadは、repository write自体を失敗させないため縮約値へ置換される。したがって「無制限の全データ保存」ではなく、「Firestore document制約内での完全保存」である。将来これを超える場合は、debug eventを複数entryへchunk分割する。

API key、authorization、password、cookie等のcredential fieldは従来どおり除外する。prompt本文は`messages[].content`、provider出力は`rawResponse`として保存されるため、promptを除去する旧key filterには該当しない。

## 6. テスト

collectorについて、stage順序、record時clone、consume-once、request IDなしの無視を検証する。

semantic normalizerについて、完全なsystem/user messages、raw initial response、parse result、invalid initial response、repair messages、raw repaired responseを検証する。

turn side effectについて、request-local debug event列が既存state snapshotへ埋め込まれ、保存後にcollectorから消費されることを検証する。

GitHub Actionsがrunner起動前にstep 0件で失敗している間は、テスト成功とは記録しない。focused test、full Vitest、typecheck、build、実ブラウザtrace exportの確認が完了するまでPR #86をDraftのまま維持する。
