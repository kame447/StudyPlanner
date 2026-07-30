# Stable V5の認識済みタスク再質問とsemantic repair失敗 七視点監査

Date: 2026-07-30
Issue: #98
Branch: `agent/stable-v5-dialogue-repair-seven-audit`
PR: #99
Source trace: `weekly-trace-fbda7e10-9506-590c-bac3-1c56629613d2`
Main before change: `1c822a6458284df7b17e67294923d6c63edb2895`

## 結論

今回の会話失敗は、利用者の入力不足や表記ゆれではない。Stable V5内部に、認識済みFact Graphを対話へ反映しない分岐と、validator errorだけをrepair modelへ渡して意味上の禁止事項を伝えない分岐が同時に存在する。

第一の不具合では、AI normalizerとcanonicalizerは2件のtaskを正常に採用しているが、workloadが0件でscheduler compilationが`empty`になると、Stable V5 runtimeがFact Graphを参照せず固定の一般質問を返す。そのため利用者から見ると、直前の回答を無視して同じ質問を繰り返している。

第二の不具合では、initial structured outputがpriority表現を`earliest_start`へ誤変換し、validatorの`missing-start`で拒否される。repair instructionには、priorityはrelationだけで表現すること、明示されていないclockを発明しないこと、named periodとclockを排他的に扱うことが含まれない。結果としてrepairは09:00と15:00を発明し、named periodを残したまま返し、別のvalidator errorで再拒否される。

## 監査1: アーキテクチャと責務境界

判定: MAJOR

Stable V5 runtimeは`decideWeeklyPlanningStableDialogueV5`を使用し、既存のgeneric dialogue policyが持つ「taskはあるがschedulable workがない」分岐を利用していない。normalizer、canonicalizer、scheduler input compilerの責務分離自体は維持されているが、dialogue層がFact Graphの既知情報を捨てている。

不変条件は、意味解釈済みのtaskを対話層が再び未知として扱わないことである。scheduler compilationが`empty`でも、active taskが存在するならtask-awareな不足質問を返す必要がある。taskが0件の場合だけ一般質問を返す。

修正方針はruntimeのempty分岐でactive graphを参照し、既知taskを要約した作業量質問を生成する。新しいparserや意味抽出は追加しない。

## 監査2: Schema・validator・repair契約

判定: BLOCKER

validatorは`earliest_start`に`startTime`、`latest_end`に`endTime`を要求し、named time periodとclockの併用を拒否する。この契約自体は、exact clock constraintとして扱うなら整合する。

問題はrepair protocolである。repair modelへ渡されるのはvalidator error文字列と「完全な修正版JSONを返す」という一般指示だけであり、次の意味上の制約が伝わらない。

- priority表現は`priority_over` relationであり、開始時刻ではない
- 明示されていないclockを補完してはならない
- named time periodを保持するなら`preferred_window`等の適切なkindを使い、start/endはnullにする
- exact clockを保持するならnamed time periodをnullにする
- `missing-start`の対象がユーザー発話にclock根拠を持たない場合、そのconstraintを削除する

修正方針は、base promptとrepair instructionへ一般化された境界規則を追加する。validatorを緩和して誤った`earliest_start`を受理する修正は行わない。

## 監査3: 状態原子性とFact Graph整合性

判定: PASS WITH UX DEFECT

2ターン目ではnormalizationとcanonicalizationが成功し、planning window、2 task、2 study context、2 temporal constraintがGraph revision 2へ適用されている。状態更新自体は失われていない。

3ターン目ではnormalizationが2回とも拒否され、candidate operationは0件でGraph mutationも行われていない。fail-closedの原子性は守られている。

ただし、Graphにtaskが存在するのにassistant outputが「何を」と質問するため、外部可視状態と内部状態の説明が不一致である。修正後はGraphを変更せず、assistant outputだけを既知状態へ整合させる。

## 監査4: 対話UXと修復可能性

判定: BLOCKER

同じ一般質問の反復は、利用者の返答を受理していないように見える。実際にはtaskを受理済みなので、「研究と院試の勉強は把握しました。それぞれどれくらい進めたいか」のように、受理内容と不足項目を分離して返す必要がある。

normalization failure文言も不適切である。原因は利用者入力ではなく、AI structured outputと内部contractの不整合であるのに、「内容を少し言い換えて」と利用者へ責任を移している。修正後は「入力内容は保持しているが、構造化処理に失敗した」と説明し、再送を求める場合も同じ内容をそのまま再送可能であることを示す。

## 監査5: Scheduler意味保持

判定: MAJOR / 今回は非blockerとして記録

2ターン目の`morning`と`afternoon`はtask-specific `preferred_window`としてFact Graphへ保存される。しかし現行preview schedulerは、fixed reservation、availability window、task date eligibilityだけを配置制約として使い、task-specific preferred windowを配置候補の優先順へ反映しない。

