# weeklyPlanning 対話アーキテクチャ v3（historical）

Status: **superseded by v4**
最終更新: 2026-07-13
Current DoR: weekly-planning-dialogue-architecture-v4.md

v3 で確立した single AI interpreter、typed command、validator、reducer、rules fallback、draft-first、preview-first、明示承認の根拠を履歴として保持する。v3 の固定 questionPlan、I1/I2/P3/P4/P5/P6/P7/P9 の実装順、D1/D2 backlog は current queue ではない。

## 保持する安全境界

provider 利用時は interpreter を single semantic layer とし、rules parser と merge しない。AI は state を直接変更せず、normalize/validate/reducer/scheduler/preview/approval/save は deterministic。空 candidates は正常解釈結果、provider failure のみ turn-wide fallback とする。

## v4 への読み替え

v4 は v3 の境界を維持しつつ、DialogueStateSnapshot、AllowedDialogueActions、DialogueResponsePlan、assumption/correction lifecycle、turn/request stale、untrusted snapshot strings、non-exam preview bridge、approval idempotency、localStorage migration、P1-P7 evaluation を追加した。現在の queue は Gate P4（verification gate）→ DA0 open → DA1 → DA1b → Draft approval idempotency → DA2 → DA3a → DA3b → DA3c queued である。

この文書中の「次に実装」「I1/I2」「P4/P5」「D1/D2」は v3 時点の履歴であり、status/acceptance/queue の判断に使用しない。