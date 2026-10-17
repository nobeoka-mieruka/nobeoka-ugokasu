# 最新のお知らせの管理（/staff/news/）

執行部ポータルからお知らせを登録すると、トップページ「最新のお知らせ」（新しいもの3件）と
お知らせ一覧 <https://nobeoka-ugokasu.pages.dev/news/> にすぐ反映されます。
カードのデザイン・配色・レイアウトは従来と同じです。

## 画面

| URL | 内容 |
|---|---|
| `/staff/news/` | 一覧（公開／非公開の切り替え・編集・削除） |
| `/staff/news/new/` | 新規登録 |
| `/staff/news/:id/edit/` | 編集 |

いずれもGoogleログイン（`STAFF_ALLOWED_EMAILS` に登録された方）が必要です。

## 入力項目

| 項目 | 内容 |
|---|---|
| 掲載日 | 新しい順に並びます。未来の日付にすると、その日になるまで公開ページに表示されません |
| カテゴリー | 活動報告／意見交換会／イベント／お知らせ。「サイト更新」は新規には使いません（既存の「ホームページを更新しました」などはそのまま残しています） |
| タイトル・概要 | カードにそのまま表示されます（タイトル100文字・概要300文字まで） |
| リンク先 | サイト内のページ（`/activities/`・`/dialogue/` など「/」で始まるパス）か、SNS投稿などの `https://` のURL。外部のURLは新しいタブで開き、`rel="noopener noreferrer"` を付けます。`javascript:` などは登録できません |
| 表示順 | 通常は 0（掲載日の新しい順）。上に表示したいお知らせは 0 より小さい数字（例：-1） |
| 公開 | チェックを外すと非公開（公開ページに表示しない） |

削除は「論理削除」です。一覧と公開ページからは消えますが、D1には行が残ります。

## 既存データの移行（2026年10月）

移行前は、次の3か所のお知らせをビルド時にまとめて表示していました。

| 取得元 | 件数 | 移行後 |
|---|---|---|
| `src/data/news.ts` の `newsEntries`（手書き） | 3件 | 内容をそのままD1へ移行し、ファイルからは削除 |
| `src/content/news/*.md`（記事ページあり） | 3件 | 一覧の表示分をD1へ移行（記事ページ `/news/<slug>/` はそのまま） |
| `src/data/socialNewsPromotions.ts`（SNS投稿の昇格） | 0件 | 仕組みはそのまま |

- 移行したお知らせには「移行元キー」（`news:<id>`・`article:<slug>`）が付いています。D1に同じキーがあるファイル由来のお知らせは表示しないので、二重表示になりません（D1側で削除・非公開にした場合も同様です）。
- 移行は `INSERT OR IGNORE` で1回だけ行われます。何度実行しても、管理画面で編集・削除した内容が上書き・復活することはありません。
- 今後 `src/content/news/` に記事を追加した場合は、D1に無いため自動的に一覧へ表示されます。
- SNS自動同期の投稿は、従来どおり「活動報告」にだけ表示されます。お知らせへ自動で複製することはありません。

## 仕組み（開発者向け）

- 保存先：Cloudflare D1（binding `STAFF_DB`）の `news_items`。操作の記録は `staff_audit_log`（`news.create`・`news.update`・`news.publish`・`news.delete`）。
- テーブルと移行データは最初のアクセス時に作成・登録されます。同じ定義を `migrations/0003_news_items.sql` に置いています（`server/newsItems.ts` の `NEWS_SCHEMA_SQL` から生成。明示的に適用する場合は `npm run d1:migrate`）。
- 公開ページ：`src/pages/index.astro`・`src/pages/news/index.astro` の静的HTMLを、`functions/index.ts`・`functions/news/index.ts` が配信時に差し替えます（共通処理 `server/newsPublic.ts`、HTMLは `src/utils/newsCards.ts`）。ファイル由来のお知らせはビルド時に `/news/file-items.json` へ出力し、配信時にD1の内容とまとめます。D1に障害がある場合は静的HTML（ファイル由来のお知らせのみ）のまま表示されます。
- 管理API：`/staff/api/news-items`（GET・POST）、`/staff/api/news-items/:id`（GET・PUT・PATCH・DELETE）。ログイン確認・Origin・CSRFトークンはミドルウェア、入力値は `server/newsItems.ts` で検証します。
- 他の機能からお知らせを作る場合は `createNewsItem(db, input, actor, sourceKey)` に一意の `sourceKey`（例：`event:<id>`）を渡してください。同じキーのお知らせは二重に作られません。
- テスト：`npm run test:news`
