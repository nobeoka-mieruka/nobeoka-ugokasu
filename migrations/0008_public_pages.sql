-- 公開済みページの記録（public_pages）。D1: nobeoka-staff / binding: STAFF_DB
--
-- server/pageAnnouncements.ts の PUBLIC_PAGES_SCHEMA_SQL と同じ定義です（テストで一致を確認しています）。
-- アプリは最初の検知時にこの定義を自動で実行するため、手動での適用は必須ではありません。
--
-- 新しいページの公開検知（/api/admin/detect-new-pages）が、サイトマップにあったページをここへ記録します。
-- ここに無いページがサイトマップに増えたとき、お知らせの下書き（非公開）を作ります。
-- IF NOT EXISTS のため、何度実行しても既存のテーブル・データは変わりません。DROP・DELETE は含めないでください。

CREATE TABLE IF NOT EXISTS public_pages (
  path TEXT PRIMARY KEY,
  first_seen_on TEXT NOT NULL,
  first_seen_commit TEXT,
  created_at INTEGER NOT NULL
);
