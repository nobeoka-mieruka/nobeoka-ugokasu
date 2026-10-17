-- 後援会執行部ポータル：ログインセッションとログイン失敗回数（D1: nobeoka-staff / binding: STAFF_DB）
--
-- これらのテーブルは server/staffAuth.ts が最初のアクセス時に自動で作成します（すでに本番で作成済み）。
-- 記録のために同じ定義をここにも置いています。IF NOT EXISTS のため、何度実行しても既存のテーブル・データは変わりません。
-- DROP・DELETE は含めないでください。

CREATE TABLE IF NOT EXISTS staff_sessions (
  id_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS staff_sessions_expires ON staff_sessions (expires_at);

CREATE TABLE IF NOT EXISTS staff_login_failures (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  locked_until INTEGER NOT NULL
);
