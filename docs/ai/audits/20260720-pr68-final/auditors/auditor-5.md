# StudyPlanner PR #68 独立最終監査 5（trace / API / Firestore / privacy）

## 監査対象

- 対象 branch: `agent/fix-weekly-planning-trace-and-dialogue-final`
- 対象 HEAD: `23d7676370b3efebc8d1465dfd01abc32c6462ca`
- 比較元: `origin/main`
- 監査種別: 採用前・読み取り専用の独立監査
- 開始時状態: `git status -sb` は branch 表示のみで clean、HEAD は指定値と一致
- 他監査報告・過去の無効監査出力は読まず、列挙もしていない

## 担当領域

trace の生成/schema、API validation、session / logical conversation / entry ID、sequence、entryCount、owner/authentication、privacy/redaction、Firestore document path、immutable create、atomicity、idempotency、競合・同時 request、legacy compatibility、bounded query、admin retrieval を担当した。検証はテスト名やPR本文を根拠にせず、実コードの制御フローと永続化結果を起点に行った。

## 調査した主要ファイル

- `src/features/weeklyPlanning/trace/weeklyPlanningTraceRuntime.ts`
- `src/features/weeklyPlanning/trace/weeklyPlanningTraceTypes.ts`
- `src/features/weeklyPlanning/trace/weeklyPlanningTracePrivacyClient.ts`
- `src/features/weeklyPlanning/trace/weeklyPlanningTraceRemoteRepository.ts`
- `src/features/weeklyPlanning/trace/weeklyPlanningTraceRepository.ts`
- `src/features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository.ts`
- `workers/ai-proxy/src/worker.ts`
- `workers/ai-proxy/src/weeklyPlanningTraceApi.ts`
- `workers/ai-proxy/src/weeklyPlanningTracePrivacy.ts`
- `workers/ai-proxy/src/weeklyPlanningTraceFirestore.ts`
- `workers/ai-proxy/src/weeklyPlanningTracePrivacy.test.ts`
- `workers/ai-proxy/src/weeklyPlanningTraceStructuralIds.test.ts`
- `workers/ai-proxy/src/weeklyPlanningTraceFirestore.integration.test.ts`
- `workers/ai-proxy/src/weeklyPlanningTraceAdmin.integration.test.ts`
- `firestore.rules`
- 比較のための `origin/main` 上の `weeklyPlanningTraceApi.ts` / `weeklyPlanningTracePrivacy.ts`

## 追跡した制御フローと確認結果

1. `weeklyPlanningTraceRuntime.ts` の `randomId` / `createSession` / `commonEntry` が conversation、session、entry ID と sequence を生成し、`appendBestEffort` が session summary と entry batch を repository へ渡す。
2. production の `weeklyPlanningTraceRemoteRepository.ts:93-96` は session と entries をそのまま authenticated API client へ渡す。
3. `weeklyPlanningTracePrivacyClient.ts:36-64,101-105` は Firebase ID token を Bearer token として `/weekly-planning-trace/append` へ送る。
4. `worker.ts:64-121,124-145` は Firebase Identity Toolkit で token を検証し、verified Firebase uid だけを trace API へ渡す。Origin 制御だけに認証を依存していない。
5. `weeklyPlanningTraceApi.ts:217-273` は policy acceptance と HMAC subject を確認し、`prepareWeeklyPlanningTraceWrite` 後に session owner/conversation conflict を確認する。
6. `weeklyPlanningTracePrivacy.ts:308-379` は structural ID、entryCount、sequence、entry/session/conversation の対応を検証し、recursive redaction 後に structural ID を復元する。
7. `weeklyPlanningTraceApi.ts:238-267` と `weeklyPlanningTraceFirestore.ts:248-320` は session reservation、entry の immutable create、session metadata PATCH、entryCount maximum transform の順で保存する。
8. admin は worker 認証に加え `admins/{uid}.enabled == true && weeklyPlanningTraceReader == true` を要求し、session/entryを最大500件で取得する。Firestore rules は trace collection の client direct read/write と admin document の client write を拒否している。
9. `entryCount` 単独は Firestore maximum transform により後退しないことを確認した。ただし、その transform は entry batch や session metadata と同一commitではなく、下記 MAJOR-1 の部分保存を防がない。

