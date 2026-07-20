# PR #68 統括監査指摘の修正計画

## 対象

- ブランチ: `agent/fix-weekly-planning-trace-and-dialogue-final`
- 監査対象コードHEAD: `23d7676370b3efebc8d1465dfd01abc32c6462ca`
- M-8以外の実装完了コミット: `d9726b47340b2b3ef8907ea6f52b4ce37fd431eb`
- 最終整理コミット: `dfeda947e9820278863b88af90543c70b9155aac`
- 詳細: `docs/ai/audits/20260720-pr68-final/final-audit.md`

## 実装原則

各項目を独立した修正単位として扱い、対象外の指摘を同時に変更しない。各単位では監査反例を回帰テストとして追加し、実装後にfocused testを成功させる。対象項目の完了後に全suite、production build、`git diff --check`を実行する。

## 修正単位

### T1 / M-1: life constraint時刻grounding — 完了

時刻の分精度、start/endの役割、kindと時刻の同一節対応を検証する。hour-only入力は`:00`だけを許可し、明示minuteの切捨て、endpoint swap、複数節cross-associationを拒否する。

### T2 / M-2: meal/bath短答の質問文脈 — 完了

曖昧な短答を黙って破棄せず、値を一意に確定できない場合は限定的なrepairへ回す。表示質問を一ターン一問へ統一し、保存contextとの不整合を解消した。

### T3 / M-3: unit-rateの単位grounding — 完了

単位なし数値を複数のcanonical値へgroundingできないようにし、単位を一意に確定できない短答は確認を継続する。

### T4 / M-4: priorityの完全性と順序grounding — 完了

既知fieldの完全被覆と、発話で明示された全相対順を検証し、partial orderとtail permutationをconfirmed priorityとして受理しない。

### T5 / M-5: 一般的な「科目」のexam誤分類 — 完了

`1科目`だけを院試scope signalとして扱わず、明示的なexam文脈または既存exam scopeがある場合に限定した。

### T6 / M-6: accepted-factのcanonical表示 — 完了

canonical値と矛盾する`rawText`をvalidation境界で表示根拠から除外し、受理表示と保存stateの不一致を防止した。

### T7 / M-7: trace retryのidempotency — 完了

immutable同値比較からserver生成の`expireAt`を除外し、同一payloadのretryがexpiry更新だけを理由にconflictしないようにした。その他の差分は従来どおり拒否する。

### T8 / M-8: client-controlled structural IDの信頼境界 — 方針確定・実装未着手

#### 調査結果

`src/features/weeklyPlanning/trace/weeklyPlanningTraceRuntime.ts` はブラウザ側の `randomId()` で `logicalConversationId` と `sessionId` を生成する。通常は `crypto.randomUUID()` を使い、利用できない環境では `Date.now()` と `Math.random()` を組み合わせたfallback値を使う。

生成されたsession、conversation、entryの各IDは、`weeklyPlanningTraceRemoteRepository.ts` と `weeklyPlanningTracePrivacyClient.ts` を通じてappend APIへそのまま送られる。サーバー側の `prepareWeeklyPlanningTraceWrite()` は文字列形式と各IDの対応関係を検証するが、受理したclient値をFirestore document IDとstructural fieldの正本として使用する。

したがって、問題の本質は電話番号を扱う機能ではない。認証済みユーザーはブラウザコードを経由せずappend APIのrequest bodyを直接作れるため、`weekly-trace-09012345678-abcdef` は「クライアントが指定した任意のstructural IDをサーバーが正式IDとして採用する」設計上の穴を示す反例にすぎない。

fallback形式から電話番号形だけを除外しても、任意のUUIDへ差し替えることはできる。UUID形式への限定だけでは、client-controlled IDをサーバーの永続化キーとして信頼する問題は解消しない。

#### 採用方針

Firestore path、admin取得、entryの親子関係に使うcanonical structural IDはサーバーが生成し、認証subjectへ紐付けた値だけを正本とする。append APIが、クライアントから初めて送られた任意の `sessionId` を新規sessionとして作成する現在の契約は廃止する。

クライアント生成値が必要な場合は、非権威のcorrelation keyまたはidempotency keyとしてのみ扱う。raw値をFirestore pathやadmin responseへ使用せず、保存が必要ならサーバー側で固定長hashまたはHMACへ変換する。会話本文など自由入力に対するPII redactionは維持し、structural ID問題を理由に一般redactionを削除しない。

#### 実装境界

1. 認証済みsession開始APIを追加し、サーバーがcanonical `sessionId` と `logicalConversationId` を発行してownerへ紐付ける。既存のserver-issued conversation IDを継続利用する場合もowner一致を確認する。
2. client runtimeは最初のtrace書込み前にserver-issued handleを取得し、取得中に生成されたentryをlocal queueへ保持する。
3. append APIは既存かつowner一致するserver-issued sessionだけを受理し、未知のclient-supplied session IDからdocumentを新規作成しない。
4. entry IDはサーバー側でcanonical session IDとsequenceから決定する。clientの `entry.id` は送信契約から外すか、照合用に残す場合も永続化キーとして採用しない。
5. `crypto.randomUUID()` とfallback IDは、local correlationまたは開始APIのidempotency用途へ限定する。fallback形式をcanonical structural IDとして受理するvalidatorは新規write経路から削除する。
6. 既存traceはread-only legacyとして取得可能にし、新形式はstorage layout versionを更新して区別する。legacy互換を理由に新規writeでclient-controlled IDを再許可しない。

#### 必須回帰テスト

- 任意文字列、電話番号入り形式、別UUIDをappendへ直接送っても新規canonical sessionを作れない。
- session開始APIが発行したIDだけでappendでき、別userが同じIDを使用すると拒否される。
- persisted path、structural field、admin responseがclient correlation keyのraw値に依存しない。
- entry IDがサーバー側でsession IDとsequenceから決まり、client指定値で上書きできない。
- session開始とappendのretryが同一owner・同一idempotency keyで収束する。
- 旧形式traceのread互換を維持しつつ、旧fallback形式による新規writeは拒否される。

### T9 / M-9: legacy trace handleの取得 — 完了

新形式validatorを緩めず、旧実装の限定的なlegacy handleだけを認識し、legacy読取分岐へ到達させた。

## 検証結果

M-8を除くT1〜T7とT9について、focused回帰、全テストsuite、TypeScriptおよびproduction build、`git diff --check`が成功した。一時適用script、診断ログ出力、追加CI jobは最終commitから除去し、通常CIへ戻した。

## 残件

M-8は方針を上記のserver-authoritative IDへ確定したが、実装と回帰テストは未着手である。統括監査のMINOR指摘はこの修正単位の対象外であり、別タスクとして扱う。
