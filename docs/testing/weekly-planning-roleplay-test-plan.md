# 週間計画対話 roleplay / contract test plan

Status: **v4 audit test specification**
最終更新: 2026-07-13
Parent: ../architecture/weekly-planning-dialogue-architecture-v4.md

golden text完全一致は要求しない。strict assertionはaction、factRef、field、state、stateRevision、requestId、turnId、proposal、correction、topic、option、preview、stale、fallback、call count、duplicate、accepted/rejected、diagnostics。自然文は敬体、簡潔、no re-ask、仮定/事実の区別、内部slot非表示、次入力の明確さ、入力無視なしをrubricで採点する。

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
| unapproved preview | `preview-da-001-0`、initially empty |
| active conversation ID | `conv-wp-da-001` |
| initial state revision | 41 |
| persistence | session-local; explicit UI approvalまでsaveなし |

### turn contract

各turnについて、user message、interpreter candidate、accepted/rejected candidate、state revision、accepted fact、pending proposal、active question、asked topic、scheduler/feasibility、dialogue action、factRefs、preview state、禁止挙動を記録する。

| turn | user message | expected contract |
| --- | --- | --- |
| 0 | 週間計画画面を開く | openingは最大1call。二重mount/空turn/history追加は禁止 |
| 1 | 「来週、英語の過去問と数学を進めたい。英語を優先したい」 | begin、英語/数学goal、priorityをaccepted。planning_periodだけをask。goal factRefsをacknowledge |
| 2 | 「火曜はバイトの後、帰宅10分して夕食にしたい」 | 火曜18〜22 job、帰宅buffer、dinner constraintを独立評価。job/buffer factsを保持。火曜をbusyとしてschedulerへ渡す |
| 3 | 「英語はどれくらいかかるか分からない」 | duration unknownと`PendingAssumptionProposalDraft`を返す。canonical proposal ID/status/revisionはAI禁止。sourceFactRefs必須 |
| 4 | coreがproposalをcanonicalize | `proposal-da-001`、conversation/turn/revision/status=pendingをdeterministic生成。previewはpending使用を明示しhard applyしない |
| 5a | 「その仮定で進めて」 | accept_assumption。proposal accepted、元goal保持、scheduler再計算。saveは禁止 |
| 5b | 分岐: 「その時間は長すぎる」 | reject_assumption。proposal rejected、元goalを壊さない。再活性化禁止 |
| 5c | 分岐: 「英語は90分で」 | modify。旧proposal superseded、新proposal pending。同turnの別訂正を独立評価 |
| 6 | 「計画期間は来週の月曜から日曜」 | explicit range accepted。planningRange fact、inferred rangeの上書き/reseed禁止。answered topicを再質問しない |
| 7 | feasibility不足を提示 | required/available/scheduled/unscheduledはdeterministic value。option IDもdeterministic発行。AI再計算禁止 |
| 8 | 「英語を優先して、数学は残った時間で」 | allowed optionだけaccepted。priority fact、unscheduled refs更新。任意optionの実行禁止 |
| 9 | previewを提示 | `offer_preview`、previewId/stateRevision一致、stale=false。save/approveは禁止 |
| 10 | 「火曜の英語を水曜夜に移して」 | correction envelope単位にvalidate。明確な訂正はaccepted、曖昧な別envelopeはreject/clarification可能。preview stale化し再計算 |
| 11 | stale previewに「このまま承認」 | dialogueからapproval禁止。stale preview保存拒否、stale fallback messageも表示しない |
| 12 | 再計算案をUIで明示承認 | item ledgerでsave。crash/partial retryをitem単位で扱い、別approvalOperationIdでも重複planなし |

5a/5b/5cは分岐fixtureであり同一runに同時適用しない。turn 10ではaccepted correctionとrejected correctionが同turnに共存できることをstrictに確認する。

### WP-DA-001 assertions

- conversationId、turnId、requestId、input/output stateRevisionが各envelopeで一致する。
- accepted facts、rejected commands、pending draft、canonical proposal、activeQuestion、askedTopicHistoryを別フィールドで保持する。
- answered済みtopicをrevision変更だけで再質問しない。
- interpreter failure、planner failure、stale/cancelledを別diagnosticにする。
- pending assumptionを使用したpreviewは表示上reviewableで、明示承認前にsaveしない。

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
5. 全量が可用時間へ収まらなければ、priority/defer/split optionsを提示し、強制配置しない。
6. atomic work unitでdraftを生成し、approval待ちにする。
7. 「今日のご飯は19時まで。風呂と寝る時間も考慮」でconstraintを追加し該当draftだけ再配置する。
8. previewをstale→再計算し、chat発話だけではapproval/saveしない。
9. UI明示approvalでitem ledgerを開始し、partial failure/retryを検証する。

## 3. P1〜P7 cases

| Case ID | Perspective | Setup/input | strict assertion | rubric | forbidden result | owning task | status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1-OPENING-001 | novice | StrictModeでopening mount | call≤1、空turnなし | 簡潔な案内 | opening loop | DA2 | queued |
| P1-DOUBLE-SUBMIT-001 | novice | button+keyboard同時submit | 1 turn/request | 二重送信を感じない | duplicate preview | DA2 | queued |
| P2-IME-001 | keyboard/IME | composition中Enter、multiline paste | composition中sendなし | 入力欠落なし | IME途中送信 | DA2 | queued |
| P3-STALE-REF-001 | hostile output | private/stale ref、unknown option | response全体reject | private情報非表示 | partial apply | DA1 | queued |
| P4-PARTIAL-SAVE-001 | integrity | 3block中2件save後crash | item ledger、未保存だけretry | 追跡可能 | duplicate plan | approval | queued |
| P5-CORRUPT-STORAGE-001 | migration | corrupt/unknown/other user/week | safe discard、no auto-run | 安全な再起動 | corrupt実行 | approval/DA2 | queued |
| P6-PLANNER-FAILURE-001 | fallback | accepted state後planner timeout | state保持、extra callなし | 次操作明確 | parser再実行 | DA1/DA2 | queued |
| P7-TRACE-001 | trace | WP-DA全turn | redacted IDs/revision/diagnostics | 追跡可能 | golden textだけpass | DA3c | queued |

P1/P2のEnter最終bindingはDA2決定前にstrictにしない。IME抑止、keyboard/button重複抑止、multiline、focus restore、Tab順はstrictである。

## 4. test layers

unitはschema、state transition、proposal/correction、fact registry、feasibility、ledger。contractはaction/topic/option/factRef、turn envelope、preview/revision、fallback。integrationはinterpreter→reducer→scheduler→snapshot→planner→rendererとexam/non-exam。property/fuzzはduplicate、revision、NaN/Infinity、bounds、cycle/self、untrusted strings、partial retry。real-modelはredacted fixture replayとrubricに限定する。

証跡はredacted JSONで保存し、raw prompt、secret、private IDを残さない。production code、test code、config、Git indexはこのdocs-only修正で変更しない。
