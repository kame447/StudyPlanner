# PR #130 文脈参照・ペルソナ Real Luna監査

Date: 2026-08-16
PR: #130 `Audit weekly-planning conversation quality on Luna`
Branch: `agent/weekly-conversation-quality-luna-audit`
Model: `gpt-5.6-luna`
Status: contextual-reference batch completed; final branch CI/Browser confirmation pending

## 目的

曖昧な指示語、省略、短答、訂正、対比表現を、直近の会話文脈と既存のFact Graph状態からLunaが意味解釈できるかをReal APIで一turnずつ監査する。

同時に、高校生の砕けた口調、学生の省略口調、かなり砕けた口調、社会人の丁寧語・フォーマル語調へ変えても、最終的なapplication stateが同じ意味へ収束するかを見る。

品質oracleはassistant文面ではなく、以下とする。

- 既存task/workloadへの正しいbinding
- active factの重複がないこと
- correctionで旧factがsupersedeされること
- deadline / preference / progress / proposal decisionが正しい対象へ付くこと
- 本当に曖昧な場合は勝手にreferentを選ばないこと
- checkpointが次turnへresume可能なgraphとして保存されること

raw Japaneseのregex / keyword / phrase-specific mappingは追加しない。

## 今回追加・修正した一般契約

### 1. qualitative progressの数値捏造を禁止

`まだほぼ手つけてない`等の定性的な進捗だけから、`remaining=80`等の具体値を作らない。

正確な量が発話にない場合は、対象task/componentに対する進捗量未確定として保持する。

### 2. semantic repairでもrelative dateをcanonicalize

repairが別のvalidation errorから起動した場合でも、`来週末`等のrelative dateを自然言語のまま内部date fieldへ残さない。

calendar contextを使いcanonical date expressionへ変換する。

### 3. omitted / pronominal targetの一般binding

`それ`、`こちら`、`こいつ`、主語省略等を個別に列挙して処理しない。

recent conversation / current public stateからsupportされたreferentが一意な場合のみbindする。候補が複数ならuncertaintyとする。

### 4. decision / correctionと同一turnの独立factを落とさない

`うんそれで。金曜まで`のようにproposal decisionとdeadlineが同居していても、decisionだけを採用してdeadlineを捨てない。

current turnの独立した意味はそれぞれ解釈する。

### 5. existing entityへnested factを追加するためのminimal shellを許可

current-turn delta契約の`既存factを繰り返さない`が強すぎると、既存taskへ新しいdeadline等を付けるための最小構造までLunaが省略する。

既存state全体の再出力は不要だが、新しいnested factのcontainerとしてexact existing identityにbindしたminimal shellは許可する。

### 6. referent自体が未確定のuncertaintyはrootへ置く

`片方は金曜まで`で、数学か物理か決まっていないuncertaintyをuncertainty自身へself-referenceさせない。

referent自体が未確定ならdocument/root levelのuncertaintyとして保持する。

### 7. Real Luna harnessの1turn request上限を正しい経路へ合わせた

正当な1turnで、focused semantic probe、generic semantic pass、semantic repair、dialogue rendererの4 requestが必要になる場合がある。

以前の上限3では4番目のrendererがprovider failureに見えてdeterministic fallbackへ落ちていた。Real API観測workflowのみ上限を4へ合わせた。

## Real Luna evidence

### A. 高校生・カジュアル: `それ`

Base run: #189 / Actions `31931306784`

```text
数学の問題集80問やりたい
```

Follow-up final run: #192 / Actions `31931618247`

```text
それ来週まで。まだほぼ手つけてない
```

結果:

- 数学の問題集taskは1件のみ。
- target workload 80問は重複しない。
- deadlineは2026-08-23へ正しく付与。
- `ほぼ手つけてない`から具体的なremaining amountを捏造しない。
- exact completed amountだけを未確定として保持。
- assistantはLuna rendererで次の確認を自然に生成。

### B. 社会人・フォーマル: `こちら`

Base run: #193 / Actions `31931706634`

```text
資格試験の問題集を120問進めたいと考えております。
```

Follow-up first attemptでは、semantic repair時に`来週末`をcanonical dateへ直さずvalidation failureになった。

修正後 run: #195 / Actions `31931915335`

```text
こちらは来週末までに。まだほとんど着手できておりません。
```

結果:

- 既存120問へbinding。
- deadlineは2026-08-23。
- qualitative progressはexact amount不明のまま保持。
- 丁寧な返答語調を維持。

### C. 学生・主語省略

Base run: #196 / Actions `31931979790`

```text
青チャート100問やっときたい
```

最初のfollow-upでは次の入力が意味stateへ反映されなかった。

```text
来週まで。夜がいい
```

個別語ルールではなく、referentが一意な主語・目的語省略をcurrent contextから解決する一般契約を追加。

修正後 run: #198 / Actions `31932158335`

結果:

- 青チャート100問は1件のみ。
- deadline 2026-08-23。
- `夜がいい`はglobal availabilityではなく青チャートtaskのsoft timing preference。

### D. かなり砕けた口調: `こいつ`

Base run: #199 / Actions `31932213049`

```text
物理の問題集60問やる
```

Follow-up run: #200 / Actions `31932260272`

```text
こいつ金曜までな。できれば夜
```

結果:

- 既存物理60問へbinding。
- deadline 2026-08-21。
- `できれば夜`はtask-specific soft preference。
- global availabilityへ誤投影しない。

### E. カジュアルproposal参照 + 同一turn deadline

Base run: #201 / Actions `31932317306`

```text
TOEIC単語300語覚えたい
```

Luna/applicationはspaced-memory proposalを提示。

Follow-up:

```text
うんそれで。金曜まで
```

初回 #202 / Actions `31932367691`:

