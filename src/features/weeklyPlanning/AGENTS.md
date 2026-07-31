# Weekly Planning Agent Rules

このディレクトリ配下の変更では、リポジトリ直下の`AGENTS.md`に加えて以下を必ず守る。

## Trace persistence gate

週間計画のprompt、AI request/response、renderer input/output、Fact Graph、intake state、scheduler result、diagnostic field、trace fieldのいずれかを追加・変更した場合、実装だけで完了扱いにしてはならない。

同じpull requestへ、変更した情報が実際の永続化境界を通過できることを確認する強い回帰テストを必ず追加または更新する。

最低限、該当する経路について次を確認する。

1. 実際にproviderへ送ったrequestまたは生成された診断情報がtraceへ入る。
2. turn diagnosticが`clientDocumentTargetBytes`以下に収まる。
3. 初回append失敗時にpersistent outboxへ残り、次回retryで情報を失わない。
4. Workerの`prepareWeeklyPlanningTraceServerWrite`を通過する。
5. Worker preparation後のdocumentが`maxDocumentBytes`以下に収まる。
6. 将来fieldを模した未登録sentinelを追加しても、schema同期漏れで消えない。
7. 大容量値を追加してもturn全体を破棄せず、明示的なtruncation情報を残して保存できる。

単体テストでobject生成だけを確認する、repository mockが呼ばれたことだけを確認する、または型検査だけを通すテストは、このgateの代替にならない。

変更した情報が意図的にtrace対象外である場合は、除外理由、privacy上の根拠、診断への代替情報をpull requestへ明記し、その除外契約をテストする。

## Required verification

少なくとも次を実行する。

```bash
npm run typecheck
npm run test:run
npm run build
```

GitHub Actionsがjob開始前に停止してstepが0件の場合、それをテスト失敗または成功として扱わない。ローカル検証結果が確認できるまでmergeしない。
