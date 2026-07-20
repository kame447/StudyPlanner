# StudyPlanner PR #68 統括監査報告

- 監査対象HEAD: `23d7676370b3efebc8d1465dfd01abc32c6462ca`
- 比較元HEAD: `34c6744fefbc9b7f34bce36b97d47da4a86bf264` (`origin/main`)
- 完了した独立監査人数: 6
- 部分監査人数: 1（監査人6）
- 統括監査: 実施
- 全体テスト/build/diff check/最終status: メイン最終検証待ち
- 採用判定: **採用不可**

## 結論

コード品質の採用判定は **採用不可** とする。PR差分内またはPRが新たに成立させる契約内で、BLOCKERは確認しなかったが、MAJOR 9件とMINOR 1件を実コードとfocused反例で確定した。MAJORが1件でも残る場合は採用不可という規則に従う。

特に、PRが追加したAI出力groundingは値の存在確認に偏っており、時刻の開始・終了役割、分精度、同一節への対応、単位、全優先順を保存前に保証できていない。さらに通常の「1科目」を院試scopeへ誤分類するdeterministic回帰、canonical値と異なる受理表示、traceの再試行不能・PII再露出・legacy取得不能が残る。

監査完全性はコード品質判定と分ける。独立監査は完了6件、ユーザー指示で追加調査を中止した部分監査1件（監査人6）であり、完全な独立監査7/7完了とは扱えない。この完全性制約だけでも元の「7件すべて完了」ゲートは未達である。一方、採用不可のコード品質判定は監査人の人数や一致ではなく、統括で再確認した実装と再現結果に基づく。

## BLOCKER

なし。

## MAJOR

### M-1: life constraintの時刻groundingが分精度・開始終了役割・同一節対応を保証しない

- 対象ファイル/関数: `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts:234-270` の `normalizedTextContainsValue` / `lifeConstraintPayloadGrounded`、同 `:291-312` のkind grounding、同 `:450-461` のlife constraint分岐、`src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts:350-357`。
- 再現条件: `23時から7時まで寝ます` に sleep `07:00-23:00` または `23:30-07:45` を返す、`23時30分から7時まで` に `23:00-07:00` を返す、あるいは `睡眠は23時から7時、夕食は19時から20時` に sleep `19:00-20:00` を返す。
- 現挙動: いずれもAI candidateがacceptedとなる。`23:30`用正規表現でも分部分全体がoptionalなので裸の`23時`に一致し、start/endは発話中のどこかに各値があればよく、役割やkindと同じ節に属することを検査しない。accepted commandはhard sleep constraintとしてstateへ入る。
- 期待: hour-only入力は`:00`にだけ対応させる。分が明示された場合は分まで一致させる。`から`側をstart、`まで`側をendへ結び、複数生活制約ではkindと時刻を同じsource segmentへ結び付ける。不一致はrejectまたは限定的なrepair質問へ回す。
- 影響: 睡眠時間を反転、30/45分ずらし、または食事時間へ置換したhard constraintがpreviewの利用可能時間を直接変える。ユーザーが述べていない時間に学習予定を配置し得る。
- 原因: semantic relationではなく、正規化文字列内のtoken presenceだけでgroundingを成立させている。
- 既存テスト未検出理由: 正しい`23時`→`23:00`、明白に異なる`22:00`、単一kindの取り違えしか覆わず、同じhourの非zero minute、endpoint swap、明示minuteの切捨て、複数節cross-associationを含まない。
- 重要度理由: 未根拠のhard constraintが通常pipelineからstateと生成計画へ無確認で到達する中核的な意味整合性違反である。最終Plan承認境界は残るためBLOCKERではなくMAJOR。
- 統括の再確認証拠: 指定Node 22の一時Vitestで上記4反例を実production validatorへ通し、4件すべてacceptedになることを確認した。

### M-2: meal/bath質問への自然な短答を直前文脈でgroundingできず、回答を捨てる

