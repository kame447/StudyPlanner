Status: superseded by the stricter PR #75 contract and preserved as historical design context. Provider-failure parser fallback described below is no longer permitted.

# 週間計画の意味解析責務をAIへ一本化する

## 背景

2026-07-21の実トレースでは、AI経路であるにもかかわらず決定論的パーサーが先に発話を状態へ変換し、`OS`、`ネットワーク`、`ヒューマンサイエンス`の3分野を、述語や接続表現を含む7分野へ破壊した。AI rendererはその破壊済み状態を自然文へ戻したため、`responseSource=ai`でも読み取り主体はAIではなかった。

## 責務境界

providerが正常なturnでは、自然言語から意味を抽出する主体を単一のAI interpreterに限定する。AIは生の当該発話、直近会話、受理済み状態のsummaryを読み、typed command候補、仮定proposal draft、仮定decision draft、訂正draftを返す。AIはstate、missing、質問対象、preview可否、保存可否を直接決めない。

決定論的coreは、AI候補のschema検証、根拠照合、日付時刻の正規化、参照先の解決、値域検証、競合排除、revision・conversation ID・correction IDの付与、reducer、missing/readiness/feasibility、scheduler、approval/save gateを担当する。この層はraw userTextから新しい意味を生成しない。

rules parserは、AI interpreterが構成されていないrules-only経路と、provider呼び出しが例外で失敗したturnのfallbackにだけ使用する。AIが空候補を正常返却した場合はfallbackしない。同一turnでAI結果とrules semantic resultをmergeしない。

## 実装上の決定

AI経路のturn開始は`beginWeeklyPlanningUserTurn`だけを用い、前状態のclone、質問配列のreset、sourceTurns追加だけを行う。`applyDeterministicWeeklyPlanningUserTurn`は呼ばない。clarificationもAIの`request_clarification`だけを採用し、rules clarification parserはprovider failure時だけ使う。

仮定の承認・却下・変更と訂正は、lifecycle decoratorがregexで生成しない。AIが公開済みproposal IDまたはcorrection target refを選び、decoratorはその参照を確認したうえでtrusted metadataを付与する。最終適用前には既存lifecycle validatorとcommand runtime validatorを通す。

「OSとネットワークは1年分、ヒューマンサイエンスは2年分」のような分野別量は、`set_exam_scope`の共通`totalYears`へ潰さず、分野ごとの`mark_completion_target(latest_n_years)`として保持する。validatorの競合単位もgenericな`progress`ではなく`progress:<field>`とする。

明示的な「この条件で予定を作って」はAIが`authorize_draft_generation`を返し、決定論的validator/reducerが適用する。rules用regex parserはrules-only/failure経路に残すが、成功したAI経路では実行しない。

## behavior・safety層まで含めた追加監査

intakeだけをAI主体へ切り替えても、behavior層が`currentUserText`や`sourceTurns`を再読して意味を補完すれば、読み取り主体は依然として複数になる。追加監査では、相対制約、締切、朝を避ける嗜好、就寝前の学習嗜好、draft生成許可をraw textから再解釈する経路を除去した。

相対制約はAIが`add_relative_constraint`を返す。AIは`stateSummary.constraintAnchors`に公開された既存の`constraint:<index>`だけを参照し、決定論的coreが参照の一意性、根拠、時刻範囲、revisionを検証して具体的な制約へ解決する。同一turnでまだ受理されていないeventは参照対象にしない。その場合はAIが絶対時刻のconstraintを返すか、clarificationを要求する。

朝を避ける、就寝前を好むといった時間帯嗜好は`note_study_time_preference`として状態へ保持する。behavior plannerは受理済みの`studyTimePreferences`だけからanchorとopportunity tagを生成し、過去発話を走査しない。

締切は`set_study_goal.goal.deadlineDeclared`で存在を保持する。日付が不明でもdeadline factを失わず、safety層が未解決の必須確認事項として扱う。`deadlineDate`と`deadlineTime`は、AI候補の根拠照合と値域検証を通った場合だけ受理する。behavior・safety層はtaskのtyped deadlineだけを読み、`小テスト`や曜日をraw textから推測しない。

生活制約は加算可能なcollectionであるため、validatorの競合単位を`life_constraints:<kind>:<date>`へ細分化した。これにより、同一turnのmealとcommuteを独立事実として両方受理しつつ、同じ種類・同じ日付の競合だけを調停する。

## 保存境界

`deadlineDeclared`、`deadlineDate`、`deadlineTime`、`studyTimePreferences`は、次turnとsession再開後にも必要な受理済みユーザー事実なので保存対象とする。proposal ledgerやrequest ownershipは従来どおりsession-localとして保存しない。storage validatorは新しいtyped factを閉じたschemaで検証し、不正なdeadline値や未知のtime preferenceを含むstate全体を拒否する。

追加の7観点監査では、受理済みtaskの`rawText`をbehavior plannerが再解析する経路を除去した。また、同名taskのmetadata対応をtitleではなくwork itemのindexで維持し、相対制約とtask参照は発話上の参照先が一意な場合だけ受理する。曜日だけが示された締切・計画日も、選択中の計画週から一意に解決できる日付だけを許可する。

最終再監査では、behavior plannerがAI生成済みの`title`・`subject`を正規表現で再分類していた経路も意味解析の二重化と判断した。非試験taskの`activityKind`、`distributionPolicy`、`cognitiveLoad`は`set_study_goal.goal.executionProfile`としてAIがtyped出力し、決定論的層はそのenumに対応するセッション長policyだけを適用する。計画期間の表示名も`sourceText`の再解析ではなく、受理済み日時から生成する。同名taskはsubjectを含むidentityで区別する。

## 検証

責務境界の集中回帰テストと全テストsuiteを4 shardで実行し、TypeScript型検査、production build、`git diff --check`まで通過させる。旧テストも、成功したAI経路でrules parserの補完を期待しない契約へ更新する。
