# 週間計画 AI意味理解責務 Phase 2設計

Status: approved for implementation
Date: 2026-08-03
Parent task: `docs/ai/tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md`
Audit: `docs/ai/audits/20260803-weekly-planning-semantic-ownership-phase0-phase1.md`
Branch: `agent/weekly-ai-conversation-eval`

## 目的

Stable V5の意味理解をAIへ一元化し、AIが現在発話、会話履歴、machine pending question、Fact Graphの公開状態を読んで、予定作成に必要な意味文書を生成できる構造へ戻す。

決定論的後段はAI文書を別の日本語parserで置換せず、schema、参照、revision、安全な状態遷移だけを検証する。

## 七視点監査

### 1. 利用者対話

短答、訂正、承認、複数作業、相対日付を固定文言でしか理解できない状態を禁止する。AIへ直前質問と対象Factを機械可読に渡し、ユーザーの表現が変わっても意味文書を生成させる。

### 2. 意味schema

既存の `SemanticEffortEstimateV5.targetLocalId` をtaskまたはcomponentに限定しない。workloadも正式な対象とする。これにより「40問に3時間」を、40問のworkloadと、それを対象とするtotal durationとしてAIが直接表現できる。

新しい巨大なanswer専用schemaは追加しない。既存schemaで意味を表現できる場合は、validatorの誤制約を直す。

### 3. validator・canonicalizer

validatorはlocalIdの存在と参照可能kindを確認する。title、sourceText、語句、数量表現から対象を選び直さない。

canonicalizerはAIが選んだlocalIdまたはpublicIdを正式IDへ結び付ける。文字列類似で別対象を推測しない。pending questionと対象が不一致ならfail closedとする。

### 4. Fact Graph・状態遷移

AI文書が表したtask、workload、effort、correction、decisionを原子的に適用する。途中失敗時はturn前revisionへrollbackする。古いpreview、二重承認、二重保存は拒否する。

### 5. dialogue・plan生成

意味文書の受理後、readiness判定とschedulerがFact Graphから内部プランを生成する。dialogue rendererは結果を自然文へ変換するだけで、意味を補わない。

AIが意味理解を行うことと、最終配置を決定論的schedulerが安全に計算することを分離する。AIの責務は「何を、どれだけ、いつまでに、どの条件で行うか」の意味表現までである。

### 6. 永続化・観測

raw AI response、accepted semantic document、validation error、repair responseをtraceへ残す。rawからacceptedへ意味要素が追加、削除、分割、上書きされた場合に検知可能にする。

### 7. テスト・運用

特定の日本語文を通すpatchではなく、語彙、教科、数量、単位を変えたproperty的ケースで責務境界を固定する。provider failureやvalidation failure時にparser fallbackしない。

## 変更範囲

上流変更は次に限定する。

1. effort estimateがtask、component、workloadを参照可能にするvalidator修正。
2. contextual short-answer、creation authorization、direct work coverage、task boundary、planning window source再解釈をproduction上で無効化する。
3. 完全一致duplicate workload除去だけを維持する。
4. repairはschema・参照・範囲エラーだけをAIへ返す。
5. architecture regression testを追加する。

scheduler、preview、保存、rendererの既存安全制御は変更しない。legacy runtimeへ戻さない。

## 実装順序

### 下流A: schema参照修正

validator内でtask配下のworkload localIdを収集し、effort estimateのtarget候補へ追加する。component配下とtask直下の双方を対象とする。

### 下流B: 後段意味parserの除去

既存importと呼出互換性を保ちながら、意味parser helperをproductionでは無効化する。AI raw responseを検証前に置換しない。

### 下流C: validator専用化

planning windowはkind/valueの列挙と形式のみ検証する。sourceTextから値を再計算しない。task boundaryは自動改名・自動分割せず、矛盾をAI repairへ返すかfail closedとする。

### 下流D: test固定

valid AI responseが後段で別文書へ置換されないこと、workload-target effortが受理されること、creation authorizationや短答がAI responseなしに成功しないこと、完全一致duplicate以外を統合しないことを固定する。

## 受け入れ条件

AIが生成したworkload-target effort estimateがvalidatorを通る。

AI raw responseは、完全一致duplicate workload除去を除き、後段で意味的に置換されない。

ユーザー文だけからcreate_plan、短答document、作業欠落、task分割、相対日付を決定するproduction経路がない。

AI文書が不正なら最大1回のrepair後にfail closedとなる。

Fact Graphからreadiness、scheduler、previewまで進める既存経路を維持する。

七視点監査の各境界をarchitecture testとtask文書から追跡できる。

## 今回変更しない事項

AIに自由文の最終スケジュールを直接保存させない。内部プランの時間配置はschedulerが行う。

意味理解を再び正規表現、語句辞書、scenario固有分岐へ戻さない。

実API評価が失敗した場合も、まずraw response、schema、validator、ID binding、Fact Graph適用の順で調査し、新しいparserを追加しない。