- 対象ファイル/関数: `weeklyPlanningCandidateValidator.ts:291-312` の `lifeConstraintKindGrounded`、`src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts:441-480` のinterpreter summary、`src/features/weeklyPlanning/weeklyPlanningTurnExecutor.ts:96-108` の`lastQuestionContext`保存。
- 再現条件: assistantが`meal_bath_constraints`を質問した直後にユーザーが`19時です`と答え、AIがmealの`start=19:00`を正しく構造化する。
- 現挙動: 直前質問によるkind groundingの例外は`kind === sleep`かつ`sleep_cycle`だけである。meal candidateは`ungrounded-life-constraint`として棄却され、stateへ入らない。棄却理由は通常会話に表示されない。
- 期待: `meal_bath_constraints`の質問文脈をmeal/bath groundingへ使う。質問自体が食事と入浴の両方を含み、短答だけではどちらか決まらない場合は、値を黙って捨てず「19時は夕食開始ですか」等のrepairへ回す。複数表示した質問への回答文脈も追跡可能にする。
- 影響: 最も自然な会話形式の回答が無言で無効になり、同じ不足質問が続くか、食事・入浴制約なしのpreviewへ進み得る。
- 原因: question contextとlife-constraint subtypeの対応がsleepだけにハードコードされ、表示可能な最大2問と保存する単一contextのモデルも一致していない。
- 既存テスト未検出理由: `夕食は19時`や`食事時間は60分`のような自己完結入力を中心にし、直前質問に意味を依存するbare-time replyを通していない。
- 重要度理由: 低摩擦な対話入力の主要経路が回答を消失させ、予定配置条件を欠落させるためMAJOR。
- 統括の再確認証拠: `lastQuestions=[meal_bath_constraints]`、発話`19時です`、meal `19:00`を実validatorへ渡し、acceptedなし、理由`ungrounded-life-constraint`を確認した。

### M-3: unit-rate質問への単位なし数値から3分と180分の双方を受理できる

- 対象ファイル/関数: `weeklyPlanningCandidateValidator.ts:207-231,358-375`、`weeklyPlanningIntakeReducer.ts:397-406`、`weeklyPlanningMissingStatus.ts:48-65`。
- 再現条件: `unit_rate`質問直後、既知scopeが`year_field_chunk`の状態でユーザーが`3`とだけ回答し、AIが別々に`minutesPerUnit=3`と`minutesPerUnit=180`を返す。
- 現挙動: 直前質問と数値の存在でduration evidenceを成立させる一方、明示単位がないため`explicitMinuteValues`は空で、canonical値との一致検査をスキップする。そのため3分・180分の双方がacceptedとなり、どちらもmissing/readinessを解消できる。
- 期待: 質問契約が「何時間」と単位を明示しているなら、その単位へ一意に変換する。契約から単位を一意に決められないなら単位確認を続け、複数のcanonical値を同じ発話へgroundingしない。
- 影響: 60倍異なる作業見積りがpreview、配置可否、残作業量を直接変える。
- 原因: 「数字がある」ことを「minutesPerUnitの値と単位が根拠づけられた」ことと同一視している。
- 既存テスト未検出理由: `3時間です`→30分のような明示単位の不一致は覆うが、単位を省略した短答に複数解釈を当てる負方向がない。
- 重要度理由: readinessを成立させる主要見積りが最大60倍ずれたまま確定するためMAJOR。
- 統括の再確認証拠: 同じ`3`と同じquestion contextに対し3分、180分を実validatorへ別々に渡し、両方acceptedを確認した。

### M-4: priority groundingが先頭だけを見て、対象欠落と後続順逆転を受理する

- 対象ファイル/関数: `weeklyPlanningCandidateValidator.ts:277-289,377-393` の `priorityHeadGrounded` / priority分岐、`weeklyPlanningIntakeReducer.ts:360-369`、`weeklyPlanningDraftRequestAdapter.ts:48-83`。
- 再現条件: 既知fieldsが`OS, ネットワーク, データベース`、発話が`OSから進め、次にネットワーク、最後にデータベースです`のとき、AIが`[OS]`または`[OS, データベース, ネットワーク]`を返す。
- 現挙動: order要素が既知fieldか、重複がないか、先頭OSが発話にgroundedかだけを確認し、全field被覆と2番目以降の相対順を確認しない。両反例がacceptedとなり、reducerはpriority missingを除く。
- 期待: ユーザーが明示した対象を欠落させず、明示した全相対順と一致する完全orderだけをconfirmedにする。不完全なpartial orderを許す場合は不足を保持し、残りの扱いを確認する。
- 影響: 指定分野が計画から優先順上消える、または後続分野を逆順に配置する。
- 原因: full-order relation / scope coverageを構造的不変条件にせず、head-only groundingで代用している。
- 既存テスト未検出理由: 2分野の完全逆転は先頭不一致で落ちるため通るが、先頭を維持した3分野tail permutationとpartial orderを含まない。
- 重要度理由: 学習順序はdraft内容を直接決め、誤orderがconfirmedとして保存経路へ進むためMAJOR。
- 統括の再確認証拠: 上記2orderを実validatorへ渡し、両方acceptedになることをfocused Vitestで確認した。

