# 後援会執行部ポータル（/staff/）ログイン設定手順

後援会執行部ポータルには **Googleアカウント** でログインします。
パスワードはこのサイトでは保存・管理しません（Google側の2段階認証などがそのまま効きます）。
Googleでのログインに成功しても、`STAFF_ALLOWED_EMAILS` に登録されたメールアドレス以外は入れません。

> 秘密情報（クライアントシークレット・許可メールアドレス）は、Cloudflareの画面にだけ入力してください。
> Git・ソースコード・チャット・メールなどには書かないでください。

## 仕組み（概要）

| 項目 | 内容 |
|---|---|
| ログイン画面 | `/staff/login/`（フッター最下部の「管理者ログイン」から） |
| 認証方式 | Google OAuth 2.0 / OpenID Connect（認可コードフロー＋PKCE、state検証。IDトークンはGoogleの公開鍵（jwks_uri）でRS256署名を検証し、iss・aud・exp・iat・nonce・`email_verified=true` を確認） |
| 許可の判定 | サーバー側（Pages Functions）で `STAFF_ALLOWED_EMAILS` と照合 |
| セッション | Cloudflare D1（binding名 `STAFF_DB`）。IDは256bitの乱数、D1にはSHA-256ハッシュのみ保存。有効期限12時間 |
| Cookie | `staff_session`：HttpOnly / Secure / SameSite=Strict / Path=/staff |
| ログイン失敗の制限 | 同じIPアドレス、または同じアカウントで15分以内に5回失敗すると、15分間ログイン不可 |
| ログアウト | D1のセッションを即時削除 |
| SNS自動同期 | `/api/admin/sync-social-posts` は従来の秘密キー認証のまま（このログインとは無関係） |

設定が終わるまでは、誰もログインできない状態（「現在ログイン機能をご利用いただけません」）になります。

---

## 手順1〜3：Google Cloud Consoleの設定（11ステップ）

登録する値は次の2つだけです（本番URLは `src/config/siteUrl.ts` で一元管理しています）。

| 項目 | 値 |
|---|---|
| Authorized JavaScript origins（承認済みの JavaScript 生成元） | `https://nobeoka-ugokasu.pages.dev` |
| Authorized redirect URIs（承認済みのリダイレクト URI） | `https://nobeoka-ugokasu.pages.dev/staff/auth/callback` |

> **Client Secret（クライアントシークレット）は、Git・ソースコード・チャット・メール・メモ帳・ログ・
> スクリーンショットへ絶対に残さないでください。** Cloudflareの画面へ直接貼り付けるだけにします。

**ステップ1　Google Cloud Consoleを開く**
パソコンのブラウザで <https://console.cloud.google.com/> を開き、後援会事務局のGoogleアカウントでログインします。
初めての場合は利用規約への同意を求められます。

**ステップ2　新しいプロジェクトを作成する**
1. 画面上部（左上の「Google Cloud」ロゴの右）にある **プロジェクト選択ボタン** を押します。
2. 開いた画面の右上の **「新しいプロジェクト」** を押します。
3. プロジェクト名に `nobeoka-staff-login` など分かりやすい名前を入れ、**「作成」** を押します。
4. 画面上部のプロジェクト選択ボタンに、いま作ったプロジェクト名が表示されていることを確認します。

**ステップ3　Google Auth Platform（OAuth同意画面）を開く**
左上の **≡（メニュー）→「APIとサービス」→「OAuth 同意画面」** を開きます。
「Google Auth Platform はまだ構成されていません」と表示された場合は **「開始」** を押します。

**ステップ4　アプリ名を設定する**
- アプリ名：`福富千恵と延岡を動かす会 執行部ポータル`
- ユーザーサポートメール：後援会事務局のメールアドレスを選択
- 「次へ」を押します。

**ステップ5　対象ユーザーを設定する**
1. 対象（オーディエンス）：**「外部」** を選び、「次へ」を押します。
2. 連絡先情報：後援会事務局のメールアドレスを入力し、「次へ」を押します。
3. ポリシーへの同意にチェックを入れて **「作成」** を押します。
4. 左メニューの **「対象」（Audience）** を開き、公開ステータスの **「アプリを公開」** を押して「本番環境」にします。
   - このサイトが求める情報は `openid` と `email`（メールアドレスの確認）だけなので、Googleの審査は不要です。
   - 誰がポータルに入れるかは、このサイトの `STAFF_ALLOWED_EMAILS` で判定します。
   - 「テスト」のままにする場合は、執行部メンバー全員のGmailアドレスを「テストユーザー」にも登録してください
     （登録していない方はGoogleの画面でエラーになります）。

**ステップ6　OAuth Clientを作成する**
左メニューの **「クライアント」（Clients）→「＋クライアントを作成」** を押します。
（旧画面では「APIとサービス」→「認証情報」→「＋認証情報を作成」→「OAuth クライアント ID」）

