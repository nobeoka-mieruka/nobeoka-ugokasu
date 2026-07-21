# YouTube連携 設定手順書

このドキュメントは、「福富千恵と延岡を動かす会」公式ホームページのトップページ・`/videos` ページに、YouTubeチャンネルの最新動画を自動的に反映させるための設定手順です。

コード側の実装（Cloudflare Pages Functions・Cloudflare KVキャッシュ・トップページ「最新の動画」セクション・`/videos` ページ）はすでに完了しています。**残っているのは、この手順書に沿ったYouTube側でのID確認・APIキー発行と、Cloudflare Pagesへの登録作業のみです。**

---

## 1. 必要な環境変数

Cloudflare Pagesの管理画面から、次の3つの値を登録します（登録方法は[3. Cloudflare Pagesへの登録方法](#3-cloudflare-pagesへの登録方法)を参照）。

| 変数名 | 種類 | 用途 |
|---|---|---|
| `YOUTUBE_API_KEY` | **Secret（暗号化）** | YouTube Data API v3を呼び出すためのAPIキー |
| `YOUTUBE_CHANNEL_ID` | 通常の変数 | チャンネルページへのリンク表示に使用（例：`UCxxxxxxxxxxxxxxxxxxxxxx`） |
| `YOUTUBE_UPLOADS_PLAYLIST_ID` | 通常の変数 | 動画一覧の取得元となる「アップロード動画」プレイリストID |

`SOCIAL_POSTS_KV`（Facebook・Instagram連携で使用しているKV名前空間）をそのまま流用するため、YouTube用に新しいKV名前空間を追加作成する必要はありません。

---

## 2. 値の確認方法

### YouTube Data APIキー（`YOUTUBE_API_KEY`）

1. [Google Cloud Console](https://console.cloud.google.com/) にログインする（チャンネル運用者のGoogleアカウントで可）
2. プロジェクトを1つ作成（または既存のものを選択）する
3. 「APIとサービス」→「ライブラリ」で「YouTube Data API v3」を検索し、有効化する
4. 「APIとサービス」→「認証情報」→「認証情報を作成」→「APIキー」でキーを発行する
5. 発行したキーは「制限を設定」しておくことを推奨します（アプリケーションの制限、API制限を「YouTube Data API v3」のみに限定するなど）

### チャンネルID（`YOUTUBE_CHANNEL_ID`）

1. 対象のYouTubeチャンネルを開く
2. チャンネルの「概要」→「共有」→「チャンネルID をコピー」、または チャンネルURLが `https://www.youtube.com/channel/UCxxxxxxxx` 形式の場合はその `UCxxxxxxxx` の部分
3. カスタムURL（`@チャンネル名`）しか分からない場合は、[YouTube Data API - Channels: list](https://developers.google.com/youtube/v3/docs/channels/list) を `forHandle` パラメータで実行して確認する

### アップロード用プレイリストID（`YOUTUBE_UPLOADS_PLAYLIST_ID`）

チャンネルIDの先頭2文字 `UC` を `UU` に置き換えるだけで、そのチャンネルの「アップロード動画」プレイリストIDになります（YouTube仕様）。

例：チャンネルIDが `UCxxxxxxxxxxxxxxxxxxxxxx` の場合、アップロード用プレイリストIDは `UUxxxxxxxxxxxxxxxxxxxxxx` です。

不安な場合は、[YouTube Data API - Channels: list](https://developers.google.com/youtube/v3/docs/channels/list)（`part=contentDetails`）を実行し、`contentDetails.relatedPlaylists.uploads` の値を確認してください。

---

## 3. Cloudflare Pagesへの登録方法

1. Cloudflareダッシュボード →「Workers & Pages」→ 対象のPagesプロジェクトを開く
2. 「Settings」→「Environment variables」（または「Variables and Secrets」）を開く
3. **Production環境**を選択し、上記3つの値を登録する（`YOUTUBE_API_KEY` は必ずSecretとして登録する）
4. 登録後、「Deployments」タブから最新のデプロイを「Retry deployment」するか、リポジトリへ何か変更をpushして再デプロイする（環境変数は保存しただけでは反映されません）

Preview環境でも確認したい場合は、同じ値をPreview環境にも個別に登録してください。

---

## 4. 動作確認

1. `https://<本番ドメイン>/api/youtube-feed` を直接開き、`videos` に動画が入っているか、`status` が `"ok"` になっているか確認する（`"not_configured"` の場合は環境変数が未登録、`"error"` の場合は取得に失敗している状態です。APIキーの中身やエラー全文はレスポンスに含まれません）
2. トップページの「最新の動画」セクション、`/videos` ページで、それぞれサムネイル・再生アイコン・タイトル・公開日が表示されることを確認する
3. サムネイルをクリックし、YouTube側が新しいタブで開くことを確認する（ホームページ内で自動再生されないことも確認する）

キャッシュは約30分単位で更新されます（動画はSNS投稿ほど頻繁に増えないため、Facebook投稿より長めに設定しています）。未設定の間は、トップページ・`/videos` ページともに「動画は準備中です」という案内が表示され、サイト全体がエラーになることはありません。