- proposal decisionはaccept。
- deadlineを落としたためFAIL。

一般的なindependent-clause契約を追加しても #203 / `31932455406`ではdeadlineがまだ欠落。

原因はcurrent-turn deltaの`既存factを繰り返さない`が、deadlineを載せるexisting task shellまで抑制していたこと。

minimal existing shellを許可した再実行 #204 / Actions `31932586029`:

- proposal accepted。
- target 300語は1件のみ。
- deadline 2026-08-21。
- both meanings preserved。

ただしsemantic first passはschema-valid minimal study shellを一度で作れずgeneric repairを1回使った。最終stateは正しいが、prompt/schema simplification候補として残す。

### F. フォーマルproposal参照 + 同一turn deadline

Base run: #205 / Actions `31932641949`

```text
資格試験の用語を300語ほど暗記したいと考えております。
```

Follow-up run: #206 / Actions `31932683724`

```text
その方針でお願いいたします。期限は金曜日までで。
```

結果:

- proposal accepted。
- target 300語は1件のみ。
- deadline 2026-08-21。
- casual caseとapplication上同じ意味へ収束。

### G. 本当に曖昧なreferentを勝手に決めない

Base run: #207 / Actions `31932735140`

```text
数学の問題集80問と物理の問題集60問やりたい
```

Follow-up:

```text
片方は金曜まで
```

Lunaは「数学か物理か」を確認できたが、最初の保存stateではuncertaintyが自分自身をtargetにしており、見た目は正常でも次turn resumeでgraph validation failureになった。

root uncertainty契約を追加した再実行 #210 / Actions `31932996442`:

- deadlineをどちらにも勝手に付けない。
- referent uncertaintyはrootへ保存。
- graph-validでresume可能。
- assistantは数学/物理のどちらかを確認。

### H. 曖昧性を短答で解消

前項から継続 run: #211 / Actions `31933053329`

```text
数学の方
```

結果:

- 数学だけへdeadline 2026-08-21。
- 物理にはdeadlineなし。
- referent uncertaintyはactive stateから解消。
- 直前にassistantが物理を質問していても、物理へ機械的にbindしない。

### I. カジュアルな指示語訂正

Baseは #189の数学80問state。

Run #212 / Actions `31933137425`

```text
いやそれ60問だった
```

結果:

- old 80問はsuperseded。
- active targetは60問だけ。
- task identityは維持。
- duplicate workloadなし。
- assistant rendererも60問としてgrounding。

### J. フォーマルな指示語訂正

Baseは #193の資格試験120問state。

Run #213 / Actions `31933176201`

```text
失礼しました。そちらは90問の誤りでした。
```

結果:

- old 120問はsuperseded。
- active targetは90問だけ。
- duplicate workloadなし。
- casual correctionと同じlifecycleへ収束。

### K. 対比表現: `もう片方`

#211のstateでは数学は金曜deadline、物理は別taskとして存在。

Run #214 / Actions `31933238406`

```text
じゃあもう片方は日曜まで
```

結果:

- `もう片方`を物理として解決。
- 数学deadline 2026-08-21を保持。
- 物理deadline 2026-08-23を新規付与。
- cross-target contaminationなし。

### L. 非直近referent

#211のstateでは直前assistantが物理の所要時間を質問している。

Run #215 / Actions `31933319258`

```text
最初に言った方は夜にやりたい
```

結果:

- 単純なmost-recent bindingではなく、最初に提示した数学を選択。
- 数学だけへsoft night preferenceを追加。
- 物理へ誤bindingしない。

## この監査で見つかった重要なfailure class

1. 定性的進捗から具体的な数値を補ってしまう。
2. repair時だけrelative dateのcanonicalizationが抜ける。
3. 主語省略の独立条件をsemantic outputから落とす。
4. proposal decisionが同一turnのdeadlineを食う。
5. 既存fact再出力抑制が、新しいnested factのcontainerまで消す。
6. UI上は正しい確認文でも、保存したuncertaintyがself-referenceしてresume不能になる。
7. Real API harnessのrequest ceiling不足がrenderer provider errorに見える。

特に6は、assistant textだけを見ていた場合には見逃す不具合だった。今後もtranscriptだけではなくcheckpoint / active lifecycle / resumeabilityをquality oracleに含める。

## 現在の評価

修正後のReal Lunaでは、以下のregister/reference classで既存targetへのbindingまたは安全なambiguity handlingを確認できた。

- 高校生カジュアル: `それ`
- 社会人フォーマル: `こちら`
- 学生の主語省略
- かなり砕けた口調: `こいつ`
- proposalへのカジュアルな`それで`
- proposalへのフォーマルな`その方針`
- 真に曖昧な`片方`
- clarificationへの`数学の方`
- カジュアル訂正の`それ`
- フォーマル訂正の`そちら`
- 対比的な`もう片方`
- 非直近の`最初に言った方`

現時点では、語調差そのものがapplication stateを変える再現バグは残っていない。

ただし、これを「文脈参照が完全」とは扱わない。今後も新しいconversation-quality specimenで、意味上のreferentが一意な場合のみbindし、本当に曖昧なら確認する原則を維持する。

## 残件

- latest stable HEADでCI / Browser Regression greenを確認する。
- proposal + nested deadlineがfirst-passでgeneric repairを必要とする点をprompt/schema simplificationで再監査する。
- self-referential uncertaintyをsemantic contractだけでなくdeterministic validationでもrejectするhardeningを検討する。
- one-shot vs gradualの最終state convergenceを完了する。
- fallback / renderer final audit。
- final dynamic Real Luna conversationをactual previewまで完走する。
- handoff / roadmap / current contractを最終HEADへ同期する。

PRはdraft・未mergeのまま維持する。