**ステップ7　種類は「ウェブ アプリケーション」を選ぶ**
- アプリケーションの種類：**「ウェブ アプリケーション」**
- 名前：`執行部ポータル（本番）`

**ステップ8　Authorized JavaScript origins を登録する**
「承認済みの JavaScript 生成元」の **「＋URIを追加」** を押し、次の1行を入力します。
```
https://nobeoka-ugokasu.pages.dev
```

**ステップ9　Authorized redirect URIs を登録する**
「承認済みのリダイレクト URI」の **「＋URIを追加」** を押し、次の1行を入力します。
```
https://nobeoka-ugokasu.pages.dev/staff/auth/callback
```
- 1文字でも違うとログインできません（`https` で始める、末尾にスラッシュを付けない、`callback` の綴り）。

入力したら **「作成」** を押します。

**ステップ10　Client ID を取得する**
作成後に表示される **クライアントID**（`…apps.googleusercontent.com` で終わる文字列）を、
手順5の `GOOGLE_CLIENT_ID` に貼り付けます。あとから「クライアント」一覧でも確認できます。

**ステップ11　Client Secret を取得する**
同じ画面に表示される **クライアントシークレット** を、手順5の `GOOGLE_CLIENT_SECRET`（種類：シークレット）へ
**直接** 貼り付けます。
- この画面でしか表示されない場合があります。Cloudflareへの登録が終わるまで画面を閉じないでください。
- 紛失した場合は、同じクライアントの画面で「シークレットを追加」して再発行し、古いものを削除します。

> 独自ドメインへ移行した場合は、`src/config/siteUrl.ts` を変更し、ステップ8・9に新しいドメインのURL
> （例：`https://example.jp` と `https://example.jp/staff/auth/callback`）を追加してください。

## 手順4：Cloudflare D1データベースを作る

1. Cloudflareダッシュボード <https://dash.cloudflare.com/> を開きます。
2. 左メニューの **「ストレージとデータベース（Storage & Databases）」→「D1 SQL Database」** を開きます。
3. **「データベースを作成（Create Database）」** を押し、名前に `nobeoka-staff` と入力して作成します。
   - 表（テーブル）は、最初のログイン時に自動で作られます。SQLの実行は不要です。
   - 無料枠（1日あたり読み取り500万行・書き込み10万行）の範囲で十分に動作します。

## 手順5：Cloudflare Pagesに設定を追加する

Cloudflareダッシュボード → **Workers & Pages** → `nobeoka-ugokasu` → **設定（Settings）**

### 5-1. D1のバインディング（binding）

1. **「バインディング（Bindings）」→「追加（Add）」→「D1 データベース」** を選びます。
2. **変数名（Variable name）**：`STAFF_DB`（この名前でなければ動きません）
3. **D1 データベース**：手順4で作った `nobeoka-staff`
4. 保存します。

### 5-2. 環境変数・シークレット

**「変数とシークレット（Variables and Secrets）」→「追加（Add）」** で、本番環境（Production）に次の3つを登録します。

| 変数名 | 種類（Type） | 値 |
|---|---|---|
| `GOOGLE_CLIENT_ID` | テキスト（Text） | ステップ10のクライアントID（`…apps.googleusercontent.com` で終わる値） |
| `GOOGLE_CLIENT_SECRET` | **シークレット（Secret）** | ステップ11のクライアントシークレット |
| `STAFF_ALLOWED_EMAILS` | **シークレット（Secret）** | ログインを許可するメールアドレス。複数の場合はカンマ区切り（例：`example1@gmail.com,example2@gmail.com`）。前後の空白は無視され、大文字・小文字は区別しません |

- 「シークレット」にした値は、保存後は画面に表示されなくなります（変更は上書きで行います）。
- `STAFF_ALLOWED_EMAILS` には、各メンバーが **Googleにログインするときのメールアドレス** を入れてください。

### 5-3. 反映（再デプロイ）

設定はデプロイし直すと反映されます。**「デプロイ（Deployments）」** タブで最新のデプロイの「…」→
**「デプロイを再試行（Retry deployment）」** を押すか、mainブランチへ変更をpushしてください。

## 手順6：動作確認

1. スマートフォンかパソコンで `https://nobeoka-ugokasu.pages.dev/` を開き、フッター最下部の **「管理者ログイン」** を押す
2. **「Googleでログイン」** → 許可したGoogleアカウントでログイン → 「執行部ポータル」が表示され、「ログイン中：（メールアドレス）」が出る
3. **「ログアウト」** を押す → 「ログアウトしました。」と表示される
4. ブラウザの「戻る」や `/staff/` を直接開いても、ログイン画面に戻されることを確認
5. 許可していないGoogleアカウントでは「ログインできませんでした。」となることを確認

