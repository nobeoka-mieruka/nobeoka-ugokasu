-- タスク（tasks）。D1: nobeoka-staff / binding: STAFF_DB
--
-- server/tasks.ts の TASKS_SCHEMA_SQL と同じ定義です（このファイルはそこから生成し、テストで一致を確認しています）。
-- アプリは最初のアクセス時にこの定義を自動で実行するため、手動での適用は必須ではありません。
-- 明示的に適用する場合：npm run d1:migrate
--
-- 執行部内だけで使うテーブルです（公開ページ・公開APIからは読みません）。
-- completed：1＝完了（進捗は必ず100）／0＝未完了（進捗は0〜90）。progress_before_completion は完了直前の進捗（未完了に戻すときに使う）。
-- assignee は自由記入。将来メンバー管理を追加する場合は、列を追加して選択式にします（既存の値はそのまま）。
--
-- IF NOT EXISTS のため、何度実行しても既存のテーブル・データは変わりません。DROP・DELETE は含めないでください。
-- 時刻：created_at・updated_at・completed_at・deleted_at は UNIX時刻（秒）。deleted_at が入っている行は削除済み（論理削除）。

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  assignee TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  notes TEXT NOT NULL DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  completed_at INTEGER,
  completed_by TEXT,
  progress_before_completion INTEGER CHECK (progress_before_completion IS NULL OR (progress_before_completion >= 0 AND progress_before_completion <= 100)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
);

CREATE INDEX IF NOT EXISTS tasks_listing ON tasks (deleted_at, completed, due_date);

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
