# PR #130 10-loop Real Luna checkpoint監査

Date: 2026-08-16
PR: #130 `Audit weekly-planning conversation quality on Luna`
Branch: `agent/weekly-conversation-quality-luna-audit`
Model: `gpt-5.6-luna`
Conversation: `weekly-luna-checkpoint-10loop-01`
Status: 10 turns completed; final CI / Browser Regression pending at the time of this record

## 目的

単発のgreen checkpointで終了せず、同一会話を10 turn継続し、提案承認、短答、測定単位、preview、数量訂正、複数対象deadline、soft preference、plan-wide unavailability、deadline訂正、preference訂正まで状態を持ち回る。

品質oracleはassistant文面の完全一致ではなく、各turnで以下を確認する。

- Luna normal pathが使われること
- applicationが決めた質問の意味をrendererが変えないこと
- workload / effort / deadline / preference / availabilityのbinding
- correctionで旧factがsupersedeされること
- unaffected factが訂正で消えないこと
- preview schedulerがactive factだけを使うこと
- save / merge相当の確定処理をユーザー承認前に行わないこと

raw Japanese regex / keyword parserは追加しない。

## 監査中に見つけた実バグと修正

### 1. semantic repair ruleの責務重複

current HEAD確認時、CIはBrowser Regression greenに対してCI本体がredだった。

原因は、relative date canonicalizationの注意書きが全repair requestへ無条件に追加され、error-local repair契約を壊していたことと、generic meaning policyがbudgetを超過していたことだった。

修正は、relative dateのcanonicalizationを通常のsemantic meaning policyへ統合し、repair promptはvalidation errorに対応する指示だけを返す構造へ戻した。意味契約をrepair専用の重複ルールとして持たせない。

### 2. uncertainty self-reference

uncertainty自身のlocal identityをtargetとして参照してもbase reference validationを通れる経路を確認した。

referent自体が未確定ならdocument/rootへ置くという既存方針を、promptだけでなくdeterministic evidence validationでも強制するようにした。self-referenceはrejectし、repairはdocumentまたは既にsupportされたfactへ向ける。

### 3. Luna rendererがeffort measurementを変える

Turn 4の初回 Real Luna run `31934297286` で、applicationは数学について`1問あたり`の所要時間を尋ねる判断をしていたが、Luna rendererは次のように出力した。

```text
数学の問題40問は、1回あたり何分くらい学習する想定ですか？
```

これは自然な言い換えではなく、per-unit durationをsession durationへ変えるsemantic driftである。

renderer promptへ一般契約として、effort measurementを変えず、`duration_per_unit`は1単位あたり、`session_duration`は1回、`total_duration`は全体、とする最小ルールを追加した。数学・問題・問などのregression固有日本語はhard-codeしていない。

修正後の同一Turn 4 rerun `31934436229` では次へ収束した。

```text
数学の問題40問は、1問あたり何分くらいかかる想定ですか？
```

## 10-loop Real Luna transcript

### Turn 1 — run `31934153614`

User:

```text
来週、英単語180語と数学の問題40問をやりたい
```

Assistant:

```text
英単語180語は、15〜30分程度の学習を間隔を空けて繰り返す方法を提案します。記憶の定着を助ける進め方ですが、この方法でよいですか？
```

Result:

- 英単語180語はstandard unit `word` / label `語`。
- 数学40問はstandard unit `problem` / label `問`。
- 二つのworkloadは別対象。
- spaced practice proposalのみを一度に確認。

### Turn 2 — run `31934206598`

User:

```text
うん、それでいい
```

Assistant:

```text
英単語180語は、1回あたり何分くらい学習する想定ですか？
```

Result:

- pending proposalへの短い承認としてbind。
- 数学へ誤bindしない。

### Turn 3 — run `31934253679`

User:

```text
20分くらい
```

Assistant:

```text
英単語は、1回20分で進め、その回の進み具合をもとに今後の学習時間を調整する方法でよいですか？
```

Result:

- 20分は英単語のsession durationとして保持。
- total durationには変換しない。
- pace calibration proposalへ進む。

### Turn 4 — rerun `31934436229`

User:

```text
うん、それで
```

Assistant:

```text
数学の問題40問は、1問あたり何分くらいかかる想定ですか？
```

Result:

- calibration proposalを承認。
- renderer修正後、数学のeffort measurementはper-problemのまま保持。

### Turn 5 — run `31934492662`

User:

```text
5分くらい
```

Assistant:

```text
8月17日〜23日の予定として、英単語180語（1回20分）と数学の問題40問（1問5分）の仮予定候補を4件作成しました。「この内容で仮予定にする」を選んでください。
```

Result:

- 数学は1問5分。
- first previewへ到達。
- ここではcheckpoint完了扱いにせず、後続訂正を継続。

### Turn 6 — run `31934534102`

User:

```text
数学40問じゃなくて30問だった
```

Assistant:

```text
数学の問題を30問に修正して、8月17日〜23日の仮予定候補を3件作成しました。「この内容で仮予定にする」を選んでください。
```

Result:

- 旧40問はsuperseded。
- active targetは30問のみ。
- 既存の1問5分は30問側へcarryされる。
- previewは3件へ再計算。

### Turn 7 — run `31934645433`

User:

```text
英単語は金曜まで、数学は日曜までにしたい
```

Assistant:

```text
英単語180語は金曜まで、数学30問は日曜までの仮予定候補を3件作成しました。「この内容で仮予定にする」を選んでください。
```

Result:

- 英単語 deadline = 2026-08-21。
- 数学 deadline = 2026-08-23。
- 一つのturnにある二つのdeadlineを独立にbind。

### Turn 8 — run `31934700162`

User:

```text
英単語は夜がいい。火曜18時から20時は勉強できない
```

Assistant:

```text
英単語180語は夜、金曜まで。数学30問は日曜まで、火曜18時〜20時を除外した仮予定候補を3件作成しました。「この内容で仮予定にする」を選んでください。
```

Result:

- `夜`は英単語だけのsoft preferred window。
- 火曜18:00〜20:00 unavailableはplan-wide hard availability constraint。
- deadlineは維持。

### Turn 9 — run `31934752767`

User:

```text
数学の方はやっぱ土曜までで
```

Assistant:

```text
英単語180語は金曜までの夜、数学30問は土曜まで、火曜18時〜20時を除外した仮予定候補を3件作成しました。「この内容で仮予定にする」を選んでください。
```

Result:

- `数学の方`はactive 30問の数学taskへbind。
- 旧日曜deadlineはsuperseded。
- active deadlineは2026-08-22。
- unrelated preference / availability / English deadlineは保持。

### Turn 10 — run `31934817709`

User:

```text
英単語は夜じゃなくて朝がいい
```

Assistant:

```text
英単語180語は朝、金曜まで。数学30問は土曜までの仮予定候補を3件作成しました。「この内容で仮予定にする」を選んでください。
```

Result:

- 旧`夜` preferenceはsuperseded。
- active preferenceは`朝`。
- 数学30問、1問5分、土曜deadlineを維持。
- 火曜18:00〜20:00 unavailableもactiveのまま維持。
- final assistant summaryはunavailabilityを再掲しなかったが、状態からは消えておらず、preview candidateもその時間帯を避けているためsemantic lossとは判定しない。

## Final preview state

最終graphではactive meaningは次の通り。

- 英単語: 180語、1回20分のpace-calibration session、金曜まで、朝を希望。
- 数学: 30問、1問5分、土曜まで。
- 火曜18:00〜20:00は利用不可。
- uncertaintiesなし。
- preview candidateは3件。

最終candidate:

```text
2026-08-17 06:00-06:20  英単語180語（ペース計測）
2026-08-18 09:00-10:25  数学の問題 15問（1〜15問）
2026-08-19 09:00-10:20  数学の問題 15問（16〜30問）
```

英単語はaccepted calibration方針に従い、180語すべての所要時間を捏造せず、最初の20分観測sessionだけをpreviewする。数学は30問を完了する候補へ分割される。

全candidateは未承認であり、ユーザーが`この内容で仮予定にする`を操作する前に保存・確定していない。

## Fallback / dynamic renderer確認

normal successful pathはReal Luna rendererであり、この10-loop transcriptのassistant response sourceはいずれもAI pathだった。

fallback用の固定日本語はrender inputには存在するが、normal Luna promptには渡していない。したがってnormal outputをfixed Japanese referenceへ寄せる構造にはなっていない。

## 判定

10 turnを通じて、短答、proposal decision、effort measurement、preview後のworkload correction、複数deadline、preferenceとavailabilityの同居、deadline correction、preference correctionまでresume可能な状態を維持した。

監査中に見つかった実バグは、CIを壊していたrepair policy重複、uncertainty self-reference、rendererによるeffort measurement driftであり、いずれもregression固有日本語分岐ではなく一般契約として修正した。

この記録の次のgateは、文書同期後のfinal HEADに対するfull CIとBrowser Regressionのgreen確認である。
