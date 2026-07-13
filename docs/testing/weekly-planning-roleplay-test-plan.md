# 週間計画対話 roleplay / contract test plan

Status: **v4 audit test specification**
最終更新: 2026-07-14
Parent: [weekly-planning-dialogue-architecture-v4.md](../architecture/weekly-planning-dialogue-architecture-v4.md)
Product spec: [weekly-planning-spec.md](../weekly-planning/weekly-planning-spec.md)

golden text完全一致は要求しない。strict assertionはaction、responseParts、derived used refs/topics/options、field/formatter、state、stateRevision、requestId、turnId、proposal、correction、preview、stale、fallback、call count、duplicate、accepted/rejected、diagnosticsを対象とする。自然文は敬体、簡潔、no re-ask、仮定/事実の区別、内部slot非表示、次入力の明確さ、入力無視なしをrubricで採点する。

## 1. WP-DA-001: non-exam weekly dialogue

### 初期fixture

| field | value |
| --- | --- |
| selected date | 2026-07-12 |
| planning target week | 2026-07-13〜2026-07-19 |
| fixed part-time job | 2026-07-14（火）18:00〜22:00 |
| fixed class | 2026-07-16（木）10:00〜12:00 |
| existing plans | 水曜09:00〜10:30「ゼミ」、土曜13:00〜14:00「通院」 |
| timetable | 木曜10:00〜12:00「授業」、金曜09:00〜10:30「授業」 |
| unapproved preview | preview-da-001-0、initially empty |
| active conversation ID | conv-wp-da-001 |
| initial state revision | 41 |
| persistence | session-local、explicit UI approvalまでsaveなし |

### turn contract

各turnでuser input/action、interpreter candidate、accepted/rejected candidate、state revision、accepted fact、proposal record、active question、asked topic、scheduler/feasibility、dialogue action、responseParts、derived used refs、preview state、禁止挙動を記録する。

| turn | user input / action | expected strict contract |
| --- | --- | --- |
| 0 | 週間計画画面を開く | openingは最大1 call。二重mount、空turn、重複historyは禁止 |
| 1 | 「来週、英語の過去問と数学を進めたい。英語を優先したい」 | selected dateからplanning range 2026-07-13〜2026-07-19をdeterministicに一意解決してaccepted。英語・数学goalと英語priorityもaccepted。planning periodを再質問せず、次の未確認topicである英語の所要時間だけをask。no-reaskを満たす |
| 2 | 「火曜はバイトの後、帰宅10分して夕食にしたい」 | 火曜18〜22 job、帰宅buffer、dinner constraintを独立評価。job/buffer factsを保持しbusy intervalへ渡す。turn 1のaccepted range/goals/priorityを失わない |
| 3 | 「英語はどれくらいかかるか分からない」 | AIはduration unknownとPendingAssumptionProposalDraftだけを返す。sourceFactRefs必須。proposalId、conversationId、turnId、revision、status生成は禁止 |
| 4 | deterministic coreがdraftをcanonicalize | AssumptionProposalRecord proposal-da-001をstatus=pendingで生成し、PendingAssumptionProposalとしてsession-local保持。draftとrecordを別証跡に残す。DA0 adapterへproposalRefを渡せることだけを検証し、まだpreviewを生成しない |
| 5a | 分岐: 「その仮定で進めて」 | accept_assumption variant。proposalId、expectedStateRevision、confidence、sourceTextのみ。replacementValue禁止。recordはaccepted、元goal保持、preview/saveは禁止 |
| 5b | 分岐: 「その時間は長すぎる」 | reject_assumption variant。replacementValue禁止。recordはrejected、元goalを壊さず、同recordの暗黙再活性化禁止 |
| 5c | 分岐: 「英語は90分で」 | modify_assumption variant。replacementValue必須。旧recordをsuperseded、新recordをpendingにし、supersededByProposalIdで接続。同turnの別commandを独立評価 |
| 6 | 「やっぱり日曜までではなく、水曜までにしたい」 | planning range correction envelopeを生成。old rangeをsuperseded、新しいend date 2026-07-15をaccepted。previewをstale化しscheduler/feasibilityを再計算。他のgoal、priority、全proposal recordを失わない |
| 7 | feasibility不足を提示 | required/available/scheduled/unscheduledはdeterministic value。option IDもdeterministic発行。AI再計算、AI free text内の数値説明は禁止 |
| 8 | 「英語を優先して、数学は残った時間で」 | allow-list内optionだけaccepted。priority factとunscheduled refsを更新。任意optionの実行は禁止 |
| 9 | previewを提示 | DA0で初めてpending proposal付きwork itemからpreview生成。offer_preview、previewId/stateRevision一致、stale=false、pending assumption markerあり。save/approveは禁止 |
| 10 | 「数学は外して。英語は90分ではなく60分にして。夜の分も動かして」 | remove envelopeはtarget={kind:"task", taskRef:"task-math"}でreplacement禁止。replace envelopeはtarget={kind:"task", taskRef:"task-english"}とvalidator accepted済みset_study_goal replacementを持つ。曖昧な「夜の分」は一意targetを作らずそのenvelopeだけreject/clarification。acceptedとrejectedが同turnに共存し、previewをstale化 |
| 11 | 条件変更前previewの承認ボタンを押す | StalePreviewApprovalAttempt。saveとapproval operation開始を拒否し、現在条件と一致せず再計算または最新案確認が必要というdeterministic responseを表示。AI callなし。silent discardにしない |
| 12 | 再計算後の最新案をUIで明示承認 | userId + sourceDraftBlockIdをkeyにitem ledgerでsave。crash/partial retryをitem単位で扱い、別approvalOperationIdでも重複planなし |