### M-5: 一般的な「1科目」をdeterministic層が院試scopeと誤分類する

- 対象ファイル/関数: `src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts:947-1011` のfield/totalFields抽出、同`:1039-1107` のscope merge/signal、`weeklyPlanningIntakeReducer.ts:408-439`、`weeklyPlanningIntakePipeline.ts:540-550`。
- 再現条件: rulesまたはAI前処理へ`来週は数学を1科目勉強する計画を立てたいです`を入力する。
- 現挙動: 「院試」「過去問」「年度」「分野」がないのに`1科目`だけでexam signalとなり、`examPrepScope.totalFields=1`を作る。focused再現では通常taskは空、`tasks_or_goals` missingが除去された。AI経路でも同じdeterministic preparationを先に通る。
- 期待: 数量付き一般語「科目」だけではentrance-exam scopeを確定しない。明示的な院試/過去問文脈、既存exam scope、または対応slotへの短答がある場合に限る。それ以外は通常study goalまたはAI意味解釈へ委ねる。
- 影響: MVPの一般的な学習計画がexam flowへ誤ルーティングされ、通常goalが消失し、不要な年度・単位時間・優先順質問やpreview不生成につながる。
- 原因: PRで`parseTotalFields`と`hasExamScopeSignal`へ`科目`を追加したが、exam文脈guardを付けていない。空fieldsでもtotalFieldsだけでscopeを有効にし、reducerが通常task missingを解消する。
- 既存テスト未検出理由: 院試・過去問・「AとBで一科目」という正方向を中心にし、「科目」を通常の教科数として使う非exam発話がない。
- 重要度理由: provider非依存の前処理でcore MVP requestを別flowへ変え、計画作成を妨げる回帰のためMAJOR。
- 統括の再確認証拠: 実`applyDeterministicWeeklyPlanningUserTurn`へ上記入力を渡し、`examPrepScope.totalFields=1`、`tasks=[]`、`tasks_or_goals` missing消失を確認した。該当`科目`拡張は`origin/main...HEAD`差分内である。

### M-6: accepted-fact表示が未検証rawTextをcanonical値より優先する

- 対象ファイル/関数: `weeklyPlanningCandidateValidator.ts:358-375`、`weeklyPlanningCommandAdapter.ts:165-169`、`src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts:167-184,351-354,490-492`。
- 再現条件: 発話`3時間です`にAIがcanonical `minutesPerUnit=180`と`rawText=30分`を持つcommandを返す。
- 現挙動: validatorはcanonical 180分が発話の3時間と一致することだけを確認し、rawTextとの内部整合を検査しない。stateは180分だがrendererの`unitRateDisplayLabel`はrawTextから`30分`を選び、acknowledgementは30分を受理したと表示する。
- 期待: accepted factはreducerが確定したcanonical値から表示するか、validation境界でrawTextとcanonical値の一致を保証する。rawTextは証跡であってauthoritative display値にしない。
- 影響: AI提案をレビュー可能にする受理表示自体が保存stateと矛盾し、ユーザーが誤訂正・誤承認する。
- 原因: evidence用raw dataがcanonical validationを迂回し、rendererで表示上の権威値へ昇格している。
- 既存テスト未検出理由: canonical値自体の不一致は覆うが、canonicalとrawTextの内部矛盾を作っていない。
- 重要度理由: AGENTS.mdが要求する「AI提案を適用前にレビュー可能にする」境界を直接壊し、ユーザーへ事実と異なる受理内容を示すためMAJOR。
- 統括の再確認証拠: previous/current state差分を実`createDialogueRenderInput`へ渡し、`unitRateMinutes=180`と同時に`unitRateDisplay='30分'`となることを確認した。validatorコード上rawText検査がないことも確認した。

