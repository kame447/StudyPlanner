# #355: read-only MCP first slice

Status: locally verified first slice; unpublished. Owner: WiseLinnaeus / integration: PluckyTuring.
Branch `feat/issue355-mcp-read-slice`, base `856dbe11fd4a34c24fbe3d6f79d07b109152e176`.

## Scope and ownership

今回の完成物は、本人の指定期間を読む `read_schedule_range` application adapter と、専用 Worker entry の `/mcp` 骨組み。公開、OAuth、アカウントリンク、クライアント登録、DNS、prepare/commit、週間計画生成は含めない。既存 AI Worker の entry / deploy 設定も変更しない。

経路は `MCP request → injected authentication → owner-bound read capability → existing canonical repository → ScheduleOccurrence projection → structured result`。tool argument に owner/user ID は設けず、認証結果と capability の owner を照合する。読取結果の Plan / MonthEvent / timetable template / term も owner を照合し、混入時は全体を拒否する。title 等は結果の文字列であり、命令として実行しない。

## Selected boundary / alternatives

1. UI の PlannerRepository facade は `ensureMigrated` を起動し得るため、read-only tool から直接呼ばない。検証が容易でも読取中の書込みが残る。
2. raw Firestore query の新設は authority / migration / owner の別実装になるため採らない。
3. **採用:** `ScheduleEventAuthorityRepository.getScheduleSnapshot` と既存 timetable 読取 port を注入し、共通 `createScheduleOccurrenceProjection` を使う。既に canonical admission が確定した owner-bound capability だけを渡す。未移行・移行中・読取失敗を空予定として返すことは禁止。実認証と authority admission の本番 composition は次段階であり、今回の default entry は capability を持たない。

期間は `startDate` / `endDate` の両端を含むローカル日付、`timeZone` は capability 側で確定した IANA zone と同一であることを検証する。既存保存値は浮動ローカル date/time なので、UTC instant に作り替えたり、異なる zone の時刻としてラベルを付け替えたりしない。recurrence、日跨ぎ、時間割、import 済み予定の重複排除は既存 projection が所有する。

## Transport and closed defaults

専用 entry は環境 flag `MCP_READ_ENABLED=true` のときだけ `/mcp` を扱う（既定404）。全操作に認証 interface を要求し、未構成/未認証401、read scope 不足403、reader 未構成は読取不能として拒否する。現在の本番 entry に import せず、deployment config は作らない。

Streamable HTTP の stateless JSON response subset: `initialize`、`notifications/initialized`、`ping`、`tools/list`、`tools/call` の単一リクエスト。POST JSON、Accept / Origin / protocol-version を検証し、SSE GET / session DELETE は405。tool は1個、readOnly / non-destructive / closed-world。write tool や汎用 registry は作らない。サーバー送信、SSE、session store、OAuth metadata は本段階の機能ではない。

## Verification and exit

決定論テストで owner の不一致/混入、日付と timezone、canonical repository と UI projection の一致、読取時の書込み0、initialize → tools/list → tools/call、無効化/認証/不正Originを確認する。外部サービス・実データ・有料モデルは使わない。変更と同じ integrated tree で focused + app/Worker typecheck、親へ patch/要約を渡す。未公開の独立 entry / adapter のため、VNext 全体再実行を省略する場合は要約に依存境界と実行範囲を書く。CI/本番接続の成功とは呼ばない。

2026-11-08: 新規 focused 34/34、Worker 全体＋既存 occurrence / authority repository を含む136 files・1787/1787、app/Worker typecheck、standalone Worker bundle と閉じた既定値の実行確認が通過。既存 VNext / 本番 entry / schema / 依存 / build設定は無変更で新規 import もないため、VNext 全体の重複実行は省略。HTTP header/owner の確認を含む実行証拠と exact source manifest は親への `.handoff/355-summary.md` / `.handoff/355-snapshot.json` に集約する。

公開前には別承認で OAuth / canonical marker admission / read-only server repository composition / rate・query budget / audit / 実クライアント相互運用を完成させる。現在の flag を立てるだけでは読めない構成を維持する。

References (checked 2026-11-08): [OpenAI server/tool/auth boundaries](https://developers.openai.com/plugins/build/mcp-server), [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [MCP initialization/version negotiation](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [schedule authority](../../scheduling/architecture/scheduled-event-authority.md).