5a/5b/5cは分岐fixtureであり同一runに同時適用しない。turns 6〜12のmainlineは5cを選び、新しいpending proposalを保持する。5a/5bは独立runでpreview eligibilityの差も検証する。turn 10の各CorrectionEnvelopeはatomic、Envelope間は独立評価する。

### WP-DA-001 assertions

- conversationId、turnId、requestId、input/output stateRevisionが各envelopeで一致する。
- accepted facts、rejected commands、proposal draft、AssumptionProposalRecord履歴、PendingAssumptionProposal view、activeQuestion、askedTopicHistoryを別フィールドで保持する。
- answered済みtopicをrevision変更だけで再質問しない。
- responsePartsだけをAI出力の使用fact/topic/optionの正とし、usedFactRefs、usedQuestionTopicIds、usedOptionIdsはcoreが導出する。
- interpreter failure、planner failure、StaleAsyncResult、StalePreviewApprovalAttemptを別categoryにする。
- pending assumptionを使用したpreviewはreviewableで、明示承認前にsaveしない。

## 2. WP-RP-001: 院試週末計画 regression

v4通常対話のcurrent UXを規定するものではなく、既存exam/domain/scheduler regressionとして維持する。

### fixture

- 期間: 2026-07-18（土）〜2026-07-19（日）
- 5分野: 数学・数理系、ハードウェア、ソフトウェア、OS、ネットワーク
- 量: 各分野7年分、合計35 year-field units
- 進捗: 数理系2021年まで完了、OS2020年まで完了、他は未着手。未指定の年度範囲や完了方向を推定しない
- 固定予定: 土曜09:00〜10:00移動、土曜18:00〜19:30食事、日曜15:00〜16:00家族予定
- 生活制約: 睡眠01:00〜08:00、食事各60分、風呂22:30〜23:00
- unit duration: 1 year-field chunk=120分
- priority: 数理系→ソフトウェア→OS→ハードウェア→ネットワーク
- draft生成後はapproval待ち。後出し修正は未承認draftだけを再配置し、approved planは直接変更しない

### steps

1. 期間、5分野、7年分、進捗、年度範囲、unit durationを段階的に受理する。
2. remaining unitsからrequired minutesを計算し、既完了分を二重計上しない。
3. priority orderを保持する。
4. fixed schedule、睡眠、食事、風呂をbusy intervalとして除外する。
5. 全量が可用時間へ収まらなければpriority/defer/split optionsを提示し、強制配置しない。
6. atomic work unitでdraftを生成しapproval待ちにする。
7. 後出しconstraintで該当draftだけ再配置する。
8. previewをstale→再計算し、chat発話だけではapproval/saveしない。
9. UI明示approvalでitem ledgerを開始し、partial failure/retryを検証する。

## 3. P1〜P7 cases

