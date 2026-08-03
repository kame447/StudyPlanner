# 週間計画 部分意味受理と曖昧性修復

Status: active / P0 semantic implementation
Date: 2026-08-03
Issue: #108
PR: #109
Branch: `agent/weekly-ai-conversation-eval`
Parent work: `20260803-weekly-planning-ai-semantic-ownership-reset.md`

## この記録の目的

AIの意味出力を「完全に確定したSemantic Document」へ必ず押し込む現在の契約を見直し、解釈できた部分は受理し、解釈できない部分は未確定のまま保持して、対象を限定した聞き返しで修復できる意味モデルを設計・実装する。

本taskはIssue #108、`agent/weekly-ai-conversation-eval`、PR #109をそのまま継続する。新しいbranchまたはPRは作成しない。PR #109で進めてきたAI semantic ownership reset、schema・validator・formal binding整理を前提に、現在の実装との差分だけを同じbranchで追加する。

## 2026-08-03 引き継ぎ棚卸し

### 再利用する作業単位

- Issue: #108
- Branch: `agent/weekly-ai-conversation-eval`
- PR: #109
- 新規Issue、branch、PR: 作成しない

### 現在の実装到達点

- Stable V5だけがapplication runtimeから到達する。
- 自然言語、短答、訂正、承認、数量役割、日付、task境界の意味理解はAIへ一元化されている。
- 決定論的後段はschema、参照、revision、formal target binding、Fact Graph transaction、readiness、scheduler、preview、saveを担当する。
- provider failureまたはvalidation failureから日本語parserへfallbackしない。
- machine-readable pending questionにquestion code、target Fact、Graph revisionを保持する。
- effort estimateはtask、componentに加えてworkloadもexact localIdで参照できる。
- raw AI response、accepted document、validation、repair、canonicalization、renderer decisionをtraceできる。

### 最新CIの実測

最新headに対する通常CIでは、TypeScript checkは成功し、全Vitestは次の2件だけ失敗した。

1. 正しい所要時間回答をworkloadとして偽装した古いfixtureが、後段による意味変換を期待している。
2. semantic promptに必要なpending question指示は存在するが、testが古い短い文言との完全な部分一致を期待している。

この2件は、AIが意味を表現し、後段は検証だけを行う現在の責務境界へtestを同期する。production側へ日本語parserまたは単位変換による意味補正は追加しない。

### 思想競合の確認結果

次の二つは競合しない。

```text
JSON、型、参照、列挙値が壊れている
→ 最大1回のAI形式repair
→ 再失敗ならstructural failureとしてfail closed

意味が一意に決まらない
→ 有効なpartial semantic resultとして受理
→ 確定部分を保持
→ 未確定部分だけを聞き返して解消
```

`fail closed`は構造的に信頼できない出力へ適用する。semantic ambiguityをtechnical failureとして扱わない。

### 既存uncertaintyとの統合方針

Semantic DocumentとFact Graphには既に`uncertainty`がある。新しいambiguity台帳を並立させず、既存概念を拡張する。

現行uncertaintyはtarget、field、reasonだけを保持し、次を表現できない。

- 候補となる複数解釈
- clarificationの回答形式
- machine-readable question code
- pending questionへ渡す対象
- unresolved、awaiting answer、resolved等の状態
- clarification回答による局所解消

したがって、既存uncertaintyを後方互換性に配慮して拡張し、曖昧性の正本とする。

### scheduler境界

現在のscheduler viewはuncertainty自体を入力へ渡さない。一方、曖昧な内容を通常のactive task、workload、constraintとして保存するとschedulerへ混入する。

そのため、未確定の意味要素を通常のresolved Factと区別し、scheduler、preview、approval、saveにはresolved Factだけを公開する境界が必要である。

## 観測した根本問題

現状は、AIが各発話を既存の確定済みFact型へ当てはめる前提が強い。発話の一部は理解できるが、日付の係り先、対象、数量の意味、照応先などが一意に決まらない場合でも、AIは次のいずれかを迫られる。

- 既存型のどれかへ推測して押し込む
- 曖昧な要素を落として形式だけ成立させる
- schemaに収まらずvalidation failureになる

その後の「同じ内容をそのままもう一度送ってください」という処理は、ユーザー入力に問題がないにもかかわらず再入力を要求し、同じ失敗を反復させる。意味の曖昧さとJSON・schemaの構造破損も同じ失敗経路へ畳み込まれている。

## 最上位設計原則

