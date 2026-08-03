# 週間計画 部分意味受理と曖昧性修復

Status: planned / P0 semantic follow-up
Date: 2026-08-03
Parent work: `20260803-weekly-planning-ai-semantic-ownership-reset.md`
Implementation branch: 未作成

## この記録の目的

AIの意味出力を「完全に確定したSemantic Document」へ必ず押し込む現在の契約を見直し、解釈できた部分は受理し、解釈できない部分は未確定のまま保持して、対象を限定した聞き返しで修復できる意味モデルを設計する。

このtaskは、進行中のPR #109と`agent/weekly-ai-conversation-eval`を変更しない。PR #109のAI semantic ownership reset、schema・validator・formal binding整理が完了または設計上の合流点に到達した後に、独立work unitとして着手する。

## 観測した問題

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

## 目標となる意味結果

正確な型名は実装前設計で確定するが、少なくとも次の状態を区別できる契約が必要である。

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
- 不完全だが発話由来として保持すべきFact断片
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
- PR #109の進行中コードへ並行して大規模schema変更を混入すること
- 今回の一例だけを通すscenario固有patchを追加すること

## PR #109との境界

PR #109側で継続するもの:

- AI semantic ownership reset
- 後段の自然言語再解釈除去
- schema、validator、formal target bindingの責務整理
- staged Graphとruntime resultの整合
- 実API会話基盤とtrace

本taskで後続実施するもの:

- partial semantic acceptanceのresult envelope
- unresolved fact / ambiguity / clarification contract
- 未確定Factのlifecycleとpersistence
- clarification answerによる局所解消
- resolved-only scheduler view
- technical failureとsemantic ambiguityの分離
- 再送ループ防止

PR #109で同じ領域の設計が進んだ場合、本taskは重複実装せず、その成果を正として差分だけを実装する。

## 実装フェーズ

### Phase 0: current contract audit

- Semantic Document V5が確定Factだけを前提としている箇所を列挙する。
- normalizer、validator、canonicalizer、Fact Graph、pending question、scheduler view、renderer、persistence、traceのreject条件を追う。
- validation failureの実例を、構造障害、参照障害、意味的曖昧性、schema表現力不足へ分類する。

### Phase 1: result envelope設計

- complete、partial、clarification、structural failure、provider failureをdiscriminated unionとして分ける。
- unresolved elementとambiguityにstable IDを付ける。
- source evidence、candidate interpretation、target reference、expected answer typeの最小契約を決める。
- AI自由生成の質問文をsemantic authorityとして使わない。

### Phase 2: validatorとGraph lifecycle

- partial resultを正常受理できるvalidatorを追加する。
- 構造的に壊れた出力だけをrepair対象にする。
- resolved、ambiguous、incomplete、awaiting confirmation等の状態をGraphで区別する。
- unresolved Factをactive scheduler viewから除外する。
- 同一turnの確定Factと未確定Factを原子的に保存する。

### Phase 3: clarification transaction

- ambiguity IDとGraph revisionをpending questionへ保存する。
- AIが直前質問への回答として選択・訂正・追加情報を返せる契約を作る。
- 回答により対象ambiguityだけをresolveし、無関係なFactを再生成しない。
- stale answer、target消失、revision mismatchは意味を推測せず拒否する。

### Phase 4: dialogue and failure recovery

- semantic ambiguityでは具体的な聞き返しを返す。
- structural failureでは最大1回のAI形式repairを行う。
- repairも失敗した場合、受理済みGraphを保持し、未確定項目を一つだけ尋ねるcontrolled recoveryへ移る。
- provider failureは内部障害として扱い、ユーザーに同文再送を要求しない。
- 同一入力hashと同一failure classの反復を検知してループを防ぐ。

### Phase 5: verification

- unit / property / integration tests
- multi-turn clarification tests
- reload / close-reopen persistence
- stale clarification response
- multiple simultaneous ambiguities
- correctionとclarificationの競合
- preview前後のambiguity発生
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
- provider failure、malformed JSON、unsupported semantic ambiguityを同じstatusへ畳み込まない。
- productionコードへ日本語の意味判定regexを追加しない。

## 受け入れ条件

- 部分解釈が正常結果として型に表現される。
- AIが分からない要素を未確定のまま受理できる。
- 確定済み部分は失われず、Graph revisionへ保存される。
- 曖昧な部分だけを対象に一問ずつ聞き返せる。
- 回答後に対象部分だけを確定Factへ昇格できる。
- scheduler、preview、saveはresolved Factだけを使用する。
- technical failureとsemantic ambiguityが別の診断・trace・利用者応答になる。
- 「同じ内容をそのままもう一度送ってください」が通常経路から削除される。
- PR #109のAI semantic ownership原則を弱めない。

## 引き継ぎ

このtaskを見つけた実装担当は、まずPR #109と`20260803-weekly-planning-ai-semantic-ownership-reset.md`の最新状態を確認する。進行中branchへ直接実装を追加せず、PR #109で未完了のsemantic ownership修正が収束してから、新しいbranchで着手する。
