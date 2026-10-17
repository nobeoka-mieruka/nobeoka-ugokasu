-- 最新のお知らせ（news_items）。D1: nobeoka-staff / binding: STAFF_DB
--
-- server/newsItems.ts の NEWS_SCHEMA_SQL と同じ定義です（このファイルはそこから生成し、テストで一致を確認しています）。
-- アプリは最初のアクセス時にこの定義を自動で実行するため、手動での適用は必須ではありません。
-- 明示的に適用する場合：npm run d1:migrate
--
-- 既存のお知らせ6件（src/data/news.ts の3件と、src/content/news/ の記事3件の一覧表示分）を、
-- 移行元キー（source_key）付きで INSERT OR IGNORE により登録します。
-- 同じキーの行がすでにあれば何もしないため、管理画面で編集・削除した内容が上書き・復活することはありません。
--
-- IF NOT EXISTS・OR IGNORE のため、何度実行しても既存のテーブル・データは変わりません。DROP・DELETE は含めないでください。
-- category：activity_report（活動報告）／dialogue（意見交換会）／event（イベント）／notice（お知らせ）／site_update（サイト更新・既存データのみ）
-- 時刻：created_at・updated_at・deleted_at は UNIX時刻（秒）。deleted_at が入っている行は削除済み（論理削除）。

CREATE TABLE IF NOT EXISTS news_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT UNIQUE,
  published_on TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('activity_report', 'dialogue', 'event', 'notice', 'site_update')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  link_url TEXT NOT NULL DEFAULT '',
  is_published INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
);

CREATE INDEX IF NOT EXISTS news_items_listing ON news_items (deleted_at, is_published, published_on);

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

INSERT OR IGNORE INTO news_items (source_key, published_on, category, title, summary, link_url, is_published, display_order, created_at, updated_at, created_by, updated_by)
VALUES ('article:2026-07-16-voices-collection-started', '2026-07-16', 'notice', '「みんなの声」の募集を開始しました', '延岡市で暮らす中で感じている困りごとや、地域をより良くするためのご意見を募集しています。いただいた声は個人が特定されない形で整理し、今後の活動や提言に活用します。', '/news/2026-07-16-voices-collection-started/', 1, 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER), 'system:migration', 'system:migration');

INSERT OR IGNORE INTO news_items (source_key, published_on, category, title, summary, link_url, is_published, display_order, created_at, updated_at, created_by, updated_by)
VALUES ('article:2026-07-17-official-site-launch', '2026-07-17', 'site_update', '公式ホームページを公開しました', '「福富千恵と延岡を動かす会」の公式ホームページを公開しました。活動報告や政策、皆さまからのご意見などを発信していきます。', '/news/2026-07-17-official-site-launch/', 1, 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER), 'system:migration', 'system:migration');

INSERT OR IGNORE INTO news_items (source_key, published_on, category, title, summary, link_url, is_published, display_order, created_at, updated_at, created_by, updated_by)
VALUES ('article:2026-07-17-city-guide-diagnosis', '2026-07-17', 'site_update', '「延岡市役所 どこに行けばいい？診断」を公開しました', '質問に答えることで、相談内容に合った延岡市役所の窓口を確認できる案内ページを公開しました。本ページは市民の利便性向上を目的として独自に作成した非公式の案内です。', '/news/2026-07-17-city-guide-diagnosis/', 1, 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER), 'system:migration', 'system:migration');

INSERT OR IGNORE INTO news_items (source_key, published_on, category, title, summary, link_url, is_published, display_order, created_at, updated_at, created_by, updated_by)
VALUES ('news:2026-08-15-signboard-installed', '2026-08-15', 'activity_report', '看板を設置しました', '地域の皆さまに活動を知っていただくため、市内各所に看板を設置しました。設置にご協力いただいた皆さま、ありがとうございます。', 'https://www.facebook.com/122103979557398900/posts/122115573039398900', 1, 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER), 'system:migration', 'system:migration');

INSERT OR IGNORE INTO news_items (source_key, published_on, category, title, summary, link_url, is_published, display_order, created_at, updated_at, created_by, updated_by)
VALUES ('news:2026-08-25-signboards-added', '2026-08-25', 'activity_report', '新たに看板を設置しました', '新たに2か所へ看板を設置しました。設置場所をご提供いただいた皆さま、ご協力いただいた皆さまに御礼申し上げます。地域の皆さまに活動を知っていただけるよう、今後も情報発信を続けていきます。', 'https://www.facebook.com/122103979557398900/posts/122118395127398900', 1, 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER), 'system:migration', 'system:migration');

INSERT OR IGNORE INTO news_items (source_key, published_on, category, title, summary, link_url, is_published, display_order, created_at, updated_at, created_by, updated_by)
VALUES ('news:2026-09-07-site-update', '2026-09-07', 'site_update', 'ホームページを更新しました', '活動報告の表示、SNS投稿の自動反映、お問い合わせ先の整理、サイト内情報の見直しを行いました。最新の活動は活動報告ページからご覧いただけます。', '/activities/', 1, 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER), 'system:migration', 'system:migration');
