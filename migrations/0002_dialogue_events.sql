-- 意見交換会の開催予定（dialogue_events）と、執行部ポータルの操作ログ（staff_audit_log）
-- D1: nobeoka-staff / binding: STAFF_DB
--
-- server/dialogueEvents.ts の DIALOGUE_SCHEMA_SQL と同じ定義です（テストで一致を確認しています）。
-- アプリは最初のアクセス時にこの定義を自動で実行するため、手動での適用は必須ではありません。
-- 明示的に適用する場合：npm run d1:migrate
--
-- IF NOT EXISTS のため、何度実行しても既存のテーブル・データは変わりません。DROP・DELETE は含めないでください。
--
-- status：open（受付中）／closed（受付終了）／scheduling（日程調整中）／completed（開催済み）
-- 時刻：created_at・updated_at・deleted_at は UNIX時刻（秒）。deleted_at が入っている行は削除済み（論理削除）。

CREATE TABLE IF NOT EXISTS dialogue_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'scheduling', 'completed')),
  application_open INTEGER NOT NULL DEFAULT 0 CHECK (application_open IN (0, 1)),
  is_published INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
);

CREATE INDEX IF NOT EXISTS dialogue_events_listing ON dialogue_events (deleted_at, is_published, event_date);

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