### M-7: trace retryでexpireAtが変わり、immutable conflict後に部分保存から回復できない

- 対象ファイル/関数: `workers/ai-proxy/src/weeklyPlanningTracePrivacy.ts:286-379` のprepare/expireAt付与、`weeklyPlanningTraceApi.ts:217-267` の逐次entry保存とsession更新、`weeklyPlanningTraceFirestore.ts:248-320` のPATCH/maximum/immutable比較。
- 再現条件: 同一HTTP payloadを1秒後に再送する。特に複数entryの先行create成功後に後続entry、session PATCH、またはmaximum transformが失敗してから再送する。
- 現挙動: entry IDは同じだが、prepareがretry時刻から`expireAt=now+180日`を再生成する。既存entryとのimmutable比較はexpireAtも含むので最初の既存entryで409 conflictとなり、未保存の後続entryへ進めない。entry群、session metadata、entryCountは単一commitではなく、部分状態が残る。
- 期待: 同一payload retryは既存entryを同一と認識して成功扱いし、未保存itemから収束できること。代替としてentry群とsession summaryを原子的/条件付きcommitにする。server生成値はidempotency比較を壊さない安定値にする。
- 影響: entryだけ存在してentryCountが古い、session metadataだけ更新される等の診断journal不整合が通常retryで永久に回復不能になる。
- 原因: request時刻依存server fieldをimmutable documentの同値性へ含めたまま、複数writeを逐次・非原子的に行う。
- 既存テスト未検出理由: immutable testは同じprepared value objectを2回渡しており、HTTP/API prepareを再実行してexpireAtが変わるproduction retryを通さない。途中失敗後のreplayもない。
- 重要度理由: PR文書が明記する「同一payload再送だけをidempotentに受理」という中心契約を破り、障害時のdiagnostic dataを回復不能な部分状態にするためMAJOR。
- 統括の再確認証拠: 同一payloadを`t`と`t+1秒`で実`prepareWeeklyPlanningTraceWrite`へ渡し、entry IDは同一、expireAtは相違することを確認した。`setImmutableDocument`がid以外の全fieldを比較すること、APIが最初のconflictでloopを中断することを実コードで再確認した。

### M-8: fallback structural IDに埋めた電話番号がredaction後に復元される

- 対象ファイル/関数: `weeklyPlanningTracePrivacy.ts:230-245` のfallback ID regex、同`:308-379` のstructural field復元、`weeklyPlanningTraceApi.ts:119-147` のadmin safe出力。
- 再現条件: 認証済みuserがsession ID `weekly-trace-09012345678-abcdef`、conversation ID `weekly-conversation-08012345678-ghijkl`を送る。
- 現挙動: fallback validatorは両IDを正規と判定する。一般redactorは電話番号部分を`[PHONE]`へ変えるが、prepareはraw structural fieldを後から再代入し、admin safe処理もraw値を再代入する。電話番号を含むIDがFirestore path/fieldとadmin responseへ残る。
- 期待: structural値であってもPII detectorに一致するraw値を復元しない。fallback形式を残すならserver生成可能なtimestamp範囲・形式を厳密化し、電話番号形を許さない。
- 影響: 任意のverified userがcontentではmaskされる電話番号をstructural ID経由で180日保存し、管理者へ露出できるprivacy boundary bypass。
- 原因: 形だけ正しいIDを「安全」とみなし、redaction結果を無条件でraw値へ戻す。
- 既存テスト未検出理由: prefixに合わない電話番号入りIDだけを拒否例にし、正規表現へ適合するfallback形式を試していない。
- 重要度理由: 認証済み入力から永続化・管理者開示まで到達する個人情報保護境界の直接回避であるためMAJOR。
- 統括の再確認証拠: 上記IDがprepareを通り、一般redactorでは`[PHONE]`になる一方、prepared sessionと`safeWeeklyPlanningTraceDocumentsForAdmin`の出力ではraw電話番号へ戻ることを実関数で確認した。

