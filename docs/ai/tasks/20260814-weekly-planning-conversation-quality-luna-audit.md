# 週間計画 会話品質・Luna簡素化監査

Status: active / second and final PR in the current two-PR scope
Date: 2026-08-14
Branch: `agent/weekly-conversation-quality-luna-audit`
Primary existing issue: #118
Explicitly excluded: #52, #115

## 1. 目的

PR #129でfile-by-file refactorとその最終検証はmainへmerge済みである。このtaskは、残っている会話品質改善を過去のtask、Issue、PR、実装、回帰から再棚卸しし、Stable V5の実API会話を一対話ずつLunaで再観測する。

明確な失敗を見つけた場合は次のturnへ進まず、semantic AI、schema/validator、formal binding、dialogue decision、renderer、scheduler、previewのどの層が原因かを特定する。修正はその層に限定し、対象回帰、full CI、同じ会話地点からの再実行を行う。

最後に最終HEADで通し会話をpreviewまで完走させ、ブラウザ上のpreview昇格、承認入口、保存境界まで既存contractどおりに接続されることを確認する。

## 2. 固定する責務境界

自然言語、会話文脈、訂正、quantity role、日付・曜日・時間帯、authorization intentの意味理解はAIが担当する。

deterministic codeはschema/reference/evidence validation、formal binding、Fact Graph lifecycle、revision/idempotency、質問必要性と優先度、readiness、scheduler、preview、approval/save、persistence/recovery、安全境界を担当する。

raw Japanese textをregex、keyword、dictionary、legacy parserで再解釈してAI出力を上書きしない。renderer文面からmachine stateを逆推定しない。repairは最大1回とする。

モデルがLunaへ更新されたことは、意味責務や安全境界を移す理由にはしない。削除候補は、JSON Schemaと重複する表現指示、現在のmodelで不要になったhistorical repair scaffolding、同じ規則のprompt間重複に限定して実API ablationで評価する。

### 2.1 日付・相対期間の責務

「来週」「今週」「明日」「月曜日」のような自然言語表現がどの時間関係を意味するかの理解だけをAIの責務とする。AIに基準日から具体的な年月日を計算させない。

具体的な日付範囲は、turn開始時に取得した実際の発話日時、利用者のtime zone、week-start設定、および既存のcalendar resolverを用いてdeterministic codeが解決する。selectedDateを「今日」の代用にしない。たとえばAIが「次の週」という意味を返した後、何月何日から何月何日かを決めるのはapplication側である。

相対日のcanonical wire表現も、promptで特定文字列の綴りを反復指示して守らせない。`relative_week`なら「今週」「次週」に対応する有限のtyped valueだけをschema上で選べる形を優先し、意味が正しいのに「来週」と返したためgeneric AI repairを再呼び出しするようなrepresentation failureを減らす。schemaまたはdeterministic normalizationだけで一意に直せるrepresentationはモデルへ戻さない。ただしraw Japanese textをapplication側で再解釈して意味を決め直すことはしない。

### 2.2 学習量と所要時間推定の責務

教材上の構造、進捗量、作業速度、calendarへ配置するsession時間を同じ概念として扱わない。

`chapter`、`section`、`lesson`などの大きい単位は、原則として「どこを学習するか」を示す教材構造・範囲として保持する。これらをそのまま「1章あたり何分」のような時間推定単位へ使わず、可能ならpageまたはproblemへ分解してから所要時間を推定する。章や節の大きさ・難易度は一定でないため、直接の時間推定単位にすると予測誤差が大きくなりやすい。

pageとproblemは、時間推定に使う基礎単位を原則1単位とする。利用者が「30ページ」「10問」のように量を明示し、利用可能なobserved paceやdirect per-unit estimateがない場合は、「全部で何分か」より「1ページあたり大体何分か」「1問あたり大体何分か」を確認する方向を優先する。重要問題集のような教材名や難易度をheuristicで推測する必要はなく、problem単位ならproblemあたりの時間を尋ねればよい。

1ページ・1問を基礎単位にすることは、1ページ・1問ごとにcalendar candidateを作ることを意味しない。内部では単位あたり速度から総所要時間を算出し、schedulerが利用可能時間に応じて複数ページ・複数問題を一つのsessionへまとめる。計算粒度とcalendar上のsession粒度を分離する。