1. 自然言語と会話文脈の意味理解はAIだけが担当する。
2. AIは、確定できない意味を推測して確定Factへ変換しなくてよい。
3. 確定部分と未確定部分を同一turnから分離して表現できなければならない。
4. 未確定部分は失敗ではなく、正常な部分解釈結果として受理する。
5. 決定論的coreは、AIが示した曖昧性の構造・参照・候補整合性を検証するが、ユーザー文を読み直して意味を選ばない。
6. scheduler、preview、approval、saveには確定済みFactだけを渡す。
7. 聞き返しへの回答は、保存済みのambiguity ID、target ID、pending question、Graph revisionへ結び付け、発話全体を再解釈して置換しない。
8. JSON破損、未知field、参照破損などの構造障害と、意味が一意に決まらない状態を別のstatusとして扱う。
9. provider failureまたは構造障害時にparserへfallbackしない。
10. 「同じ文章を再送してください」を通常の意味修復経路として使用しない。
11. PR #109で確立したAI semantic ownership、exact target binding、transaction safety、trace contractを弱めない。
12. 個別scenarioを通すための日本語語句、教科、単位、数量の列挙patchをproductionへ追加しない。

## 目標となる意味結果

正確な型名はPhase 1で確定するが、少なくとも次の状態を区別できる契約が必要である。

```text
accepted_complete
accepted_with_ambiguity
clarification_required
structural_failure
provider_failure
```

`accepted_with_ambiguity`と`clarification_required`は正常な会話進行であり、normalization rejectionとして扱わない。

一つのturnは概念上、次を同時に含められるようにする。

- 確定して受理できるFact
- 不完全だが発話由来として保持すべき意味断片
- 曖昧なsource spanまたはsemantic element
- 候補解釈
- clarification target
- expected answer type
- pending questionへ保存するformal reference

## 例

ユーザー発話:

```text
明日までにレポートやって、英単語も少し
```

受理してよいもの:

- `レポート`という作業
- `英単語`という作業

未確定として保持するもの:

- `明日まで`がレポートの締切、全体planning window、両方のどれか
- `少し`の具体的な作業量

質問例:

```text
「明日まで」は、レポートの締切ですか？ それとも今回の予定を明日までにするという意味ですか？
```

この質問は、元発話全体を拒否した結果ではなく、確定部分を保持したGraph revision上で、特定のambiguityを解消するために行う。

## 非目的

- 自由形式の曖昧なデータをそのままschedulerへ渡すこと
- 後段の正規表現、語句辞書、heuristic parserで曖昧性を解消すること
- AIのconfidence数値だけで自動採用・自動破棄すること
- provider failureをユーザーの説明不足として扱うこと
- 今回の一例だけを通すscenario固有patchを追加すること
- AIに最終的な時刻配置を自由文で作らせ、そのまま保存すること
- PR #109の実API評価基盤、preview安全性、承認・保存transactionを作り直すこと

## PR #109内の実装順

### 現在の安定化作業

- 最新CIで失敗している2件を、AI semantic ownershipに沿う形へ修正する。
- focused test、full test、typecheck、build、diff checkを緑に戻す。
- 古いtest期待を削るだけでなく、AI文書が正しい意味を表現した場合だけ成功することを固定する。

### 本taskで追加するもの

- partial semantic acceptanceのresult envelope
- 拡張uncertainty / ambiguity / clarification contract
- 未確定Factのlifecycleとpersistence
- clarification answerによる局所解消
- resolved-only scheduler view
- technical failureとsemantic ambiguityの分離
- 再送ループ防止

### 重複回避

PR #109で既に実装済みの次は再実装しない。

- AI semantic ownership reset
- 後段の自然言語再解釈除去
- workload-target effort schemaとvalidator
- machine pending question
- exact formal target binding
- staged Graphとruntime resultの整合
- 実API会話基盤とtrace

## 実装フェーズ

### Phase 0: current contract audit

Status: complete

- Semantic Document V5が確定Factだけを前提としている箇所を確認した。
- normalizer、validator、canonicalizer、Fact Graph、pending question、scheduler view、renderer、persistence、traceのreject条件を確認した。
- validation failureを、構造障害、参照障害、意味的曖昧性、schema表現力不足へ分類した。
- 既存uncertaintyと新しいambiguity概念の重複を確認し、既存概念を拡張する方針とした。

### Phase 0.5: deterministic foundation stabilization

Status: active