### M-9: legacy読取分岐より前の新ID validatorが、直前実装の実document IDを拒否する

- 対象ファイル/関数: `weeklyPlanningTraceApi.ts:313-358` のadmin entries、`weeklyPlanningTracePrivacy.ts:230-263` の現行ID validator、比較元`origin/main`のprepare/append。
- 再現条件: `origin/main`実装でUUID sessionを保存し、そのsessionを現HEADのadmin sessions一覧から選んでentriesを取得する。
- 現挙動: 比較元はstructural IDもrecursive redactionした値をFirestore document IDに使うため、実pathは`weekly-trace-[UUID]`となる。現HEADのentries endpointはtarget取得や`storageLayoutVersion !== 1`分岐より前に`isWeeklyPlanningTraceSessionId`を実行し、このlegacy handleを400で拒否する。したがって追加されたlegacy分岐へ到達できない。
- 期待: 実際の旧path handleを安全に識別して取得する、migration/index mappingを用意する、または一覧に出したlegacy sessionを同じAPIで開けるようにする。
- 影響: PR直前に保存されたtraceが一覧には出ても開けず、過去journalの診断と回帰調査ができない。新appendはraw UUID pathへ分かれ、同じ会話系列も分断される。
- 原因: legacy fallbackを追加した一方、その前段に新形式専用validatorを置き、旧実装が実際に生成したredacted handleを互換形式へ含めていない。
- 既存テスト未検出理由: admin integrationは`storageLayoutVersion:1`とraw UUID IDだけを使い、`weekly-trace-[UUID]`という実legacy pathを通さない。
- 重要度理由: 明示的に追加されたlegacy compatibility/admin retrieval契約が直前の実データ形式に対して全面的に機能しないためMAJOR。
- 統括の再確認証拠: 現在と比較元のprepare/APIを比較し、比較元のredactorで正規UUID IDが`weekly-trace-[UUID]`になること、現validatorがその値をfalseにすることを実関数で確認した。entries handlerのvalidation順も再確認した。

## MINOR

### m-1: server write境界がtraceのdiscriminated schemaを検証しない

- 対象: `workers/ai-proxy/src/weeklyPlanningTracePrivacy.ts:308-379`、クライアント側validator `src/features/weeklyPlanning/trace/weeklyPlanningTraceTypes.ts:188-238`。
- 再現: validなsession/conversation/entry ID、entryCount、sequenceだけを用意し、entryを`kind:'turn', role:'admin', content:123`とする。
- 現挙動: server prepareは受理して保存対象にする。読み取り側の`isWeeklyPlanningTraceEntry`はこのshapeを拒否するため、sequenceを消費した永続documentがadminからsilent discardされ得る。
- 期待: untrusted JSON入口でsession status/timestampsとentry kindごとの有限schemaを検証し、無効shapeを400にする。
- 影響/原因: diagnostic dataの欠落と不可視documentを作れる。認可やPlan保存の根拠にはならないため、ユーザーデータ/認可を直接壊すMAJORではなくMINOR。
- 既存テスト未検出理由: privacy testsがstructural invariantだけを検証し、kind固有schemaを意図的に省いた最小objectを使用している。
- 統括証拠: 上記無効entryを実`prepareWeeklyPlanningTraceWrite`へ渡し、そのまま返ることをfocused Vitestで確認した。

## 除外した誤検知

