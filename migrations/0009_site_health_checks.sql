-- サイトの定期チェックの結果（site_health_checks）。D1: nobeoka-staff / binding: STAFF_DB
--
-- server/siteHealth.ts の SITE_HEALTH_SCHEMA_SQL と同じ定義です（テストで一致を確認しています）。
-- アプリは最初の記録・表示のときにこの定義を自動で実行するため、手動での適用は必須ではありません。
--
-- 定期チェック（.github/workflows/site-monitor.yml → /api/admin/site-health）が、チェックごとの最新の状態を1行ずつ保存します。
-- 執行部ポータルの「サイトの状態」（/staff/status/）に表示します。
-- IF NOT EXISTS のため、何度実行しても既存のテーブル・データは変わりません。DROP・DELETE は含めないでください。

CREATE TABLE IF NOT EXISTS site_health_checks (
  check_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  since INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
);