すでに実績が存在する場合は、自己予測より観測値を優先できる。たとえば30ページを実際に90分で終えたというevidenceがあれば、1ページあたり約3分というobserved paceをdeterministicに導出し、残り量や新しいtargetの見積りへ再利用する。Issue #118で導入したcompleted workloadとcompleted durationからremaining effortを導く方針は、この原則と矛盾しない。

wordは例外として扱う。単語数は進捗量として保持できるが、通常の語彙学習は1語ずつ独立にscheduleする作業ではないため、既定では「1語あたり何分」を要求しない。語彙学習では「1回あたり何分やるか」というsession durationを優先して確認し、word countはそのsessionで扱う範囲・進捗の情報として残す。利用者自身が「毎日20語」のような明示targetを与えた場合はその量を保持するが、calendar配置はsession durationと分離する。

利用者がすでにtotal duration、per-unit duration、session durationのいずれかを明示している場合は、同じ情報を別表現で聞き直さない。application側がどのevidenceで十分かを決定し、AIには必要な質問意図だけを渡す。単位変換、整数ページ・整数問題への丸め、残量から所要時間への計算、sessionへの分割はdeterministic codeの責務とする。

## 3. 開始時点の棚卸し

過去の2026-08-07会話品質task群は、component parent、cross-turn binding、recurrence、current-turn delta、durable concern、goal eventとdeadline、failure artifact、実APItimeout、provenanceの実装と回帰が現コードに存在する。一方でtask文書がactiveのまま残っているため、実装漏れとは決めつけずLuna再観測scenarioのinventoryとして扱う。

PR #109のhuman-reviewed conversation loopはbaselineとして完了しているが、root task queueに残っている。今回の最終再観測後にclosedへ移し、現在taskとの関係を明記する。

Issue #118は部分実装である。completed workloadからremaining effortを導くdeterministic計算、provenance、5分/15分単位の切り上げ回帰は存在するが、remaining workloadの直接所要時間を聞く前にcompleted duration evidenceを尋ねる会話policyが未完了である。今回の既知feature差分はここに限定する。

Issue #52の週間計画UI大規模責務分離とIssue #115のraw-text regex routingは独立scopeを維持し、このPRへ混在させない。

## 4. 実行順序

```text
roadmap / current contract / task正本を同期
→ stale task・Issue・PRと現コード回帰を対応付け
→ deterministic baselineとprompt byte実測を記録
→ historical scenarioをresumable実APIで1 turnずつLuna再観測
→ 明確な失敗ごとに停止、原因層修正、対象回帰、full CI、同地点再実行
→ Issue #118の未完了会話policyを実装・実API確認
→ production heuristic inventoryと敵対的回帰を再確認
→ prompt簡素化候補をLuna ablationし、安全に削れるものだけ反映
→ 最終HEADで通し実API会話をpreviewまで完走
→ Browser Regression、normal CI、trace persistence、文書closeout
```

## 5. 一対話ずつ再観測するscenario

最低限、次の意味境界を別conversationまたは明示したcheckpoint系列で観測する。

1. broad study/projectが`needs_breakdown`となり、対象に合う単位で全体範囲と進捗を一度に確認する会話
2. breakdown回答がexact accepted taskへbindingされ、過去factや古いuncertaintyを再送しない会話
3. total、completed、remainingのquantity roleとcross-turn entity binding
4. recurrenceとcomponent parent identityの保持
5. goal event dateをwork deadlineへ強めず、durable concernとprovenanceを保持する会話
6. correction/no-op/re-previewでrevision、idempotency、previewを壊さない会話
7. completed workloadとcompleted durationからremaining effortを導くIssue #118会話
8. calendar/availability、explicit time、relation、session splittingを含む代表会話

各turnでtranscriptだけでなく、semantic raw response、accepted document、validation/repair、formal binding、Fact Graph、dialogue decision、renderer、preview、trace persistenceを確認する。AI文面や一つのsemantic output shapeを固定oracleにはしない。

## 6. Prompt / Luna監査

