-- イベント（events）。D1: nobeoka-staff / binding: STAFF_DB
--
-- server/events.ts の EVENTS_SCHEMA_SQL と同じ定義です（このファイルはそこから生成し、テストで一致を確認しています）。
-- アプリは最初のアクセス時にこの定義を自動で実行するため、手動での適用は必須ではありません。
-- 明示的に適用する場合：npm run d1:migrate
--
-- 意見交換会（dialogue_events）とは別のテーブルです。意見交換会はここに登録しません。
-- visibility：public（一般公開。公開ページに表示）／internal（執行部のみ。初期値）
-- person_in_charge・required_items・internal_notes・volunteer_* は執行部内でのみ使い、公開ページには出しません。
-- 「最新のお知らせ」との紐づけは news_items.source_key = 'event:<id>'（news_items の構造は変更しません）。
--
-- IF NOT EXISTS のため、何度実行しても既存のテーブル・データは変わりません。DROP・DELETE は含めないでください。
-- 時刻：created_at・updated_at・deleted_at は UNIX時刻（秒）。deleted_at が入っている行は削除済み（論理削除）。

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('supporters', 'community', 'exchange', 'volunteer', 'street', 'meeting', 'other')),
  status TEXT NOT NULL CHECK (status IN ('planning', 'preparing', 'open', 'scheduled', 'completed', 'cancelled')),
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('public', 'internal')),
  capacity INTEGER CHECK (capacity IS NULL OR capacity >= 0),
  volunteer_target INTEGER NOT NULL DEFAULT 0 CHECK (volunteer_target >= 0),
  volunteer_count INTEGER NOT NULL DEFAULT 0 CHECK (volunteer_count >= 0),
  person_in_charge TEXT NOT NULL DEFAULT '',
  required_items TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
);

CREATE INDEX IF NOT EXISTS events_listing ON events (deleted_at, visibility, event_date);

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
