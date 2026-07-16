# PR5 再レビュー指摘を修正する

Status: in_progress
Created: 2026-07-16

## 目的

PR #5 の head `068e728` に対する再レビューを実装とテストに照らして検証し、妥当な指摘を重要度順に解消する。非同期turn、storage境界、reducer不変条件を曖昧なUI都合ではなくsession contractとして固定する。

## 検証結果

再レビューの B1、M1、M2、M3、N1、N2、N3 はすべて妥当である。

- B1: preview候補がcomponent-local stateだけに存在し、modal unmount後のPromise完了結果をsessionへ保持できない。
- M1: storage validatorがPlanningIntakeStateとWeeklyPlanDraftBlockのnested union、配列要素、optional object、metadataを閉じて検証していない。
- M2: save時だけ除外しているassumptionProposalRecordsをload時に除外せず、外部投入値をin-memory sessionへ再注入できる。
- M3: property testがrequestId、weekStartDate、baseRevisionの不一致を独立に生成せず、pending中のnon-load actionとrevision契約も十分に固定していない。
- N1: range開始前日に始まりrange内まで継続する予定がoccurrence展開対象へ入らない。
- N2: domain stateではdurationDays必須だが、AI command schema/runtimeでは任意であり、型契約が実際のcanonicalization経路を表していない。
- N3:責務別testとcatch-all review testに同一契約の重複がある。

## 確定方針

### 1. previewをsession ownerへ移す

`commit_turn`はintake state、assistant message、preview候補を同一mutationで原子的に保存する。preview候補はPlanningStateへ保持し、localStorageにも保存してmodal再mount時に復元する。NaturalLanguageAssistantはpreview候補のownerにならず、session stateを表示・編集するcontrollerとして扱う。

previewの個別削除、全破棄、draft昇格、session resetはreducer actionでsession stateを更新する。pending turn中にmodalを閉じる操作自体は許可し、完了結果を失わないことをcontractとする。単に閉じる操作を禁止する暫定策は採用しない。

### 2. storage境界を閉じたvalidatorとsanitizerへ統一する

PlanningIntakeStateの各union、nested object、配列要素、optional fieldを明示的に検証する。WeeklyPlanDraftBlockはPlanType、日時文字列、status/source、optional material fields、behaviorMetadataとpreviewMetadataを検証する。

current v2 envelopeとlegacy migrationの双方を同じsanitize関数へ通す。不正データは部分採用せずsession全体を初期化する。session-local fieldであるpendingTurn、pendingApproval、assumptionProposalRecordsはload結果から必ず除去する。

### 3. reducer property contractを全actionへ拡張する

stale identityはrequestId、weekStartDate、baseRevisionをそれぞれ独立に一致・不一致化する。pending turn中とpending approval中は、許可された完了・失敗・cancel/load以外の全non-load actionが同一参照を返すことを検証する。

通常mutationについて、受理されたactionはrevisionが正確に1増え、拒否されたactionは同一参照を返す契約を固定する。

### 4. fixed-event occurrenceの展開範囲を前日へ広げる

planの時刻表現では日跨ぎは最大で翌日終了のため、occurrence展開開始日をrange開始日の1日前へ広げる。最後に既存の厳密なdatetime overlapで絞り込む。

### 5. AI command payloadとdomain stateの型を分離する

PendingPlanningRangeClarificationはdomain stateとしてdurationDays必須を維持する。SetPendingPlanningRangeCommandのAI入力payloadだけdurationDaysをoptionalにし、adapterで必須domain stateへ正規化する。schema/runtime/typeの三者を一致させる。

### 6. 重複testを責務別fileへ集約する

scope enrichmentとsingle-field priorityの詳細contractは責務別testへ残す。ReviewCoreFixesは複数境界を横断する最小限の統合ケースだけに縮小する。

## 修正順序

1. B1 preview lifecycle
2. M1・M2 storage validation/sanitization
3. M3 property-based tests
4. N1 fixed-event overlap
5. N2 durationDays type contract
6. N3 test duplication
7. focused tests、full suite、build

## 完了条件

- modalをpending中に閉じ、turn完了後に開き直してpreviewと昇格操作を復元できる。
- malformed intake/draftをsession全体として拒否する。
- assumptionProposalRecordsがv2/legacy双方のload結果へ残らない。
- identity各要素とpending中の全mutation guardをproperty testで固定する。
- 前日開始の単発・繰り返し予定をfixed eventとして抽出する。
- durationDaysのschema/runtime/typeが一致する。
- focused tests、full suite、production buildが成功する。
