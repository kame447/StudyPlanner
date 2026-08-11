# PR #119 跨週 conversation/session 分離 七視点監査

Status: complete / no open BLOCKER or MAJOR
Date: 2026-08-11
Branch: `agent/weekly-planning-memory-estimation`
PR: #119
Implementation audit head: `c3b109746b7b472434557651fa60bb11b6465068`
Refactor baseline: `aae21f74d82618a41e19da70c0ccbe2d313cef14`

## 1. 監査対象

今回の変更は、表示中の週 `selectedDate` / `weekStartDate` と conversation/session identity が同一scopeとして扱われていた依存を解消するものである。

従来は概ね次の依存になっていた。

```text
selectedDate
→ weekStartDate
→ userId:weekStartDate storage scope
→ PlanningState replacement
→ controller/runtime session reset or restore
→ conversationId rotation
```

`PlanningState` には会話だけでなく `messages`、`intakeState`、`draftBlocks`、`previewCandidates`、`pendingTurn`、`pendingApproval` が同居しているため、単純に conversationId だけを跨週維持すると draft/preview/approval の所有境界を壊す危険があった。

今回の修正では、既存の flat `PlanningState` 互換性を維持しつつ、identity と week anchor の役割を分離した。

```text
ownerId + conversationId
→ conversation/runtime identity

selectedDate
→ selected weekStartDate
→ active planning/display anchor

pending turn / pending approval
→ 旧 anchor を保持して atomic commit
→ 完了後に新 anchor へ re-anchor
```

## 2. Test-first 実施結果

大きな変更前に以下の単体・結合契約を追加した。

- 同一 conversation が週Aから週Bへ re-anchor しても identity と Fact Graph を失わない
- 表示週を変えても messages と conversationId と request sequence を維持する
- 表示週変更で in-flight turn を stale 扱いしない
- 表示週変更で in-flight approval を中断・部分保存しない
- 別週表示から remount しても active conversation を復元する
- active checkpoint を週Aから週Bへ移動し、表示週Cからでも復元できる
- active-index の書込みだけ失敗しても残存 checkpoint から自己修復できる

実装前の test-only CI `31492024555` は、新規契約4件だけが意図どおり failure となり、既存1264件は pass した。これにより現行実装の week/session coupling を先に再現してから実装へ入った。

旧仕様を固定していた「週変更時にturn結果を破棄する」「週変更時にconversationIdをrotateする」2テストは、新規契約が通った後でのみ更新した。

## 3. 七視点監査

### 3.1 会話状態・UX・状態遷移

判定: GOOD

表示週の変更は会話開始/終了イベントではなくなった。同一 owner では conversationId と request sequence を維持し、messages / intake state も保持する。

`pendingTurn` / `pendingApproval` 中は week anchor の変更を遅延させ、進行中操作の atomicity を維持する。処理完了後に新しい表示週へ re-anchor するため、ユーザーの単なるカレンダー操作で会話結果が消えない。

### 3.2 Semantic runtime・Fact Graph ownership

判定: GOOD

Stable V5 runtime は conversationId を主 identity とし、同一 owner の week rebind を許可する。week anchor 変更時も committed Fact Graph をそのまま保持する回帰テストを追加した。

owner mismatch は従来どおり拒否する。staged Graph → controller commit → finalize の atomic handoff も変更していない。

### 3.3 State model・責務境界

判定: GOOD with NOTE

`set_week_anchor` を明示actionとして追加し、selectedDate による state 全置換を廃止した。controller も同一 owner の週変更では identity reset を行わない。

NOTE: `PlanningState` 自体は依然 flat で、conversation fields と draft/preview fields が同一型に存在する。今回の変更では既存互換性を優先し、物理的な `ConversationState` / `WeeklyArtifactState` 二分割までは行っていない。ただし、表示週を conversation identity として扱う制御依存は除去されており、現時点で correctness blocker ではない。

将来、複数週の独立した未承認artifactを同時保持する仕様を入れる場合は、その時点で artifact collection を週/target scope別に分離するのが適切である。

### 3.4 Preview・approval・中断耐性

判定: GOOD

監査で、過去に問題化していた「週移動中のapprovalが部分保存になる」経路を重点確認した。

結合テストで、approval開始後に表示週を変更しても以下を保証した。

- pendingApproval が維持される
- week anchor は approval 完了まで変更されない
- save は1回のみ
- draft が途中消失しない
- approval 完了後に新表示週へ re-anchor する

approval ledger、runtime-loss時の recompute_required、interruptible approval の既存テストも全てgreenである。