## 実行テスト / 最小再現

### 既存 focused tests

Node 22.23.0 を明示して次を実行した。

```text
/home/kame/.nvm/versions/node/v22.23.0/bin/node ./node_modules/vitest/vitest.mjs --config vite.config.mjs run \
  workers/ai-proxy/src/weeklyPlanningTracePrivacy.test.ts \
  workers/ai-proxy/src/weeklyPlanningTraceStructuralIds.test.ts \
  workers/ai-proxy/src/weeklyPlanningTraceFirestore.integration.test.ts \
  workers/ai-proxy/src/weeklyPlanningTraceAdmin.integration.test.ts
```

結果: 4 files / 14 tests passed。

### 監査用一時最小再現

production 関数だけを直接使う一時 Vitest を作成し、次の3反例を実行した。

1. 同一 client payload を `t` と `t+1秒` で `prepareWeeklyPlanningTraceWrite` し、最初の document が既に存在する状態で後者を `setImmutableDocument` へ渡すと `immutable trace document conflict` になる。
2. `weekly-trace-09012345678-abcdef` と `weekly-conversation-08012345678-ghijkl` は structural validator を通過し、prepare後・admin safe出力の双方に電話番号が復元される。
3. 旧実装のredactionが生成する実document handle `weekly-trace-[UUID]` は現行 `isWeeklyPlanningTraceSessionId` で false になる。

結果: 1 file / 3 tests passed（3件とも反例を再現）。一時テストは実行直後に削除し、削除後 `git status -sb` が clean であることを確認した。

最初の実行はWSL既定Node 12.22.9が `node:fs/promises` 非対応のためテスト起動前に失敗した。Windows Node 20 はLinux用node_modulesにWindows Rollup optional binaryがなく起動前に失敗した。そのため既存のLinux Node 22.23.0を明示して再実行した。Firestore Emulator / 実Firestoreは使用せず、production serializer・validator・Firestore REST clientに対する決定論的fetch harnessと静的制御フローで確認した。

## BLOCKER

なし。

## MAJOR

### MAJOR-1: 同一payloadのretryがidempotentでなく、batch途中失敗を永久的な部分保存にする

- 場所:
  - `workers/ai-proxy/src/weeklyPlanningTraceApi.ts:258-267` (`handleAppend`)
  - `workers/ai-proxy/src/weeklyPlanningTracePrivacy.ts:289-305,326-379` (`preparedDocument`, `prepareWeeklyPlanningTraceWrite`)
  - `workers/ai-proxy/src/weeklyPlanningTraceFirestore.ts:248-288,291-320` (`setDocumentWithMaximumInteger`, `setImmutableDocument`)
- 再現条件: 2件以上のentryを含むappendで先行entry createが成功し、後続entryまたはsession PATCH/maximum transformが失敗する。その後、まったく同じHTTP payloadを再送する。通常の完全成功後に同じpayloadを再送するだけでも再現する。
- 現在の挙動: entryは `for` loopで1件ずつcreateされ、session更新は全entryの後で、metadata PATCHとmaximum transformも別requestである。先行entryだけが残り得る。再送時はserverが `expireAt = retry時刻 + 180日` を再生成するため、既存entryと同じclient payloadでもdocument内容が変わる。immutable createの409後比較が差分を検出して409を返し、未保存の後続entryへ進めない。
- 期待挙動: 同一payloadのretryは既存entryを同一と認識して成功扱いし、途中失敗を再開できること。APIが失敗を返すなら、entry群とsession summaryが永続的な部分状態を残さないこと。
- 影響: journalにentryだけ存在してentryCountが更新されない、またはsession metadataだけ更新される部分状態が残り、通常retryでは回復不能になる。traceはbest-effortでも、append-only・immutable・idempotentという当該保存契約を満たさず、障害時に最も必要な診断系列が欠落する。
- 原因: entry batch、session metadata、entryCountを一つのconditional commitにせず、さらにimmutable比較対象のserver生成 `expireAt` をrequestごとに変えている。
- 既存テストが未検出の理由: `weeklyPlanningTraceFirestore.integration.test.ts:42-84` は同じ固定 `value` objectを2回渡しており、API prepareでserver時刻が再生成される実経路を通らない。複数entry途中失敗やPATCH/transform失敗後のHTTP replayも試していない。
- 重要度理由: 明記されたimmutable/idempotency/atomicity契約を通常の通信retryで破り、永続データを回復不能な部分状態にするためMAJOR。