## ログインできないときの原因の調べ方

ログイン画面の表示は「ログインできませんでした」などの定型文だけです。原因の切り分けには、
アドレス欄の `?error=…` と、サーバーログ（`staff-login-failed`）を使います。

| `?error=` | 原因 | 主な対処 |
|---|---|---|
| `email_not_allowed` | Googleのログインは成功したが、`STAFF_ALLOWED_EMAILS` に含まれていない | 許可リストのメールアドレスを確認（ログの `allowlistWarnings` も参照） |
| `oauth_token_exchange` | Googleとのトークン交換が拒否された | ログの `googleError` が `invalid_client` なら Client ID / Secret の誤り、`redirect_uri_mismatch` ならリダイレクトURIの誤り |
| `id_token_invalid` | IDトークンの検証に失敗（ログの `check` に `signature`・`alg`・`kid`・`iss`・`aud`・`exp`・`iat`・`nonce` などの項目名） | `aud` なら `GOOGLE_CLIENT_ID` の誤り。`iat`/`exp` はやり直せば通ることが多い |
| `email_not_verified` | Googleアカウントのメールアドレスが未確認 | Googleアカウント側でメールアドレスを確認する |
| `state_invalid` | ログイン用の一時Cookieが届かない・一致しない（ログの `check`） | 本番URL（`https://nobeoka-ugokasu.pages.dev`）からログインし直す。10分以内に完了する |
| `config_error` | D1・Client ID・Secret・許可リストのいずれかが未設定（ログの `configured` に設定済み／未設定だけを記録） | 手順5を確認して再デプロイ |
| `d1_error` / `session_error` | D1への読み書き・セッション作成に失敗 | D1のバインディング `STAFF_DB` を確認 |

`allowlistWarnings` の意味：`fullwidth_separator`（全角カンマ「，」や読点「、」で区切っている）、
`quotes`（メールアドレスを引用符で囲んでいる）、`invalid_entry`（メールアドレスの形でない項目があり、無視した）。
全角カンマと引用符はそのままでも読み取れますが、半角カンマ区切りに直しておくことをおすすめします。

ログに記録するのは、上記の理由コード・項目名・許可リストとの一致有無と件数・GoogleのHTTPステータスとエラー種別だけです。
Client Secret・認可コード・トークン・Cookie・メールアドレスは記録しません。

**ログの見方**：Cloudflareダッシュボード → Workers & Pages → `nobeoka-ugokasu` → デプロイ（Deployments）→
本番のデプロイの「詳細を表示（View details）」→ **「関数（Functions）」→「リアルタイムログ（Real-time Logs）」→「ログストリームを開始」**。
ログストリームを開始してからログインを試します（開始前のログは表示されません）。
開発者は `npx wrangler pages deployment tail --project-name nobeoka-ugokasu --environment production` でも確認できます。

## メンバーの追加・削除（初回の管理者登録もこの方法）

- `STAFF_ALLOWED_EMAILS` を上書きして、再デプロイします（手順5-2・5-3）。
- 削除した方は、ログイン中であっても再デプロイ後の次の操作から締め出されます。

## パスワードの変更について

このサイトはパスワードを持ちません。パスワードの変更・2段階認証の設定は、各メンバーが
自分のGoogleアカウント（<https://myaccount.google.com/security>）で行います。
執行部メンバーには **Googleアカウントの2段階認証を必ず有効にする** ようお願いしてください。

## クライアントシークレットが漏れた疑いがある場合

1. Google Cloud Console → 認証情報（クライアント）→ 該当のクライアントでシークレットを追加（再発行）
2. Cloudflareの `GOOGLE_CLIENT_SECRET` を新しい値で上書きして再デプロイ
3. Google Cloud Consoleで古いシークレットを削除

## 開発者向けメモ

- 実装：`functions/staff/`（ミドルウェア・ログイン開始・コールバック・ログアウト）、`server/staffAuth.ts`、`server/googleOAuth.ts`
- テスト：`npm run test:staff-auth`
- `src/pages/staff/` はビルド時に静的HTMLになります。非公開データ（申込者の氏名・電話番号・フォーム回答・内部資料など）を
  ページのソースに直接書かず、`/staff/api/` 配下にAPIを作ってログイン後に取得してください（ミドルウェアで保護されます）。
- `/staff/` からの更新処理（POST・PUT・PATCH・DELETE）には、HTMLへ差し込まれる CSRF トークン
  （`<input name="csrf_token">` または `<meta name="staff-csrf-token">`）を `csrf_token` フィールドか
  `X-CSRF-Token` ヘッダーで送ってください。送らない場合は403になります。
- 将来の「意見交換会の日程を /staff/ から登録 → /dialogue/ へ反映」は、D1に日程テーブルを追加し、
  `/dialogue/` がビルド時またはページ表示時にその内容を読む形で拡張できます。
