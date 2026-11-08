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

## Follow-up: single-event prepare (design before implementation)

Active branch `feat/issue355-mcp-prepare`, exact base `b83a36eaad657109c31bae5b6f26d97724aa7489` (PR #1047). Owner: WiseLinnaeus. Status: locally verified; patch handoff to PluckyTuring for Git/CI integration. The read-only slice above remains its own release unit.

単発の一般予定について、型付き title / start / end / timeZone から未保存の仮確認を返す。start/end は `YYYY-MM-DD` と `HH:mm` (00:00–23:59) の正規化済みローカル端点。24:00 や日跨ぎは解釈せず、明示された翌日00:00を受ける。終了は開始より後、composition が指定した許可期間内に収まることを検証する。期間末の翌日00:00は排他的終端として許容する。自然文、UTC offset、終日、recurrence、更新・削除はこの入力に含めない。

候補は canonical ScheduleEvent の一般予定フィールドに対応するが、保存レコードは作らない。既存の owner-bound range reader が authority・owner・timezone と既存 occurrence 展開を所有し、prepare は正規化済み半開区間の比較だけを行う。全重なり（busy 値も保持）と、タイトル・両端点が同じ重複候補を返す。タイトル一致を同一予定の証明とは扱わず、自動削除・保存・時間移動を行わない。

代案比較: (1) 週間planning graphを新設すると単発の確認に不要な状態と保存経路を増やす。(2) MCP専用draft DBやpreview tokenを発行すると今回不要な持続性・承認権限を生む。(3) **採用:** stateless な typed preview と既存 reader の再利用。返値は `unsaved_preview`、preview ID/revision は今回発行しない。後段commitはこの返値を権限として信用せず、owner/freshness/明示承認/冪等性を別途検証する必要がある。

MCP は既存の無効 flag / 未構成401を維持し、prepare に `schedule:prepare` scope を追加する。read scope だけの client には引き続き read tool だけを列挙し、prepare 呼出を403にする。追加scopeは保存権限ではない。default entry は認証・reader・preparerを持たず、OAuth・本番entry・deploy設定・Firestoreは変更しない。

Exit: 重複候補、隣接と日跨ぎの半開区間、タイムゾーン、owner、許可期間外、不正入力、読取不能、無書込み、MCP scope/discovery/call を決定論で確認し、型検査と独立Worker bundleを検証する。関連範囲の統合テストと exact diff/manifest を親へ渡す。公開・実保存の完了とは呼ばない。

2026-11-08: focused 67/67 (3 files)、Worker 全体＋MCP/occurrence/authority repository の統合 1820/1820 (137 files)、app/Worker typecheck exit0、production app build exit0、独立Worker bundle 7.2kB と無効404/認証未構成401の実行確認2/2が通過。型生成時の Wrangler debug log は sandbox の `~/.wrangler/logs` EPERM が出たが、runtime types生成と tsc は完了・exit0。共有fixture / runner / provider / trace / 保存schema / 本番entryには変更がなく、新規moduleのimportは独立MCP entry内に限られるため、VNext全体の再実行は統合owner側のCIへ委ねる。

保存形状の追加keyはない。Pages/Workerの本番配信順序変更は不要（両本番entry・deploy設定は無変更）。差分の適用基点は #1047。OAuth、実authority admission/composition、公開、保存・承認・冪等commitは引き続き後続範囲であり、現在の仮確認をその代用にしない。実行証拠とexact contentは `.handoff/355-prepare-summary.md` / `.handoff/355-prepare-snapshot.json` に記録する。

## Follow-up: single-event commit (default disabled)

Branch `feat/issue355-commit-slice`, base `d3ca395a`. Status: locally verified; patch handoff to PluckyTuring. Not published; no OAuth, client registration, deploy config or production flag.

`commit_schedule_event`（title / start / end / timeZone / `idempotencyKey` / 任意の `acceptOverlaps`）は、既存 authority の `upsertMonthEvent`（UI の手動予定追加と同じ保存境界。Firestore 直書き・新 collection・Rules 変更なし）を1回だけ呼ぶ。prepare の結果は信頼せず、commit ごとに prepare と同じ検証（owner / timezone / 許可期間 / 型付き端点）と canonical read による重複・重なりの再確認を行う。重複（同題・同端点）は保存しない。重なりは `acceptOverlaps: true` の明示がある場合だけ保存する。

冪等性: event id は `sha256(ownerId + idempotencyKey)` から決まる。同じ key の再送は既存 record を読み、同内容なら書かずに `already_saved`（後で UI から編集された内容も上書きしない）、別内容なら `idempotency_conflict`。保存後は read-back で一致を確認できた場合だけ `saved`。書込みが例外でも read-back で存在が確認できれば `saved`、確認できない（read 失敗を含む）場合は `save_outcome_unknown` とし、「保存済み」とも「未保存」とも言わず同じ key での再試行を促す。

Worker: scope `schedule:commit` を新設。scope が無ければ 403、`MCP_COMMIT_ENABLED=true` でなければ tools/list に出さず呼出しは unknown tool（既定は無効）。認証未構成は従来どおり 401。read/prepare scope だけでは呼べない。

限界: ScheduleEvent に revision field は無く、`setDoc` による保存のため、別 key の同時 commit 同士の重なりを transaction では防げない（同じ key の並行は同じ doc なので二重にならない）。実際の authority admission / 認証 composition は後続。

### commit を有効化する前の前提（PR #1066 の独立レビュー R1・R2）

この slice は既定で無効で、OAuth も認証 composition も無いため、現状では保存に到達しない。**次の前提がすべて満たされるまで `MCP_COMMIT_ENABLED` を有効にしない。** 有効化は承認境界であり、親/所有者の明示承認を要する。

**R1: サーバーは「ユーザーの承認」を検証できない（F3×S6=18）**
- `commit_schedule_event` の説明は「ユーザーが preview を承認した後」と述べるが、サーバー側に承認の証拠は無い。prepare は token を返さない設計のため、commit は prepare を経由せず直接呼べる。`acceptOverlaps: true` もモデルが自分で付けられる。
- 実際の防御は、(a) `schedule:commit` scope、(b) flag、(c) MCP ホストの同意 UI の3つだけである。
- 有効化前の条件:
  1. OAuth の同意画面が「予定の書き込み」を明示する。
  2. ホストが write tool ごとに利用者へ確認することを、利用条件として確認する（tool には `readOnlyHint: false` を付けてある）。確認できないホストには `schedule:commit` を発行しない。
  3. 実 authority の admission / composition と実認証が完成するまで、flag を有効にしない。
- サーバー側で承認を検証する案（承認 token の発行など）は、persistence と承認権限を新設するため、今回は採らない。必要になった時点で別 Issue で設計する。

**R2: 書込みの上限と監査が無い（F2×S5=10、#992 の候補）**
- 重複と重なりは止めるが、別 key で時刻やタイトルを変えた event は回数の制限なく作れる。scope を持つ agent が暴走または prompt injection を受けると、owner の calendar を埋め得る。保存した event の目印は ID の `mcp-` 接頭辞だけで、監査ログは無い。
- 有効化前の条件: owner ごとの日次上限と、保存の構造化ログ（event ID と時刻のみ。title・メモ・資格情報は記録しない）を追加する。実装は有効化の承認と同じ段階で行い、この slice には含めない。

**再送の意味（レビューの補足、F×S<10）**
- 同じ key の再送が `already_saved` になるのは、title・日時が保存時のままの場合。UI で title や時刻を編集した後は `idempotency_conflict`（安全側）。UI で削除した後の再送は再作成する。メモなど比較対象外の項目を編集しても `already_saved`。
- 同じ key で内容の異なる同時リクエストは後勝ちになり、片方は `save_outcome_unknown` を受ける。
- title の長さの上限は無い（UI にも無く、新規のギャップではない）。1 MiB を超えれば保存は失敗し `save_outcome_unknown` になる。
- flag 無効で `schedule:commit` scope も無い呼び出しは、unknown tool ではなく 403 になる。

### R2 実装: 日次上限と監査ログ（`feat/issue355-commit-guardrails`、既定で無効のまま）

- 日次上限: owner ごと・owner の IANA timezone の暦日ごとに、保存できる commit は既定 20 件（`createScheduleEventCommitter` の `dailyLimit` で変更。正の整数以外は構成エラー）。超過時は保存せず `daily_limit_exceeded`（上限値・timezone・「保存していない」ことをメッセージに含む）。冪等な再送（`already_saved`）、重複・重なりの拒否は数えない。既定値の根拠は、会話で人が1日に登録する数は数件であり、暴走した agent の被害を小さく確認可能な件数に抑えること。
- 計数の保存先: 新しい store は作らない。既存の authority の canonical snapshot から、その owner の `mcp-` 接頭辞の event のうち `createdAt` が当日（owner の暦日）のものを数える。DO / KV / Firestore の新 collection や Rules は不要。UI で削除された event は数えなくなる（agent に削除 tool は無く、利用者の操作による）。
- 監査ログ: commit 試行ごとに `[MCP Schedule Commit] audit` + `{event, ownerId, eventId|null, outcome: saved|duplicate|rejected, reason, at}` を `console.info`（既存 Worker の `[Tag] message` + 構造化フィールドの形式）で出す。title・メモ・idempotencyKey・timezone は含めない。`audit` で差し替え可能で、sink が失敗しても commit の結果は変わらない。
- 残り（範囲外）: R1（同意画面・host の確認）、有効化そのもの、実認証と authority admission。

#### 同時 commit と日次上限（PR #1070 のレビュー P12）
件数の確認から保存・読戻しまでを、owner ごとの排他区間（同一 isolate 内の直列化）に入れた。同時に commit しても上限を超えて保存されず、同じ key の同時再送も1回だけ保存される。新しい Firestore collection・Rules・counter は使わない。**限界**: この直列化は他の isolate には効かない。有効化の前に、実際の composition で owner の commit を1か所（例: owner ごとの Durable Object）で実行するようにする。これを満たすまで flag を有効にしない（有効化の前提に追加）。

### owner ごとの commit 直列化を isolate 間で保証する（`feat/issue355-mcp-owner-serializer`、既定で無効のまま）

**設計**: MCP Worker の entry は commit を owner ごとの Durable Object `McpOwnerCommitGate`（`idFromName(ownerId)`）へ委譲する。DO の中で既存の `createScheduleEventCommitter` を変更せずに実行する。DO は owner ごとに1インスタンスしか存在しないので、既存の owner 単位の直列化（件数確認から保存・読戻しまで）が、全 isolate に対する唯一の書込み経路になる。DO は規則を足さない（上限・重複・冪等性は従来の committer のまま）。型付きエラー（`daily_limit_exceeded` など）は DO の応答に載せて Worker 側で同じ class として投げ直す。想定外の失敗は詳細を境界の外に出さず、Worker は「保存を確認できていない。同じ idempotencyKey で再試行」と返す（「保存済み」とは言わない）。

| 選択肢 | 判断 |
|---|---|
| 新しい DO class `McpOwnerCommitGate`（**採用**） | owner ごとの単一実行が構造で保証される。MCP 専用 Worker に閉じ、本番 Worker の binding・migration・secret に触れない。 |
| 既存 `AI_TURNS` DO の流用 | 週間計画の turn の責務・storage・migration と混ざる。本番 Worker（traceWorker.ts）の変更が必須で、MCP の flag 無効の原則に反する。不採用。 |
| Firestore transaction のカウンタ | 件数を数える新 collection と Rules が要り、ScheduleEvent に revision が無いため保存と同一 transaction にできない（別 key の重なりも防げない）。親への事前相談が必要な範囲で、不採用。 |

**構成**: `workers/ai-proxy/wrangler.mcp.jsonc`（main は `src/mcpWorker.ts`、binding `MCP_OWNER_COMMIT_GATE`、migration `mcp-v1`）。`MCP_READ_ENABLED` / `MCP_COMMIT_ENABLED` は設定せず既定で無効。本番の `wrangler.jsonc`（main は `traceWorker.ts`）と `deploy:worker` は変更していない。この構成は deploy していない。`mcpWorker.ts` は `authenticate` を持たない（全 request が 401）うえ、DO の authority composition は未設定で、呼ばれると失敗する。

**テスト**: 2 つの isolate（モジュールを別に読み込んだ committer）の対照で、gate なしでは上限を超えて保存されること、gate 経由では上限ちょうどで止まること、DO の失敗時に何も保存されないこと、再送が冪等なこと、別 owner が別の DO に行くこと、1つの DO が別 owner の要求を拒否すること。

**所有者が判断すること（実装していない）**
1. 実認証と OAuth: 認可サーバー、クライアント登録、同意画面（R1）、`schedule:*` scope の発行条件。
2. アカウントリンク: MCP の利用者と Firebase の owner（uid）の対応づけ。
3. 本番の authority composition: DO から ScheduleEvent authority（Firestore）へ到達する資格情報（サービスアカウントなど）の発行・保管（Worker secret）と、その権限の範囲。
4. MCP Worker の公開: 別 Worker 名・ドメイン・Origin 許可、`wrangler.mcp.jsonc` の最初の deploy、DO migration の承認。
5. flag を有効にする時期: 上の1〜4と R1 が済んだ後の `MCP_COMMIT_ENABLED` の承認。
