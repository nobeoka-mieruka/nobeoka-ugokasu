-- 資料（staff_documents）。D1: nobeoka-staff / binding: STAFF_DB
--
-- server/documents.ts の DOCUMENTS_SCHEMA_SQL と同じ定義です（このファイルはそこから生成し、テストで一致を確認しています）。
-- 執行部内部用の資料リンク集です（公開ページ・公開APIからは読みません）。保存するのはURLと説明だけで、ファイル本体は保存しません。
-- 将来ファイル本体を保存する場合は、Cloudflare R2 等に保存して storage_key 列を追加する形で拡張します。
-- category・document_type の値はアプリ側（src/types/documents.ts）で検証します（カテゴリーの追加にテーブルの変更は不要）。
-- 時刻：created_at・updated_at・deleted_at は UNIX時刻（秒）。deleted_at が入っている行は削除済み（論理削除）。
-- アプリは最初のアクセス時にこの定義を自動で実行するため、手動での適用は必須ではありません。
-- 明示的に適用する場合：npm run d1:migrate
--
-- IF NOT EXISTS のため、何度実行しても既存のテーブル・データは変わりません。DROP・DELETE は含めないでください。

CREATE TABLE IF NOT EXISTS staff_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  document_type TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
);

CREATE INDEX IF NOT EXISTS staff_documents_listing ON staff_documents (deleted_at, pinned, display_order);

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