- `3時間です`にcanonical 30分を割り当てるcommandは、`explicitMinuteValues`が180分を抽出するため`ungrounded-unit-rate`で拒否される。M-3は単位なし`3`に限定する。
- `23時から7時`に22:00を割り当てる、または単一sleep発話をmeal/bath kindへ変える明白な不一致は拒否される。M-1は同hourのminute、endpoint role、同一節associationの穴である。
- 2分野の完全逆転は先頭groundingで拒否される。M-4は先頭を保った3分野tail inversionとscope欠落である。
- 正しい`23時`→`23:00`と`23:00-07:00`は受理される。正常系の成功はM-1の隣接反例を防がない。
- `year_field_chunk`以外のunit rateだけで院試readinessが成立する候補は、現`hasConfirmedYearFieldUnitRate`とdraft adapterで防止済み。
- AI rendererが自由文からstateを変更する経路、constraint-source解決でnon-enumerable `sourceUserText`を失う経路、controllerのstale pending turnをcommitする経路は確認できなかった。
- 通常のmodal closeだけではApp所有のplanning state/controllerはunmountせず、生成中previewのcommit ownership guardも残る。
- trace `entryCount`はmaximum transformまで到達した競合更新間では後退しない。M-7はtransformへ到達しない部分失敗と、再送時のimmutable conflictである。
- 標準UUID structural ID自体のraw復元はpath一貫性のため必要であり、M-8はPII detectorへ一致するfallback IDだけに限定した。
- 「同一prepared object」を再度`setImmutableDocument`へ渡すテストは通るが、production HTTP retryはprepareを再実行してexpireAtを変えるため、M-7への反証にならない。
- 監査人間の一致、既存テスト成功、設計文書の「検証済み」という記述は、単独では採否根拠にしていない。

## PR外・運用残件

以下は現HEADで実在またはリスクが認められるが、該当中核実装が`origin/main`にも存在し、今回のPR差分起因の採用findingから分離した。別Issueで追跡すべきであり、上記件数には含めない。

1. **確定済みpriorityの明示訂正が`confirmed-slot-overwrite`で棄却される。** focused反例では`ネットワークを先に変えてください`が棄却された。ただしoverwrite guardとpriority correction不在は比較元にも存在する。ユーザーへ失敗を表示しない問題を含め、訂正lifecycle全体を別Issueで扱うべきである。
2. **開始指定のない「1週間」を現在日時開始のinferred rangeとして確定する。** `weeklyPlanningScopeParsing.ts:810-842`は比較元から存在し、rangeのconfidenceをconfirmed slot/readinessへ反映しない。今回の差分外。
3. **`buffer`が`sleep_cycle`を解消する。** `hasConfirmedSleepCycle`とreducerの`sleep || buffer`定義は比較元から存在する。睡眠未確認でdraft-readyになり得るため別Issueが必要。
4. **hard `unavailable`をfixed eventとして認識しながら`fixed_events` missingを除かない。** helper/reducerの非対称は比較元から存在する。会話反復のMINOR相当残件。
5. **複数draft承認中の週変更とreload recovery。** current state ownershipへapproval継続を結合し、pending approvalをstorageから除外する実装は比較元にもある。週変更で部分保存後に通知せずreturnする経路はコード上確認できる。reload後の新provenanceによる重複保存候補は統括で独立focused再現していないため、本報告では確定採用findingに数えず、保存復旧Issueで検証継続とする。
6. **追加controller integration testの実時計依存。** testはcontrollerの`now`を固定するがexecutor/pipelineへ`currentDateTime`を注入せず、`今日`のrangeが実時計を参照する。監査人1は夜間のpreview不生成を報告した。統括が12:12に単独実行した時点では1/1 passだったため、今回の即時失敗としては再現せず件数外としたが、時刻固定がない非決定性はコード上残る。テストを固定時計へ変更する運用残件である。
7. focused実行ではtrace repository未設定により`trace auth user is unavailable`のbest-effort stderrが反復したが、対象integration test自体はpassした。テスト出力のnoiseとして別途整理余地がある。

## 監査人別指摘の採否対応

### 監査人1（完了）

- M-1 sleep時刻の役割/分精度: **採用** → 統括M-1へ統合。
- M-2 meal/bath短答文脈: **採用** → 統括M-2。
- M-3 priority訂正: **現挙動は確認、PR外へ分離**。
- M-4 rawText受理表示: **採用** → 統括M-6。
- M-5実時計test: **依存は確認、統括時の失敗未再現** → 運用残件。

### 監査人2（完了）

- MAJOR-1 life constraint grounding: **採用** → 統括M-1。
- MAJOR-2一般「1科目」exam誤分類: **採用** → 統括M-5。

### 監査人3（完了）

- M1 inferred planning range: **現挙動はコード確認、PR外へ分離**。
- M2単位なしunit rate: **採用** → 統括M-3。
- M3 priority coverage/tail order: **採用** → 統括M-4。
- M4 life constraint minute/clause: **採用** → 統括M-1へ重複統合。
- M5 buffer→sleep readiness: **現挙動はコード確認、PR外へ分離**。
- m1 unavailable/fixed missing: **現挙動はコード確認、PR外へ分離**。

