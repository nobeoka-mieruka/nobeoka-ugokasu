# 意見交換会の管理（/staff/dialogue/）

執行部ポータルから意見交換会の開催予定を登録すると、公開ページ <https://nobeoka-ugokasu.pages.dev/dialogue/> にすぐ反映されます。
参加申込は従来どおりGoogleフォーム（ページ内に埋め込み）で受け付けます。フォーム自体は変更していません。

## 画面

| URL | 内容 |
|---|---|
| `/staff/dialogue/` | 一覧（受付状況の変更・編集・削除） |
| `/staff/dialogue/new/` | 新規登録 |
| `/staff/dialogue/:id/edit/` | 編集 |

いずれもGoogleログイン（`STAFF_ALLOWED_EMAILS` に登録された方）が必要です。未ログインでは `/staff/login/` へ移動し、内容は返しません。

## 受付状況と公開ページの表示

| 受付状況 | 内部値 | 公開ページの表示 |
|---|---|---|
| 受付中 | `open` | 「参加を申し込む」ボタン（「参加申込を受け付ける」にチェックがある場合のみ。ない場合は「お申し込み開始までお待ちください」） |
| 受付終了 | `closed` | 「受付終了」 |
| 日程調整中 | `scheduling` | 「現在、新しい意見交換会の日程を調整しています」 |
| 開催済み | `completed` | 「今後の意見交換会」には出さず、「これまでの意見交換会」に表示 |

- 開催日を過ぎた回も、自動的に「これまでの意見交換会」へ移ります。
- 「公開ページに表示する」のチェックを外すと下書きとなり、公開ページには表示されません。
- 予定が1件もない場合は、従来どおり「現在、新しい意見交換会の日程を調整しています。」と表示します。
- 削除は「論理削除」です。一覧と公開ページからは消えますが、D1には行が残ります（誤って削除した場合は開発者が復元できます）。

## 仕組み（開発者向け）

- 保存先：Cloudflare D1（binding `STAFF_DB`）の `dialogue_events` テーブル。操作の記録は `staff_audit_log`（操作者のメールアドレスはD1内のみに保存し、サーバーログには操作の種類とIDだけを出します）。
- テーブルは最初のアクセス時に `CREATE TABLE IF NOT EXISTS` で作成されます。同じ定義を `migrations/0002_dialogue_events.sql` に置いています（明示的に適用する場合は `npm run d1:migrate`）。既存テーブルは変更しません。
- 公開ページ：`src/pages/dialogue.astro` の静的HTMLを、`functions/dialogue/index.ts` が配信時にD1の内容で差し替えます（HTMLの組み立ては `src/utils/dialogueSchedule.ts`。値はすべてHTMLエスケープ）。D1に障害がある場合は静的HTML（日程調整中の表示）のまま表示されます。
- 管理API：`/staff/api/dialogue-events`（GET・POST）、`/staff/api/dialogue-events/:id`（GET・PUT・PATCH・DELETE）。ログイン確認・送信元（Origin）・CSRFトークンは `functions/staff/_middleware.ts` が検証し、入力値は `server/dialogueEvents.ts` で検証します。
- 権限：現在は許可された全員が同じ権限です。役割を増やす場合は `server/staffPermissions.ts` を変更します。
- `src/utils/dialogueEvents.ts`・`src/utils/dialogueSchedule.ts` はFunctionsからも読み込むため、`siteConfig.ts` など実行環境に依存するファイルを import しないでください。
- テスト：`npm run test:dialogue`