### MAJOR-2: fallback形式のstructural IDへ電話番号を埋め込むとredaction後に危険値が復元される

- 場所:
  - `workers/ai-proxy/src/weeklyPlanningTracePrivacy.ts:222-228` (`FALLBACK_RANDOM_SUFFIX`, ID patterns)
  - `workers/ai-proxy/src/weeklyPlanningTracePrivacy.ts:327-376` (`prepareWeeklyPlanningTraceWrite` のstructural field復元)
  - `workers/ai-proxy/src/weeklyPlanningTraceApi.ts:119-147` (`safeWeeklyPlanningTraceDocumentsForAdmin`)
- 再現条件: verified userが `weekly-trace-09012345678-abcdef` のように、許可prefix + 10〜16桁数字 + 6〜16桁英数字のIDをappend APIへ送る。conversation IDも同形式で偽装できる。
- 現在の挙動: fallback validatorはこれを正規IDとして受理する。recursive redaction自体は `09012345678` を `[PHONE]` にするが、prepareとadmin safe処理が「safe structural value」と判断して元のraw IDを再代入する。そのままFirestore path/fieldへ保存され、admin responseにもraw電話番号が出る。
- 期待挙動: redaction後に危険値を含むstructural fieldを復元しないこと。fallback IDを許可するなら、serverが生成可能なtimestamp範囲・形式まで検証するか、raw値自身がPII detectorに該当しないことを確認すること。
- 影響: 任意のverified userが会話contentではmaskされる第三者の電話番号をstructural ID経由で180日保存し、管理者画面へ露出できる。認証済みであってもprivacy境界の回避になる。
- 原因: runtime fallbackの形だけを正規表現で信頼し、redaction安全性を確認せずstructural IDを後から無条件復元している。
- 既存テストが未検出の理由: `weeklyPlanningTraceStructuralIds.test.ts:33-47,58-63` はprefixに合わない `john-smith-09012345678` だけを拒否例にし、正規表現に適合する電話番号入りfallback IDを試していない。
- 重要度理由: 明示されたprivacy/redaction境界を認証user入力で直接迂回し、永続化・admin disclosureまで到達するためMAJOR。

### MAJOR-3: 現行legacy fallbackは直前実装が実際に保存したredacted document IDへ到達できない

- 場所:
  - `workers/ai-proxy/src/weeklyPlanningTraceApi.ts:323-357` (`handleAdminEntries`)
  - `workers/ai-proxy/src/weeklyPlanningTracePrivacy.ts:222-250` (現行structural ID validation)
  - `origin/main` の `workers/ai-proxy/src/weeklyPlanningTracePrivacy.ts` (`prepareWeeklyPlanningTraceWrite`)
  - `origin/main` の `workers/ai-proxy/src/weeklyPlanningTraceApi.ts` (`handleAppend`)