[OpenAIのGPT-5.6移行ガイド](https://developers.openai.com/api/docs/guides/upgrading-to-gpt-5p6-sol)は、Lunaをefficient/high-volume workload向けとして位置付け、代表taskで同一設定と簡素化候補を比較すること、promptは一群ずつ削って同じevalを再実行することを求めている。今回もモデルをminiへ戻さず、Lunaの実runをbaselineとして扱う。

最初のIssue #118会話turn 1は、run `31785259304`でprovider 400となった。response bodyを保持していなかったため、この地点では原因を確定できず、構造化されたprovider errorのtype/code/param/messageだけをbounded diagnosticsへ保存するよう直結clientを修正した。同一turnの再試行run `31785552702`により、`code=unsupported_value`、`param=temperature`、`temperature: 0`はこのモデルで非対応で既定値1のみ対応、というOpenAI応答を確認した。どちらもgraph revision 0、未commitであり、会話checkpointは汚染されていない。

この実測に基づき、`gpt-5.6-luna`を維持したまま、直結clientと本番Cloudflare proxyのOpenAI上流requestからtemperatureだけを省略する共有parameter policyを追加した。他モデルへの既存temperature指定は維持する。対象回帰17件とTypeScriptを通した後、同じturnをattempt 3として再実行する。

attempt 3のrun `31786044289`はLunaで成功した。Graph revision 1に、数学→ワークのcomponent階層、completed 30 pages、remaining 50 pages、同じ週のtarget 50 pagesがcurrent-turn evidence付きで入り、質問targetはcompleted workloadになった。利用者向け文面は「ワークについて、完了した30ページには、合計でどれくらい時間がかかりましたか？」であり、remaining 50 pagesの所要時間を先に尋ねていない。

初回semantic出力はtotal 80 pagesを`declared`のままcompleted 30 pagesと併存させ、既存validatorが拒否した。1回のAI repairでcompleted 30、remaining 50、target 50へ修正されて受理されたため機能上は合格とするが、17.6秒・2 provider callsを要した。この事実はprompt簡素化/structured normalizationのablation候補として保持し、固定文面や特定発話専用ruleは追加しない。

turn 2のrun `31786200882`はworkflow上はgreenだったが、意味上は不採用とした。90分はcompleted 30 pagesの`total_duration`へ正しくbindingされ、各50 pagesの見積りも150分だった一方、work-item compilerがremaining 50とtarget 50を別々に配置し、合計100 pages・300分・4候補を作ったためである。

修正はscheduler入力のquantity-role選択へ限定した。同じtask/component/unitに明示targetがある場合、targetをplanned work、remainingを進捗contextとして扱い、remainingから別work itemを作らない。Fact Graphからremainingを削除せず、target候補の`sourceFactRefs`へremaining、completed、observed effortと共に残す。component/unitが異なる場合は抑制しない。pure compiler、distribution、2-turn application、trace exportを含む対象42件とTypeScriptを通し、同じturn 1 checkpointからturn 2を再試行する。

turn 2の再試行run `31786546124`はLunaで意味上も合格した。accepted graphにはcompleted 30 pagesへ`total_duration=90`が入り、schedulerはcompletedを非計画、同一scopeのremainingを明示targetのcontextとして非計画にした。previewは25 pagesずつ2件、75分ずつ、合計50 pages・150分であり、二重計上はない。両候補の`sourceFactRefs`にはtask、material component、target、remaining、completed、observed effortがすべて残った。利用者向け文面も実績ペースを根拠に2件を作ったことを説明している。これによりIssue #118の未完了acceptanceは、対象回帰と2-turn実API会話の双方で満たした。

historical scenario turn 1のrun `31786921036`も会話品質として合格した。「来週の勉強計画を一緒に考えてほしいです。」からrelative planning windowを作り、8月17日〜23日と説明したうえで、予定へ入れる作業を一つ尋ねた。初回Luna出力はrelative-week valueをcanonical enumの`next_week`ではなく「来週」としたためvalidatorが拒否し、1回のAI repairで受理された。Graphやcheckpointは正しくrevision 1へ進んだが、約17〜18KBのgeneric requestを2回送る必要はないため、機能failureではなくfocused repairまたはstructural normalizationのablation候補として保持する。

historical turn 2のrun `31787045539`は、夏休みの課題を`needs_breakdown`、共通テスト模試の勉強を別task、数学を模試taskのcomponentとして受理した。2週間後の模試はowner-level goal event、数学がまずいという発話はowner-level concernへcurrent-turn provenance付きで保存され、goal eventをwork deadlineへ強めていない。dialogueは課題の中身を一つの答えやすい質問で尋ねた。初回出力のdateExpressionがunsupportedだったため1回repairしたが、意味・Graph・質問は合格である。次turnは実際の質問へ答え、過去に失敗したexact breakdown bindingと、量の比較をschedule priorityへ誤昇格しない境界を再観測する。

historical turn 3のrun `31787183640`では、semantic層は既存の夏休み課題taskへ数学ワークと古典課題を追加し、breakdown uncertaintyを閉じ、関係factを作らなかった。したがってexact target binding、current-turn delta、quantity comparisonをpriorityへ誤昇格しない境界は合格した。一方、次の質問が具体componentではなく旧umbrella componentの「夏休みの課題」全体へ範囲と進捗を尋ね、異なる単位の2教材を再び一括回答させる形になったため、会話品質上は不採用とした。

原因はsemantic AIではなくapplicationのmissing-work question target選択である。解消済み`work_breakdown` uncertaintyより後に追加されたcomponentだけを具体候補とし、component階層ではworkloadのないleafを優先し、一度に一件だけ質問する。選択したcomponent/task Fact IDを`lastQuestionContext.topicId`へ保持し、次turnの`pendingQuestion.targetFactId`へ渡す。特定の教材名や日本語表現は判定に使わない。pure question selection、runtime projection、breakdown/current-delta contractの対象18件とTypeScriptを通し、turn 2 checkpointから同じturn 3を再試行する。

turn 3再試行run `31787630567`は合格した。Graphは数学ワークと古典課題を同じ既存taskの具体componentとして保持し、relationは空、旧breakdown uncertaintyはinactiveのままである。質問は数学ワーク一件だけを対象にし、`lastQuestionContext.topicId`もそのcomponent Fact IDを保持した。

historical turn 4のrun `31787781166`は、数学ワークへcompleted 30 pages、derived remaining 50 pages、next-week target 25 pages、completed workloadのobserved total 90 minutesを正確に追加し、次の具体componentである古典課題だけを質問した。初回Luna出力はtotal 80を`declared`としてcompleted 30と併存させ、validator後の1回repairでremaining 50へ直した。Issue #118初回と同じ形が再現したため、会話baseline完了後に意味を推測しないstructural normalizationでこのprovider再呼び出しを除けるかablationする。

historical turn 5のrun `31787953951`は、古典課題へcompleted 3 sheets、remaining/target 7 sheets、15 minutes per sheetを正確に追加し、次に模試task内の数学component一件だけを質問した。ここでもtotal 10を`declared`とした初回出力を1回repairしており、同じstructural inefficiencyは3回再現した。

historical turn 6のrun `31788110631`は`stable_v5_normalization_rejected`となり、成功済みturn 5 checkpointとGraph revision 6を保った。Lunaは模試数学のtarget 2 hours per occurrenceとdaily recurrenceを意味上は正しく出力し、pending targetのcomponent public IDも正確に転記したが、その親task public IDだけを1文字列として壊した。generic repairはtask/componentの両IDをさらに別文字列へ変え、2回ともexisting-entity validationが拒否した。

修正はexact pending bindingのrepresentation normalizationに限定した。`missing_schedulable_work`のpending targetがactive componentで、出力が一つのtask/componentを既存Factへbindしようとし、親子の片方がexact ID、もう片方だけがどのactive IDにも一致しない場合に限り、public graphのcomponent→task関係から未知側IDを復元する。両方が未知、または別のvalid public IDなら変更しない。label similarity、編集距離、raw textは使わない。normalizer/cross-turn/trace exportを含む対象16件とTypeScriptを通し、turn 5 checkpointからturn 6を再試行する。

turn 6 attempt 2のrun `31788424582`もnormalization rejectedとなったが、今回はtask/component public IDは両方exactだった。Lunaはdaily recurrenceの`targetLocalId`をschemaが許可するtask/component local IDではなく、同じcomponent内のworkload local IDにしており、generic repairでも同じ形を返した。workload local IDがJSON内で一つのownerへだけ解決できる場合に限り、そのtask/component local IDへrecurrence targetを移すstructural normalizationを追加した。曖昧または非workload targetは変更しない。binding、recurrence、trace persistenceを含む対象19件とTypeScriptを通し、同じcheckpointからattempt 3を実行する。

turn 6 attempt 3のrun `31788647370`はsemantic normalizationとworkflow自体は成功した。Graph revision 7には模試数学componentへのtarget 2 hours、`perOccurrence=true`、daily recurrenceがexact IDとcurrent-turn provenance付きで入り、workload-local recurrence targetも一意なcomponentへ決定論的に正規化された。しかし人手判定では不採用とした。assistantは「模試対策の数学を毎日2時間」と説明した一方、schedulerは数学ワーク25ページ、古典7枚、模試数学2時間を各1件だけ、合計3件としてpreviewし、daily recurrenceを7回へ展開していなかった。

原因はsemantic AIではなくscheduler work distributionである。aggregate work-item compilerは`perOccurrence`とrecurrenceを配置単位へ反映せず、placementもwork item固有の日付を持っていなかった。修正では、同じtaskかつexact component/task targetに一つだけ対応するsimple recurrence (`daily` / `weekdays` / `weekends`) がある`perOccurrence` workloadに限り、planning horizon内の各該当日へ決定論的に展開し、その日を`requiredDate`としてplacementへ渡す。recurrence Fact IDを各work itemとpreview candidateの`sourceFactRefs`へ残し、非`perOccurrence`、異なるtarget、複数recurrence、advanced recurrenceを流用または推測しない。該当日がhorizon内に0件なら一回分を捏造せず、予定対象も0件とする。

対象回帰ではdaily 2 hoursが7 work items・7 exact dates・合計840分となり、previewも8月17日から23日まで各日1件になった。非`perOccurrence`、target mismatch、weekend、horizon内0件、task exclusionとの交差を敵対条件として固定し、一日でも配置不能ならpartial previewを返さず`insufficient_capacity`になる。attempt 3 artifactの実Graphを修正後コードへそのまま入力したlocal再生でも、scheduler inputが9 work items、previewがready、数学ワーク1件・古典1件・模試数学7件の合計9候補となった。追加したtrace persistence回帰は、生成された7候補の日付とrecurrence provenanceがclient document上限内で記録され、初回append失敗後のpersistent outbox再送、Worker preparation、server document上限を通ること、将来fieldを保持し巨大値を明示的にtruncateすることまで確認する。full scheduler inputは既存のsize/privacy方針どおりtraceへ複製せず、配置結果の日付とmaterial provenanceを診断上の代替情報とする。

turn 6 attempt 4のrun `31789525607`は実API経路でもpreviewまで成功し、利用者向け文面は「来週の仮予定候補を9件作成しました。数学のワーク25ページ、古典の課題7枚、模試対策の数学は毎日2時間の内容です」と、実際の候補数・内容に一致した。候補は数学ワーク75分が1件、古典105分が1件、模試数学120分が8月17日から23日まで各日1件の7件である。各daily候補はtask、component、workload、recurrence Fact IDをprovenanceに持つ。CI run `31789528526`とBrowser Regression run `31789528489`もgreenであり、historical baselineのrecurrence/component-parent境界は合格した。

ただしattempt 4の初回Luna出力はexact existing taskを参照しながらtask titleを空文字にし、`document.tasks[0].title`で1回repairした。さらにrecurrence targetは再びworkload local IDだったが、これは既存の一意なstructural normalizationでcomponentへ移された。機能上の不合格ではないが、26,036 bytesと27,903 bytesのprovider requestを2回、19.0秒要したため、空titleのexact-public-ID復元と反復するtotal/completed normalizationをprompt/structural ablation候補へ追加する。historical会話を先へ進める前に、この修正を含む最終scheduler HEADでも同じcheckpointを再確認する。

turn 7 attempt 1のrun `31789809229`は、2 hoursから1.5 hoursへのexact workload correctionをprovider 1回・repair 0回で受理した。旧workloadだけをsupersedeし、daily recurrenceはactiveのまま保持した。Graph revision 9のre-previewは引き続き9件で、模試数学は7日すべて90分、旧120分候補は残らない。semantic、correction lifecycle、schedulerは合格した。

ただし最終表示は不採用とした。Luna renderer自身が「模試対策の数学を毎日1時間半に変更し」と自然に説明した後へ、旧来の決定論的self-repair notice「共通テスト模試の勉強を進めるは2時間ではなく1.5時間ですね。修正しました。」を再び前置し、同じ訂正を二度述べた。final messageは410 bytes、renderer単体は303 bytesで、107 bytes（26.1%）が重複だった。

一要素ablationとして、成功したAI renderer応答をcomplete presentationとして採用し、決定論的noticeの後段連結を外した。Fact correction、lifecycle、preview、approval/saveは引き続きdeterministicであり、provider/validation失敗時のdeterministic fallbackにはnoticeを残す。prompt、schema、provider call数は変更しない。成功経路とfallback経路の回帰、renderer trace、persistent outbox、Worker preparationを含む全335 test files（1,551 passed、14 skipped、5 todo）、TypeScript、production buildを通し、同じturn 6 checkpointから自然さを再比較する。

turn 7 attempt 2は修正ファイルを誤った複製パスへpublishした実行であり、active runtimeの比較標本には採用しない。誤配置した2ファイルを除去して実所有パスへ同じ一要素変更を反映し、attempt 3のrun `31790596070`で再比較した。

attempt 3はprovider 1回・repair 0回、9.3秒、26,677 bytesでsemantic correctionを受理した。Graph revision 9、旧workloadのsupersede、active daily recurrence、8月17日〜23日の90分候補7件、数学ワーク75分、古典105分、合計9件とrecurrence provenanceはattempt 1と一致する。最終文はrendererの「模試対策の数学を、毎日2時間から1時間半に変更しました。来週分の仮予定候補を9件作成しています。内容を確認して、問題なければ『この内容で仮予定にする』を押してください。」だけになり、決定論的noticeの二重前置は消えた。意味・候補・操作案内が一致し、同じ修正を繰り返さないため合格とする。


turn 8 attempt 1のrun `31790894628`では、「ありがとうございます。この内容で大丈夫です。」をLunaがproposalへの`accept` decisionとしてprovider 1回・repair 0回で正しく構造化した一方、deterministic canonicalizerがそのapplication-level decisionをFact Graphへ追加し、revisionを9から10へ進めて同じ9件を再previewした。これはno-op turnでrevisionを増やさず既存previewを保持する現行contractへの違反である。修正はraw textではなくstructured `target.kind=proposal`だけを用い、proposal decisionをsemantic request/response/validation traceには保持しつつ、Fact Graphへは永続化しない境界に限定した。planning-window等のGraph factを対象とするdecision、approval/saveのUI境界、applied turn keyは変更しない。

同じcheckpoint・入力のattempt 2 run `31791667885`では、provider 1回・repair 0回で同じproposal acceptを返した後、canonical diffはrevision 9→9、added/superseded/removedすべて0、`preview_unchanged` branchとなり、preview schedulerは実行されなかった。checkpointはrevision 9の同じstable key・同じ9候補を保持し、`shouldSavePlan=false`のまま、rendererは9件の内容と「この内容で仮予定にする」ボタンを自然に案内した。localはfocused 13件、TypeScript、全333 test files（1,547 tests）、production buildがgreenで、commit `07b6750`のnormal CI run `31791670915`、Browser Regression run `31791670932`、実API run `31791667885`もすべてgreenである。


turn 9のrun `31791952338`は、「模試対策の数学は、できれば夕方にしてください。」をexact既存task/componentへのsoft `preferred_window=evening`としてprovider 1回・repair 0回で受理した。Graph revision 9→10でtemporal constraintだけを一件追加し、daily recurrence、1.5 hours per occurrence、数学ワーク、古典には変更がない。re-previewは合計9件のまま、模試数学7件を8月17日〜23日の各日17:00–18:30へ配置し、rendererも夕方希望、毎日1時間半、9件を一致して説明した。normal CI run `31791955975`、Browser Regression run `31791956014`、実API run `31791952338`はすべてgreenであり、modifier target、soft preference、re-previewのhistorical contractは合格した。

開始時点の代表request実測は次である。

- meaning policy: 3,575 bytes
- generic supplemental policy: 1,427 bytes
- generic system prompt: 5,002 bytes
- provider JSON Schema: 11,333 bytes
- representative generic request: 17,351 bytes
- focused authorization request: 1,202 bytes
- focused contextual answer request: 2,263 bytes

現在のgeneric requestはbudget内であり、最大部分はprovider schemaである。したがって単純な文字数削減を目的に安全指示を落とさない。

監査では規則を、意味・domain・安全contract、schemaと重複するrepresentation contract、historical model weakness向けscaffolding、deterministicで意味を変えず扱えるnormalizationへ分類する。Luna ablation前後で同じscenarioを比較し、明確な退行がなく、schema/validator/repairとの重複も減る場合だけ削除する。通常CIへmodel比較oracleや一時的ablation artifactを残さない。

## 7. Heuristic監査

過去に導入したheuristicは、raw textの意味解釈ではなくaccepted structured factsに対するdeterministic policyであることを確認する。対象はhuman-scale effort質問、per-unit/total/session effort、vocabulary session分割、tiny-tail抑制、長いfree segment優先、existing plan/timetable buffer、relation ordering、request-time not-before、reserve/review policy、observed pace derivation、5分/15分allocation granularityである。

human-scale effort質問については、page/problemを原則1単位の推定基礎にし、大きい教材構造単位を直接の時間予測へ使わない方針を追加確認する。page/problemの量がある場合、observed paceまたは既存direct estimateがなければper-unit durationを優先して取得し、総量の時間はdeterministicに導く。wordはsession-based effortを既定とする。これらの質問要否・evidence優先順位・丸め・session分割はapplication側で決め、教材名やraw textから難易度を推測するheuristicは追加しない。

calendar関連では、相対日・相対週の自然言語意味だけをAIが構造化し、具体日付への展開はrequest clock、time zone、week-start設定とcalendar resolverで決定論的に行うことを再確認する。canonical wire literalの綴りを守らせるためだけのprompt guardを増やさず、有限値ならschemaで閉じる。

happy pathだけでなく、unit/component mismatch、曖昧なprovenance、既存のdirect estimate優先、今日の過去時刻、partial placement、cycle、stale previewを敵対的回帰で確認する。

## 8. Trace persistence gate

prompt、AI request/response、renderer、Fact Graph、intake、scheduler、trace fieldを変更した場合は、実際のrequest/diagnosticsがtraceへ入り、client byte target、outbox retry、worker preparation、server size limit、unknown sentinel、truncation metadataを既存の強いpersistence regressionで確認する。新しいfieldを追加しただけで完了扱いにしない。

## 9. 完了条件

- stale task、Issue、PRの棚卸しが現コード根拠と一致する
- historical scenarioを一対話ずつLunaで再観測し、明確な失敗を未処理のまま次へ送っていない
- Issue #118の未完了acceptanceが実装、回帰、実API会話で確認されている
- promptの長さと複雑さを実測し、削除・維持の判断にLuna ablationの根拠がある
- production heuristic inventoryが対象回帰と敵対的回帰でgreenである
- 日付の具体化がAIのカレンダー計算ではなくdeterministic calendar resolverで行われ、相対表現のwire綴りだけを守らせるprompt guardに依存しない
- page/problemは1単位あたりの速度を推定基礎とし、chapter/section等は原則scopeへ分離、wordはsession duration中心というworkload方針が回帰と実会話で確認されている
- 最終HEADの通し実API会話がpreviewまで完走する
- Browser Regressionとnormal CIが最終HEADでgreenである
- `npm run typecheck`、`npm run test:run`、`npm run build`がlocalでもgreenである
- roadmap、current contract、current status、task queue、関連Issueが最終状態と一致する

途中のstepsが0件だったことはpassでもfailでもない。最終transcriptとtraceを人間が読んで会話品質を確認するまでは完了扱いにしない。