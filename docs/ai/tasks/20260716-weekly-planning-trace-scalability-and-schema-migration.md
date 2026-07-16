# 週間計画traceのscalabilityとschema migrationを設計する

Status: planned
Priority: P2
Requirement IDs: P7-TRACE-001

## 1. 背景

trace entryはappend-onlyで増加し、admin viewerのfilterとtimeline取得はFirestore read costと描画負荷を増やす。schemaVersionは存在するが、過去entryを安全に読むdecoderとmigration policyを継続的に管理する必要がある。

## 2. 目的

session一覧とentry timelineをbounded queryへ変更し、過去schemaを破壊せず読み出せるversioned decoderとarchive方針を定義する。

## 3. Entry conditions

- privacy/lifecycle taskで保存対象とretentionが確定していることが望ましい。
- 現在のquery、index、viewer read patternを計測する。
- Firestore composite indexとTTL設定を確認する。

## 4. 対象責務

- cursor pagination
- session summaryによるfilter
- entry timelineのlimitとload more
- composite indexとsingle-field exemption
- archiveまたはaggregate collection
- schemaVersionごとのdecoder
- unknown eventとcorrupt entryのsafe representation
- export format version

## 5. 触らない範囲

- trace contentのprivacy判断
- planning pipelineの成功条件
- client eventを監査証跡へ昇格すること

## 6. 受け入れ条件

- session一覧とentry timelineが無制限readを行わない。
- pagination cursorがstable orderingを維持する。
- queryに必要なindexを運用文書へ列挙する。
- 旧schema entryをversioned decoderで読み、未知versionをsafe discardまたは明示表示する。
- exportにschema versionを含める。
- migration failureでもplanning処理を失敗させない。

## 7. Exit conditions

- read cost、page size、archive条件、decoder追加規則をarchitectureへ反映する。
- destructive migrationより新decoder追加を優先する。
