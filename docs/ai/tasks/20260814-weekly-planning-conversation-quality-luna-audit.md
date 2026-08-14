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

happy pathだけでなく、unit/component mismatch、曖昧なprovenance、既存のdirect estimate優先、今日の過去時刻、partial placement、cycle、stale previewを敵対的回帰で確認する。

## 8. Trace persistence gate

prompt、AI request/response、renderer、Fact Graph、intake、scheduler、trace fieldを変更した場合は、実際のrequest/diagnosticsがtraceへ入り、client byte target、outbox retry、worker preparation、server size limit、unknown sentinel、truncation metadataを既存の強いpersistence regressionで確認する。新しいfieldを追加しただけで完了扱いにしない。

## 9. 完了条件

- stale task、Issue、PRの棚卸しが現コード根拠と一致する
- historical scenarioを一対話ずつLunaで再観測し、明確な失敗を未処理のまま次へ送っていない
- Issue #118の未完了acceptanceが実装、回帰、実API会話で確認されている
- promptの長さと複雑さを実測し、削除・維持の判断にLuna ablationの根拠がある
- production heuristic inventoryが対象回帰と敵対的回帰でgreenである
- 最終HEADの通し実API会話がpreviewまで完走する
- Browser Regressionとnormal CIが最終HEADでgreenである
- `npm run typecheck`、`npm run test:run`、`npm run build`がlocalでもgreenである
- roadmap、current contract、current status、task queue、関連Issueが最終状態と一致する

途中のstepsが0件だったことはpassでもfailでもない。最終transcriptとtraceを人間が読んで会話品質を確認するまでは完了扱いにしない。