- AIが所要時間として返した意味文書だけをpending workloadへ結合するtestへ更新する。
- prompt trace testを、古い文面ではなくmachine pending questionの権威性とassistant文面非依存を固定するassertionへ更新する。
- full CIを再実行する。

### Phase 1: result envelopeと拡張uncertainty設計

- complete、partial、clarification、structural failure、provider failureをdiscriminated unionとして分ける。
- existing uncertaintyを拡張し、stable ID、候補、expected answer type、question code、resolution stateを持たせる。
- source evidence、candidate interpretation、target referenceの最小契約を決める。
- AI自由生成の質問文をsemantic authorityとして使わない。
- 旧保存データを読み込める後方互換境界を決める。

### Phase 2: validatorとGraph lifecycle

- partial resultを正常受理できるvalidatorを追加する。
- 構造的に壊れた出力だけをrepair対象にする。
- unresolved、awaiting clarification、resolved、superseded、removed等の状態関係を定義する。
- unresolved Factをactive scheduler viewから除外する。
- 同一turnの確定Factと未確定Factを原子的に保存する。
- Graph validator、storage decoder、trace schemaを同期する。

### Phase 3: clarification transaction

- ambiguity IDとGraph revisionをpending questionへ保存する。
- AIが直前質問への回答として選択、訂正、追加情報を返せる契約を作る。
- 回答により対象ambiguityだけをresolveし、無関係なFactを再生成しない。
- stale answer、target消失、revision mismatchは意味を推測せず拒否する。
- reload、close/reopen後も同じclarificationを継続する。

### Phase 4: dialogue and failure recovery

- semantic ambiguityでは具体的な聞き返しを返す。
- structural failureでは最大1回のAI形式repairを行う。
- repairも失敗した場合、受理済みGraphを保持し、内部障害として扱う。
- provider failureは内部障害として扱い、ユーザーに同文再送を要求しない。
- 同一入力hashと同一failure classの反復を検知してループを防ぐ。
- controlled recoveryが意味を推測する日本語parserにならないことを固定する。

### Phase 5: verification

- unit / property / integration tests
- multi-turn clarification tests
- reload / close-reopen persistence
- stale clarification response
- multiple simultaneous ambiguities
- correctionとclarificationの競合
- preview前後のambiguity発生
- trace persistence / outbox retry / Worker preparation / size boundary
- actual OpenAI semantic eval
- actual conversation eval
- transcriptとraw semantic artifactの七視点監査

## 必須テスト観点

- 一つの発話から確定Factと曖昧Factを同時に保存できる。
- 曖昧Factがscheduler inputへ混入しない。
- valid partial responseをvalidatorがrejectしない。
- AIが候補を一つに決められない場合、候補を勝手に採用しない。
- clarification回答が指定されたambiguityだけを解消する。
- unrelated Fact、preview、authorizationを巻き戻さない。
- reload後もpending ambiguityと質問対象が継続する。
- 同じ入力をそのまま再送させる応答へ戻らない。
- provider failure、malformed JSON、semantic ambiguityを同じstatusへ畳み込まない。
- productionコードへ日本語の意味判定regexを追加しない。
- raw AI response、partial accepted result、Graph diff、clarification targetがtraceを通過する。
- 初回trace append失敗後のoutbox retryでも曖昧性情報を失わない。
- Worker preparation後もdocument size上限内に収まる。

## 受け入れ条件

- 部分解釈が正常結果として型に表現される。
- AIが分からない要素を未確定のまま受理できる。
- 確定済み部分は失われず、Graph revisionへ保存される。
- 曖昧な部分だけを対象に一問ずつ聞き返せる。
- 回答後に対象部分だけを確定Factへ昇格できる。
- scheduler、preview、saveはresolved Factだけを使用する。
- technical failureとsemantic ambiguityが別の診断、trace、利用者応答になる。
- 「同じ内容をそのままもう一度送ってください」が通常経路から削除される。
- PR #109のAI semantic ownership原則を弱めない。
- Issue #108、同一branch、PR #109内で実装・検証・文書が同期する。

## 作業時の報告方針

実装中は、次をこのtask MDとPR #109へ記録する。

- 確認した設計境界
- 発見した思想競合
- 変更した利用者体験
- 変更した意味契約と状態遷移
- 実行したtestと実測結果
- 未確認項目
- 次の実装ループで扱う範囲

口頭説明だけで進捗を残さない。実装と文書が食い違う場合は、完了扱いにしない。