| Case ID | Perspective | Setup/input | strict assertion | rubric | forbidden result | owning task | status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1-OPENING-001 | P1 novice | StrictModeでopening mount | call≤1、空turnなし | 簡潔な案内 | opening loop | DA2 | queued |
| P1-DOUBLE-SUBMIT-001 | P1 novice | button+keyboard同時submit | 1 turn、1 request | 二重送信を感じない | duplicate preview | DA2 | queued |
| P1-RESET-STALE-001 | P1 novice | active request中にreset/history clear後、旧response到着 | StaleAsyncResultとしてsilent discard、retryは新requestのみ | reset後の状態が明確 | history/status/fallbackへの旧結果反映 | DA2 | queued |
| P2-IME-001 | P2 keyboard/IME | composition中Enter、multiline paste | composition中sendなし | 入力欠落なし | IME途中送信 | DA2 | queued |
| P2-KEYBOARD-FOCUS-001 | P2 accessibility | button/keyboard、multiline、送信後focus、Tab巡回 | 決定済みbinding一系統、focus restore、論理的Tab順 | 誤送信なく操作可能 | binding二重発火、focus loss | DA2 | queued |
| P3-STALE-REF-001 | P3 hostile output | private/stale ref、unknown option/formatter | response全体reject | private情報非表示 | partial render/apply | DA1 | queued |
| P3-CORRECTION-TARGET-001 | P3 hostile output | 空target、複数target、unknown/private target | union外shape reject、元fact不変、別Envelope独立 | clarificationが対象を明示 | arbitrary target選択 | DA1b | queued |
| P3-ASSUMPTION-DECISION-001 | P3 hostile output | accept/rejectにreplacement、modify値なし、unknown/non-pending ID | discriminated union/schema reject、別decision保持 | 仮定状態が明確 | hidden resurrection、全command破棄 | DA1b | queued |
| P3-RESPONSE-DUPLICATE-SOURCE-001 | P3 hostile output | responsePartsに加えfactRefs/questionTopicsを出力 | 余剰二重sourceをschema reject、used refsはpartsからのみ導出 | 応答は一貫 | AI申告の片方を採用 | DA1 | queued |
| P3-TEXT-FACT-LEAK-001 | P3 hostile output | text partに日時、分数、件数、snapshot title | response全体reject、fact partへ分解したfixtureだけpass | 自然な接続文 | free text事実値の表示 | DA1、DA3c | queued |
| P6-RANGE-RESOLUTION-001 | P6 regression | selected date 2026-07-12、input「来週」 | 2026-07-13〜19へ一意解決、再質問なし | 次の未確認topicへ進む | planning period再質問 | DA0 | blocked — Gate P4とDA0a後 |
| P3-RANGE-AMBIGUOUS-001 | P3 ambiguity | input「その辺の週」 | 一意解決せずclarification、range未変更 | 一問だけ明確に聞く | arbitrary week推定 | DA1、DA2 | queued |
| P6-STALE-ASYNC-DISCARD-001 | P6 fallback | request/turn/conversation/revision mismatch、cancel/reset/unmount | state/history/status/previewへ反映なし、fallbackなし | 画面を乱さない | stale failure message | DA2 | queued |
| P4-STALE-PREVIEW-REJECT-001 | P4 integrity | stale=trueまたはpreviewStateRevision不一致でUI承認 | save拒否、deterministic案内、AI call/operation開始なし | 再計算手順が分かる | silent discard、保存開始 | approval | queued |
| P4-PARTIAL-SAVE-001 | P4 integrity | 3 block中2件save後crash | item ledger、未保存だけretry | 追跡可能 | duplicate plan | approval | queued |
| P5-CORRUPT-STORAGE-001 | P5 migration | corrupt/unknown/other user/week ledger | safe discard、no auto-run | 安全な再起動 | corrupt operation実行 | approval、DA2 | queued |
| P6-PLANNER-FAILURE-001 | P6 fallback | accepted state後planner timeout | state保持、deterministic renderer、extra callなし | 次操作明確 | semantic parser再実行 | DA1、DA2 | queued |
| P7-TRACE-001 | P7 trace | WP-DA全turnのredacted record | IDs/revision/diagnosticsを追跡 | 監査可能 | golden textだけでpass | DA3c | queued |
| P7-REQUIREMENT-MATRIX-001 | P7 trace | 下記Requirement tableをlint/contract検査 | 必須15 IDが各1行、owner/status/task IDsと同期 | 欠落を発見しやすい | duplicate/missing/stale status | DA3c | queued |

### P1/P2 ownership contract

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Applicable | DA2 | opening、submit、reset、stale、retry |
| P2 | Applicable | DA2 | IME、keyboard、multiline、focus、Tab |

Enter最終bindingはDA2実装時に決定する。決定前は特定キー割当をstrictにせず、IME抑止、button/keyboard重複抑止、multiline、focus restore、Tab順をstrictにする。

## 4. P7 Requirement ID traceability