- 再現条件: `origin/main` のserverへUUID形式sessionを保存し、そのdocumentをこのHEADのadmin sessions一覧から選択してentriesを取得する。
- 現在の挙動: `origin/main` はstructural IDもredactionした後の `prepared.session.id` / `prepared.entries[].id` をFirestore document IDとして使用する。通常UUID sessionの実pathは `weekly-trace-[UUID]` となる。現行admin sessions一覧はFirestore path由来のそのIDを返すが、entries endpointはtarget取得より前の `isWeeklyPlanningTraceSessionId` で400にするため、`storageLayoutVersion !== 1` 用のlegacy読取分岐へ一度も到達しない。新clientのraw ID appendは別pathを作るため、旧entryと新entryも分断される。
- 期待挙動: 対応対象とする旧layoutの実path handleを安全に識別して取得するか、migration/index mappingを用意し、一覧に表示したlegacy sessionは同じadmin APIでentry取得できること。
- 影響: PR直前のserverが保存したtrace sessionが一覧には出ても開けず、過去journalの診断・回帰調査ができない。追加appendは別sessionへ分岐し、会話系列が分割される。
- 原因: legacy fallbackを追加した一方、その前段へ新ID専用validatorを置き、旧実装が生成したredacted path形式をmigration対象に含めていない。
- 既存テストが未検出の理由: admin integration testは `storageLayoutVersion: 1` とraw UUID IDだけを使う。`storageLayoutVersion` のlegacy分岐を通すテストも、`weekly-trace-[UUID]` という実旧handleのテストもない。
- 重要度理由: legacy compatibilityとadmin retrievalの中核契約を、実際の直前永続化形式に対して全面的に失うためMAJOR。

## MINOR

### MINOR-1: server write境界がtrace discriminated schemaを検証せず、structural fieldsだけで任意documentを受理する

- 場所:
  - `workers/ai-proxy/src/weeklyPlanningTracePrivacy.ts:308-379` (`prepareWeeklyPlanningTraceWrite`)
  - `src/features/weeklyPlanning/trace/weeklyPlanningTraceTypes.ts:188-238` (`isWeeklyPlanningTraceEntry`、server入口では未使用)
- 再現条件: validなsession/conversation/entry ID、entryCount、sequenceだけを用意し、sessionのstatus/timestampsを欠落させる、またはentryを `kind: 'turn', role: 'admin', content: 123` のような無効shapeにする。
- 現在の挙動: API prepareは受理しFirestoreへimmutable保存する。admin clientは後段の `isWeeklyPlanningTraceEntry` で無効entryをsilent discardし、無効session status等は `sessionFromRemote` でsessionごとdiscardする。
- 期待挙動: untrusted JSON入口でsession/entryの有限schema、timestamp、kind固有fieldを検証し400にすること。
- 影響: 通常client bugや手動API呼出で、sequenceを消費したまま管理者から見えないtraceを作れる。owner/auth判定の根拠には使われないdiagnostic dataに限定されるためMINORとした。
- 既存テストが未検出の理由: privacy tests自体がkind/status/timestampを欠く最小objectの受理を期待し、structural invariantだけを検証している。

## 誤検知として除外した候補

- `entryCount` 後退: metadata PATCHから `entryCount` を除き、Firestore maximum transformを使うため、正常にtransformへ到達した競合request間では単調増加する。MAJOR-1の「transformへ到達しない部分失敗」とは別問題として除外した。
- cross-owner session takeover: 新sessionのowner予約はFirestore createで競合し、409時に再readしてHMAC subject/conversationを再検証する。推測不能な正規IDを前提とすればcross-owner overwriteは確認できなかった。
- raw Firebase uid漏えい: worker由来uidはHMAC subjectへ変換され、`userId`/`uid` keyはserver redactionで除去される。正規UUID structural IDにuidを使用するproducerも確認できなかった。MAJOR-2のfallback偽装だけを実害として採用した。
- Firestore client direct read/write: `firestore.rules:195-205` はsession/entry/audit collectionを全面拒否し、server service account経路だけが使用されるため除外した。
- admin権限偽装: `admins/{uid}` のclient writeはrulesで拒否され、workerもFirebase session確認後にserver-side admin documentを再確認するため除外した。
- 500件上限: cursorがなく欠落を明示しない点は運用改善余地があるが、今回の要件でbounded query自体は満たしており、具体的な必須pagination契約を確認できなかったため指摘化しなかった。

## 監査完了時 git status

```text
## agent/fix-weekly-planning-trace-and-dialogue-final...origin/agent/fix-weekly-planning-trace-and-dialogue-final
```

- repo内の監査用一時テストは削除済み。
- repo本体コードは変更していない。
- Git write操作は実行していない。
- full suite / buildは主監査agentが最後に実行する指示のため重複実行せず、担当focused testsと最小再現に限定した。
