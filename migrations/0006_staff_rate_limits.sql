-- 執行部ポータルの操作の間隔制限（staff_rate_limits）。D1: nobeoka-staff / binding: STAFF_DB
--
-- server/snsAdmin.ts の SNS_ADMIN_SCHEMA_SQL と同じ定義です（このファイルはそこから生成し、テストで一致を確認しています）。
-- 現在の用途：SNS管理の「今すぐ同期」を全体で60秒に1回までにする（key = 'sns-manual-sync'、locked_until = UNIX時刻（秒））。
-- アプリは最初のアクセス時にこの定義を自動で実行するため、手動での適用は必須ではありません。
-- 明示的に適用する場合：npm run d1:migrate
--
-- IF NOT EXISTS のため、何度実行しても既存のテーブル・データは変わりません。DROP・DELETE は含めないでください。

CREATE TABLE IF NOT EXISTS staff_rate_limits (
  key TEXT PRIMARY KEY,
  locked_until INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS staff_audit_log_target ON staff_audit_log (target_type, target_id, created_at);