### 3.5 Persistence・reload・障害復旧

判定: GOOD after audit repair

per-owner の active session index を追加し、load時に現在表示している週ではなく active conversation checkpoint を優先するようにした。checkpoint が週Aから週Bへ移動した場合、同一conversationの旧A checkpointを削除する。

監査中に1件の実害ある部分失敗を発見した。

```text
1. 週B checkpoint保存成功
2. 旧週A checkpoint削除成功
3. active session index更新だけlocalStorage例外で失敗
4. indexがAを指したまま残る
```

初期実装ではこの状態からloadすると、B checkpointが存在するにもかかわらず初期stateへ落ちる可能性があった。

修正として、non-null active index が stale / missing / mismatched の場合は owner の残存checkpointをscanし、最新のactive stateを復元してindexを自己修復するようにした。localStorage failure injectionを用いた回帰テストを先に追加してから修正した。

明示reset後の tombstone (`weekStartDate: null`) は意図的にscanしないため、古いlegacy checkpointの復活も防いでいる。

### 3.6 Security・privacy・ownership

判定: GOOD with NOTE

owner-bound storage validation、draft authorizedUserId、runtime owner mismatch、user切替時のstate分離は維持されている。user A のstateを user B storageへコピーしない既存結合テストもgreenである。

NOTE: active conversation authority は現在もclient-localであり、複数tab間のserver-authoritative concurrencyまでは今回のscopeではない。今回の変更で新たに悪化させたものではないが、将来のcross-tab競合対策では別途version/CASまたはserver authorityが必要である。

### 3.7 Test strategy・architecture・CI

判定: GOOD

変更前のred gate、新規単体/結合テスト、既存full regression、architecture isolation gateを順に通した。

最終実装head `c3b109746b7b472434557651fa60bb11b6465068` の CI `31494810267` は以下すべてgreen。

- TypeScript: pass
- Test files: 257 passed / 257
- Tests: 1272 passed, 13 skipped, 5 todo
- Production build: pass
- `git diff --check origin/main...HEAD`: pass
- Stable V5 production isolation gate: pass

新規cross-week系では、conversation integration 4件、owned storage 2件、runtime/session scope 2件を含む。

## 4. 監査中に発見して修正した事項

### F1. 同一ownerの週移動でもweek-scoped persistenceを参照していた

Severity at discovery: MAJOR
Status: fixed

初期refactorではconversationIdを直接resetしなくなっていたが、session lifecycle が週移動先の persisted session を毎回restoreし、そのconversationIdが異なるとresetし得る経路が残っていた。

これではstorage write failureやstale checkpoint時に、表示週が再びconversation authorityへ戻る。

修正後は、同一ownerのlive week navigationではpersisted session lookupを行わない。owner transition時だけrestoreする。単体テストで `loadPersistedSession` / `hydrateRuntimeSession` が呼ばれないことを固定した。

### F2. active-index更新だけ失敗した場合に新checkpointを見失う

Severity at discovery: MAJOR
Status: fixed

上記3.5の部分失敗。failure injection testを追加し、stale indexからcheckpoint scanによるself-healを実装した。

## 5. 残存事項

Open BLOCKER: なし
Open MAJOR: なし

Non-blocking notes:

1. `PlanningState` の物理的な ConversationState / WeeklyArtifactState 分割は未実施。現在の仕様では制御依存を分離できているため、追加の大規模schema migrationは行わなかった。
2. cross-tab/server-authoritative concurrencyは別課題。単一client内のowner/conversation/week navigationの整合性は今回保証した。
3. build時のlarge chunk / static+dynamic import warningは既存警告であり、本変更によるfailureではない。

## 6. Merge gate

- [x] 大規模変更前に単体テスト追加
- [x] 大規模変更前に結合テスト追加
- [x] 新契約が旧実装でredになることを確認
- [x] 同一conversation跨週継続
- [x] Fact Graph跨週継続
- [x] request sequence継続
- [x] in-flight turn保護
- [x] in-flight approval保護
- [x] reload/remount復旧
- [x] persistence部分失敗self-heal
- [x] user ownership分離
- [x] approval既存回帰
- [x] architecture isolation gate
- [x] full tests
- [x] typecheck
- [x] production build
- [x] diff check

結論: 今回対象の selectedDate/weekStartDate と conversation/session identity の誤った結合は解消された。七視点監査で発見した2件も修正・回帰化済みで、監査対象範囲に open BLOCKER / MAJOR はない。
