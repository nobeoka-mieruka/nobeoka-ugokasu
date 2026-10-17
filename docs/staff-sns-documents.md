# SNS管理（/staff/sns/）・資料（/staff/documents/）

## SNS管理（/staff/sns/）

SNSへ投稿する機能ではありません。既存のSNS自動同期（Facebook・Instagram・Threads、約3分ごと）の状況を確認し、必要なときに手動で同期するための画面です。

| 表示 | 内容 |
|---|---|
| 状態 | 「連携中（正常）」「エラー」「未設定」「未同期」。**連携に必要な設定が無いSNSは「未設定」**と表示し、「連携中」とは表示しません |
| 保存済みの投稿 | 各SNSの、現在サイトに保存している投稿の件数 |
| 最終同期 | 最後に同期を実行した日時（自動・手動を問わない）と、最後に取得に成功した日時 |
| 公式アカウントを開く | 公式アカウントを新しいタブで開きます（URLは src/config/socialConfig.ts の設定） |
| 直近の取得投稿 | 公開ページの「活動報告」に表示しているものと同じ投稿（最大10件） |

### 今すぐ同期

- ボタンを押すと、サーバー側で既存の同期処理（`runSocialSync`。定期実行・`/api/admin/sync-social-posts` と同じ関数）を実行します。
  ブラウザから秘密キー付きのAPIを呼ぶことはなく、`SOCIAL_SYNC_SECRET`・`SOCIAL_CRON_SECRET`・`META_ACCESS_TOKEN` などは画面にも応答にも出ません。
- SNS側のAPI制限を考慮し、手動同期は**全体で60秒に1回まで**です（連打しても実行されません）。
- 結果は「成功／失敗」「取得件数」「同期日時」だけを表示します。失敗の詳細はサーバーログ（`social-sync`、トークンは伏せ字）で確認します。
- 手動同期の実行と結果は `staff_audit_log`（`sns.sync`）に記録します。

## 資料（/staff/documents/）

Google Drive・Google ドキュメント・Google スプレッドシート・PDF などの**資料へのリンク**を、執行部内で整理します。すべて執行部内部用で、公開ページには表示しません。

- 保存するのはタイトル・カテゴリー・説明・URL・種類・表示順・ピン留めだけです。サイト側から資料の中身を読み込んだり公開したりすることはありません。
- **誰が資料を見られるかは Google Drive 側の共有設定で決まります。** 執行部限定の資料は「リンクを知っている全員」ではなく、必要な方のGoogleアカウントだけに共有してください（画面にも注意書きを表示しています）。
- URLは `https://` のみ登録できます（`javascript:`・`data:`・`file:`・`http:` などは拒否）。「資料を開く」は新しいタブ（`rel="noopener noreferrer"`）で開きます。
- 種類はURLから自動判定します（drive.google.com → Google Drive、docs.google.com/document → ドキュメント、docs.google.com/spreadsheets → スプレッドシート、末尾が .pdf → PDF、その他のhttps → Webリンク、判定できない場合 → その他）。登録時に手動で選ぶこともできます。
- 一覧の並び：ピン留め → 表示順 → 更新の新しい順。カテゴリーで絞り込めます。
- カテゴリーを追加する場合は `src/types/documents.ts` の一覧に1行足すだけです（テーブルの変更は不要）。
- 削除は「論理削除」です（Google Drive 上の資料そのものは削除されません）。追加・編集・ピン留め・削除を `staff_audit_log` に記録します（URL・説明の内容は記録しません）。
- 将来ファイル本体をサイトに保存する場合は、Cloudflare R2 等に保存し、`staff_documents` に `storage_key` 列を追加して扱う形で拡張できます。

## 仕組み（開発者向け）

- SNS：`server/snsAdmin.ts`、API `GET /staff/api/sns/status`・`POST /staff/api/sns/sync`。連打防止は D1 の `staff_rate_limits`（migration `0006`）。既存の `server/socialSync.ts`・`functions/api/admin/sync-social-posts.ts`・Cron Worker は変更していません。
- 資料：`server/documents.ts`、`src/utils/documentType.ts`、API `/staff/api/documents`（GET・POST）・`/staff/api/documents/:id`（GET・PUT・PATCH・DELETE）。テーブル `staff_documents`（migration `0007`）。
- ログイン確認・Origin・CSRFトークンは `functions/staff/_middleware.ts` が検証します。
- テスト：`npm run test:sns-admin`・`npm run test:documents`
