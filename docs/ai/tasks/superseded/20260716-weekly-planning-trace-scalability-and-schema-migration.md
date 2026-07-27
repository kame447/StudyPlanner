# trace scalability・schema compatibility

Status: superseded / consolidated
Superseded: 2026-07-28
Replacement: `../20260716-weekly-planning-trace-privacy-and-lifecycle.md`

このworkは未実装であり、完了扱いではない。

pagination、stable cursor、query cost、index、archive、versioned decoder、unknown/corrupt entry handlingは、production traceのretention、access、admin viewer、exportと同じ保存境界で設計する必要がある。

旧taskを独立rootへ残さず、replacement taskの「Scalability・schema compatibility」sectionへ統合した。