### 監査人4（完了）

- MAJOR-1 selectedDate変更中の無通知部分保存: **比較元にも存在するためPR外へ分離**。current code riskは残る。
- MAJOR-2 reload後の重複Plan候補: **PR外かつ統括focused未再現**。保存復旧Issueの検証候補として残し、採用finding件数から除外。

### 監査人5（完了）

- MAJOR-1 trace expireAt/idempotency/部分保存: **採用** → 統括M-7。
- MAJOR-2 fallback ID PII復元: **採用** → 統括M-8。
- MAJOR-3 legacy retrieval不能: **採用** → 統括M-9。
- MINOR-1 server discriminated schema欠落: **採用** → 統括m-1。

### 監査人6（部分監査）

- fallback ID PII候補: 当該報告単独では未確定だったが、統括で実関数再現し**採用** → M-8。
- expireAt retry候補: 当該報告単独では未確定だったが、統括で実関数とwrite順を再確認し**採用** → M-7。
- 監査人6はユーザー指示で追加調査を中止しており、完全な独立監査完了数には含めない。

### 監査人7（完了）

- 日本語hour-onlyに対するnon-zero minute: **採用** → 統括M-1。
- `3時間`→30分、2分野完全逆転、単一sleep→mealなどの除外: **その限定条件では採用**。ただし隣接する単位なし数値、3分野tail order、複数節cross-associationは統括M-1/M-3/M-4として確定。
- structural ID/privacyを安全として除外した判断: **反証**。fallback regexに適合する電話番号入りIDでraw復元を再現したためM-8。
- trace retryが収束するという判断: **反証**。production prepareを再実行するとexpireAtが変わりimmutable同値比較に失敗するためM-7。
- selectedDate変更: **比較元由来としてPR外分離**。安全と断定せず復旧Issue候補を残す。

## 実行したfocused検証

1. 指定Linux Node 22.23.0で、一時Vitest `leadAuditorTemporary.test.ts`を実行。
   - 結果: **1 file / 14 tests passed**。
   - 「期待する正しさ」ではなく、現実装の反例挙動をassertしたcounterexample harnessである。
   - 内訳: sleepのendpoint swap、non-zero minute、明示minute切捨て、複数節cross-association、meal短答棄却、単位なし3の二重解釈、priority partial/tail inversion、confirmed priority訂正棄却、rawText表示、一般1科目誤分類、trace expireAt差分、fallback ID PII復元、legacy ID拒否、無効discriminated schema受理。
2. 追加された`weeklyPlanningControllerApprovalFlow.integration.test.ts`を同じNode 22で単独実行。
   - 結果: **1 file / 1 test passed**（12:12実行時）。
   - testが実時計を参照するコード構造は残るため、夜間失敗報告への反証にはならない。統括時には失敗そのものを再現しなかったため運用残件へ分離した。
3. 7報告の存在/non-emptyを`wc -c`で確認。サイズは順に15,223 / 13,671 / 14,608 / 11,928 / 16,182 / 2,328 / 10,477 bytes。
4. `git diff --stat origin/main...HEAD`と`git diff --name-status origin/main...HEAD`を確認。35 files、3,076 insertions、115 deletions。主要findingについて現HEADと比較元diffを照合し、PR由来とPR外を分離した。
5. 全suite、build、lint、`git diff --check`は統括では実行していない。メイン最終検証待ち。`package.json`にlint scriptがないことは各監査報告と一致する。

一時Vitestは削除済みで、リポジトリ内に監査用fixtureを残していない。

## 最終git status

統括報告保存直前の`git status --short --branch`:

```text
## agent/fix-weekly-planning-trace-and-dialogue-final...origin/agent/fix-weekly-planning-trace-and-dialogue-final
```

未追跡・変更ファイルなし。一時テスト不存在。本体コード、Git index、commit、branch、remoteは変更していない。報告ファイルはリポジトリ外の`/tmp/studyplanner-pr68-final-audit/final-audit.md`に置く。

全体テスト/build/diff check/最終statusのゲート結果は、メインエージェントの最終検証待ちである。