したがって今回の二つの表面不具合を修正しても、後続のpreviewが「研究は午前、院試は午後」という意味を守らない可能性がある。これはscheduler input contractの拡張を要し、今回のrepair・dialogue修正と同じ差分へ混在させるとレビュー単位が肥大化するため、Issue #98のmerge blockerにはしない。Issue #100として別管理へ切り出した。

## 監査6: 観測性・信頼境界・privacy

判定: PASS WITH MESSAGE DEFECT

trace schema v2には、実AI request、raw response、structured result、validation error、accepted/rejected operation、state diff、assistant outputが保存されており、今回の停止点は十分に再構成できる。trace基盤そのものは原因ではない。

一方、利用者向けmessageは`normalization_rejected`という内部原因を「言い換え要求」に縮退させるため、運用上の切り分けを妨げる。修正後もvalidator errorやraw outputを利用者へ露出せず、内部失敗であることだけを正確に伝える。

repair instructionへ追加する規則は一般化し、今回の固有task名や時刻をpromptへ埋め込まない。trace保存契約やprivacy範囲は変更しない。

## 監査7: Test・文書・merge hygiene

判定: MAJOR

既存runtime testは「今日だけのplanning windowでtaskが0件」の一般質問を固定しているが、「taskは存在しworkloadが0件」の分岐を持たない。normalizer testにも、initial validation failure後にrepairがclockを発明せずconstraintを削除・修正する契約がない。

必要な回帰testは次である。

- task 0件では従来の一般質問を維持する
- task 2件・workload 0件では既知task名を含み、同じ一般質問を返さない
- task-aware empty分岐で`questionCode`を記録し、compatibility stateを`revision_pending`にする
- trace相当のinitial invalid responseとvalid repair responseを与え、attempt 2でacceptedになる
- repair requestにpriority、no clock invention、named-period/clock exclusivityが含まれる
- normalization rejected時に「言い換えて」を返さない
- 正常preview生成を維持する

GitHub上には同一目的のopen PR・branchが存在しなかった。過去PRはすでにclosedであり、Issue #89はtrace transport/adminの別責務である。Issue #98、branch `agent/stable-v5-dialogue-repair-seven-audit`、PR #99へ集約した。

## 実装修正の確定範囲

今回修正したのは次の三点である。

1. semantic normalizerのbase/repair instructionへ一般化されたtemporal・priority修復規則を追加した。
2. Stable V5 runtimeのempty分岐をtask-awareにし、既知taskを明示してworkloadを質問するようにした。
3. normalization rejectedの利用者向けmessageを、内部構造化失敗と入力保持を正確に示す文言へ変更した。

## 実装後の七視点再判定

アーキテクチャは、empty compilation時だけactive Fact Graphを参照する局所変更であり、normalizerやschedulerへ対話責務を逆流させていないためPASSとした。

Schema・validator・repair契約は、validatorを緩和せずrepair側へ意味境界を追加した。priorityをrelationとして保持し、clockの発明を禁止し、named periodとclockの排他を明示したためPASSとした。

状態原子性は変更していない。normalization rejected時のGraph非更新と、accepted時のみcommitする既存境界を維持しているためPASSとした。

対話UXは、taskが0件なら従来の一般質問、taskが1件以上なら認識済みtask名と不足する量を示す分岐へ変更した。normalization failureも「言い換え」を要求しないためPASSとした。

Scheduler意味保持は今回の対象外であり、Issue #100がOPENである。したがってIssue #98の範囲ではPASS、システム全体では残余MAJORとした。

観測性は、`nothing_to_schedule` branchのbasisへrecognized task titlesとquestion codeを追加し、原因切り分けを強化した。raw provider outputやvalidator errorを利用者へ露出していないためPASSとした。

Test・文書・merge hygieneは、runtime回帰testとnormalizer repair回帰testを追加し、一つのIssue・branch・PRへ集約した。PRはmainからbehind 0、mergeableである。ただしGitHub Actionsは二つのworkflowともjob step 0件のままfailure終了し、実行ログが生成されていない。既知のActions月間枠枯渇と整合するため、test成功とは判定しない。

## 検証記録

Cloudflare PagesはPR head `9d5f0f5c9318c50474e25ca2ce8088146891e152`のpreview deploy成功を報告した。これはproduction bundleのbuild経路が成立した証拠として扱うが、`npm run typecheck`と`npm run test:run`の成功証拠にはしない。

GitHub Actions CI run `30477837167`とStable V5 Semantic Eval run `30477837139`はfailureで完了したが、各jobはstepsが空で、job logも生成されていない。コードまたはtest assertionが実行されて失敗した証拠はない。同時に、focused test、full test、typecheck、typecheck:build、diff checkの成功証拠もない。

ローカル環境は使用しておらず、ローカルtestは実行していない。PR #99は自動検証未完了のためdraftのまま維持する。

## 完了判定

実装、回帰test追加、七視点事後監査、別責務Issue #100への切り出し、PR作成まで完了した。task Markdownはclosedへ移す。ただしPR mergeの判断は、Actions枠復旧後または人間のローカル環境で`npm run typecheck && npm run test:run && npm run build && git diff --check origin/main...HEAD`が成功した後に行う。