この表がRequirement ID単位のcanonical traceabilityである。P1〜P7 case表とは別に管理し、各IDを一行だけ持つ。

| Requirement ID | primary spec | v4 section | owning task | test layer | strict assertion / rubric | current status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DA-GOAL-001 | spec §5–6 | v4 §3、§9 | Gate P4、DA3b、DA3c | integration、roleplay、rubric | goal受理、no re-ask、next unresolved topic、mentor dialogue rubric | Gate P4 active verification gate、DA3b/DA3c queued | superseded Stage3はhistorical evidenceのみ |
| DA-SAFE-001 | spec §12–13 | v4 §1、§7 | DA1、approval、DA2 | contract、integration | AI state/save/repository action禁止、explicit UI approval | queued | 全task共通不変条件 |
| DA-INTERPRET-001 | spec §12 | v4 §1–3、§6 | Gate P4、DA0a、DA0 | unit、contract、integration | single interpreter、typed candidate、relative range、一件独立評価 | Gate P4 active verification gate、DA0a/DA0 blocked | rules/AI merge禁止 |
| DA-ACTION-001 | spec §12–13 | v4 §4 | DA1、DA2 | schema、contract | finite action、allow-list、invalid全体reject | queued | used refsはcore導出 |
| DA-TURN-001 | spec §13 | v4 §6、§8 | DA2 | contract、race integration | request/turn/conversation/revision一致、StaleAsyncResult silent discard | queued | P1/P2 Applicable |
| DA-ASSUMPTION-001 | spec §5–6、§13 | v4 §2、§5 | DA0a、DA1b | unit、contract、roleplay | draft/record/pending分離、lifecycle履歴、decision union | DA0a blocked、DA1b queued | preview生成はDA0 |
| DA-CORRECTION-001 | spec §10–11 | v4 §5 | DA1b | schema、contract、integration | target union、typed replacement、Envelope atomic、turn内独立 | queued | rejected correctionは元fact不変 |
| DA-RESPONSE-001 | spec §12–13 | v4 §4 | DA1 | schema、contract、fuzz | structured fact rendering、二重source禁止、free text grounding、finite formatter | queued | 制限緩和はDA3c後 |
| DA-PREVIEW-001 | spec §10、§13 | v4 §3、§6–7 | DA0、DA1b、approval | integration、contract | previewId/revision/stale、pending marker、stale approval拒否 | DA0 blocked、DA1b/approval queued | DA0aはpreview非所有 |
| DA-RELATIVE-001 | spec §4、§9 | v4 §6 | DA3a | unit、property、integration | typed anchor、revision、cycle/self拒否、deterministic resolve | queued | complex recurrence対象外 |
| DA-FEASIBILITY-001 | spec §3、§6、§9 | v4 §3–4 | DA3b | unit、property、roleplay | required/available/scheduled/unscheduled、deterministic options | queued | AI再計算禁止 |
| DA-PERSISTENCE-001 | spec §10–11 | v4 §6–7 | approval、DA2 | migration、integration | session-local会話、versioned ledger、no auto-run | queued | profile保存は別判断 |
| DA-IDEMPOTENCY-001 | spec §10 | v4 §7 | approval | unit、repository integration、property | userId + sourceDraftBlockId、item ledger、crash/retry | queued | operation IDはkeyでない |
| DA-FALLBACK-001 | spec §12–13 | v4 §6 | Gate P4、DA0、DA1、DA2 | contract、failure injection | interpreter/planner/stale分離、no extra call、no rules/AI merge | Gate P4 active verification gate、DA0 blocked、DA1/DA2 queued | stale previewはfallbackでない |
| DA-EVAL-001 | spec §5–6、§13 | v4 §9 | DA3c | full roleplay、metrics、real-model rubric | 必須ID全件、strict/rubric分離、redaction、会話品質 | queued | P7-REQUIREMENT-MATRIX-001で検査 |

## 5. test layers

unitはschema、state transition、proposal/correction、fact/formatter registry、text validator、feasibility、ledger。contractはaction/topic/option/factRef、derived used refs、turn envelope、preview/revision、fallback。integrationはinterpreter→reducer→scheduler→snapshot→planner→validator→rendererとexam/non-exam。property/fuzzはduplicate、revision、NaN/Infinity、bounds、cycle/self、untrusted strings、partial retry。real-modelはredacted fixture replayとrubricに限定する。

証跡はredacted JSONで保存し、raw prompt、secret、private IDを残さない。production code、test code、config、Git indexはこのdocs-only修正で変更しない。
