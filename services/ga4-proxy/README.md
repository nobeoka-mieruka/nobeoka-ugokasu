# GA4 中継（Cloud Run）

執行部ポータル「アクセス解析」（/staff/analytics/）が、**サービスアカウントの秘密鍵を使わずに** GA4 Data API を読むための小さな中継です。
親組織の組織ポリシー `iam.disableServiceAccountKeyCreation` によって JSON 鍵を作れないため、この方式にしています（組織ポリシーは変更しません）。

```
執行部のブラウザ ──(ログイン必須)──▶ Cloudflare Pages Functions /staff/api/analytics
                                         │ KVキャッシュ（1時間・今日は15分）。無ければ ↓
                                         │ POST https://<中継>/v1/runReport | /v1/batchRunReports
                                         │   X-Ga4-Proxy-Timestamp / X-Ga4-Proxy-Nonce / X-Ga4-Proxy-Signature（HMAC-SHA256）
                                         ▼
                                   Cloud Run「ga4-proxy」（このフォルダ）
                                         │ 署名・時刻・nonce・レート制限・本文を確認
                                         │ メタデータサーバーから、割り当てたサービスアカウントのトークンを取得（鍵なし）
                                         ▼
                                   GA4 Data API（プロパティ 546942310 に固定。サービスアカウントは「閲覧者」）
```

- 追加パッケージなし（Node 22 の標準機能だけ）。コード：`src/proxy.mjs`（本体）・`src/server.mjs`（HTTP）・`src/main.mjs`（起動）
- Cloudflare 側：`server/ga4Proxy.ts`（署名）・`server/ga4Analytics.ts`（中継方式の呼び出し）
- テスト：リポジトリの最上位で `npm run test:ga4-proxy`（偽物のGoogleを使い、実際のGoogleへは接続しません）

## 安全のための仕組み

| 脅威 | 対策 |
|---|---|
| インターネットからの直接の呼び出し | すべての要求に HMAC-SHA256 の署名が必要（シークレットは Secret Manager と Cloudflare の暗号化シークレットにだけ保存）。署名が無い・違うものは 401 で、GA4 もメタデータサーバーも呼ばない。理由は返さない |
| 盗み見た要求の再送 | 署名に時刻と nonce（使い捨ての値）を含める。時刻のずれは ±120秒まで、同じ nonce は2回目以降を拒否（最大1インスタンスで動かすため、記録はインスタンス内で完結） |
| 改ざん | 署名の対象に、メソッド・パス・本文のSHA-256を含める |
| 別のデータを読まれる | 転送できるのは `runReport`・`batchRunReports` だけ。プロパティIDは中継の設定で固定し、本文で別のプロパティを指定すると 400 |
| 大量の呼び出し・過剰な課金 | 署名が正しい要求だけを数え、1分60回・1日2000回まで（超えたら 429）。本文は32KBまで、1レポート1000行まで、batchは5件まで。Cloud Run は最大1インスタンス・最小0（使わない間は課金されない）・タイムアウト15秒 |
| ログの肥大化 | 不正な要求のログは1分に1件と件数のまとめだけ |
| 秘密情報の漏えい | トークン・シークレットは応答にもログにも出さない。Google のエラー本文は応答に出さず、Cloud Run のログにだけエラーの種類（`INVALID_ARGUMENT` など）と、HTTP 400 のときの短い説明文（どの項目が不正か。長い英数字は伏せる・200文字まで）を残す。ブラウザから直接呼べない（CORSを許可しない） |
| シークレットの交換 | `PROXY_HMAC_SECRET_PREVIOUS` に古い値を入れておけば、切り替え中も止まらない |
| 数値の捏造 | GA4 の応答をそのまま返すか、エラーの種類だけを返す。Cloudflare 側は失敗時に「データは未取得です」、設定不足時に設定手順だけを表示する（従来どおり） |

## 中継の設定（Cloud Run の環境変数）

| 名前 | 値 | 保存先 |
|---|---|---|
| `GA4_PROPERTY_ID` | `546942310` | 環境変数（秘密ではない） |
| `PROXY_HMAC_SECRET` | 32文字以上のランダムな値 | **Secret Manager**（`ga4-proxy-hmac`） |
| `PROXY_HMAC_SECRET_PREVIOUS` | 切り替え中だけ、古い値 | Secret Manager（任意） |
| `PROXY_RATE_PER_MINUTE`・`PROXY_RATE_PER_DAY` | 既定は 60・2000 | 環境変数（任意） |

Cloudflare Pages（本番）には、`GA4_PROPERTY_ID`・`GA4_PROXY_URL`（Cloud Run の URL）・`GA4_PROXY_SECRET`（上と同じ値）を「暗号化」で登録します。
`GA4_SERVICE_ACCOUNT_EMAIL`・`GA4_SERVICE_ACCOUNT_PRIVATE_KEY` は不要です。

## 必要な最小権限

| 誰に | 何を | 範囲 |
|---|---|---|
| GA4用サービスアカウント `ga4-analytics-reader`（中継が実行時に使う） | GA4 プロパティの「閲覧者」 | GA4（設定済み） |
| 同上 | `roles/secretmanager.secretAccessor` | シークレット `ga4-proxy-hmac` だけ（プロジェクト全体には付けない） |
| 同上 | プロジェクトのロール | **付けない**（トークンはメタデータサーバーから取得でき、ログは Cloud Run が自動で集める） |
| ビルド専用サービスアカウント `ga4-proxy-builder`（setup.sh が作成。鍵なし） | `roles/logging.logWriter`・`roles/storage.objectViewer` | プロジェクト（ビルドのログの書き込みと、アップロードしたビルド元の読み取り） |
| 同上 | `roles/artifactregistry.writer` | リポジトリ `ga4-proxy` だけ |
| 実行する人 | オーナー、または `run.admin`・`iam.serviceAccountUser`・`iam.serviceAccountAdmin`・`secretmanager.admin`・`resourcemanager.projectIamAdmin`・`cloudbuild.builds.editor`・`artifactregistry.admin` | プロジェクト |

- Cloud Run は「Googleのログイン確認（呼び出し元のIAM）」を使わず（`--no-invoker-iam-check`）、HMAC 署名で守ります。Cloudflare は Google の認証トークンを作れないためです。
- 既定の Compute Engine サービスアカウントや Cloud Build の既定のサービスアカウントには、権限を追加しません。

## 導入手順（Cloud Shell で1回実行）

```
git clone --depth 1 https://github.com/nobeoka-mieruka/nobeoka-ugokasu.git ~/nobeoka-ugokasu 2>/dev/null || git -C ~/nobeoka-ugokasu pull --ff-only; cd ~/nobeoka-ugokasu/services/ga4-proxy && bash scripts/setup.sh
```

`scripts/setup.sh` は次の順に進みます。**手順4までと自己テストは読み取りだけ**で、変更の一覧を表示してから1回だけ `yes` の入力を求めます。

1. Google Cloud の認証とプロジェクトの確認
2. 課金と必要な5つのAPIの確認（APIの有効化はしません）
3. 組織ポリシー（Organization Policy API が無効でも、従来の Resource Manager API で読む。読めないものは「未確認」として続行）と、実行する人の権限
4. GA4用サービスアカウント（有効か・ユーザー管理の鍵が0件か・余分なロールが無いか）
- コードの構文チェックと自己テスト（`scripts/selftest.mjs`：署名・時刻・再送・レート制限など。Google には接続しない）
- 現在の状態（既にあるものは再利用）と、これから行う変更の一覧 → **承認（yes）**
5. Secret Manager：シークレットが無ければ作成してランダムな値を登録（値は表示しない）、GA4用サービスアカウントに読み取り権限
6. 最小権限：ビルド専用サービスアカウント、Artifact Registry（東京）と古いイメージの自動削除
7. Cloud Build でイメージを作成 → Cloud Run にデプロイ → 設定が想定どおりかを確認 → エラー以外のアクセスログの95%を記録しない設定
8. 安全性テスト（`scripts/remote-check.mjs`）：署名なし・別のシークレット・古い時刻・再送の拒否、対象外のメソッドの404。**失敗したら自動で ingress=internal に戻して停止**
9. GA4 への実接続テスト：ポータルと同じ期間（日本時間で昨日まで）の過去7日・30日・90日の合計、上位ページ、申込ボタンのクリック数、content_type の登録状況を表示
10. Cloudflare Pages に登録する3つの値の案内（シークレットの値は `bash scripts/show-secret.sh` で1回だけ表示）
11. 稼働確認と結果のまとめ（`~/ga4-proxy-setup-report.txt` にも保存。シークレットは含まない）

- 確認だけ：`bash scripts/setup.sh --check-only`（何も変更しない）
- 再実行できます。2回目以降は、既存のシークレット（値は変えない）・サービスアカウント・リポジトリを再利用し、イメージを作り直して Cloud Run を更新します。
- その後の Cloudflare の設定と本番の確認は **`CLOUDFLARE.md`** を参照してください。

## 費用と無料枠

無料枠の数値は変わることがあるため、導入前に Google Cloud の料金ページで確認してください（以下は2026年11月時点の想定）。

| サービス | 使い方 | 無料枠に収めるための設定 |
|---|---|---|
| Cloud Run | KVキャッシュのおかげで月数千回以下の見込み（1回0.5秒程度） | 最小0・最大1インスタンス、リクエスト単位の課金（`--cpu-throttling`）、256Mi |
| Artifact Registry | コンテナイメージ（1つ数十MB） | 自動削除（最新2つを残す）で 0.5GB 以内 |
| Cloud Build | デプロイのたびに数分 | 既定のマシン（e2-standard-2）で、毎月の無料のビルド時間の範囲内 |
| Secret Manager | シークレット1つ（版は2つまで） | 交換後は古い版を破棄して、有効な版を少なく保つ |
| Cloud Logging | 1回1行程度。不正な要求は1分に1行 | 無料の取り込み量の範囲内 |
| Cloud Storage | ビルド元のアップロード（数十KB） | ほぼ0円（東京は無料枠の対象外のため、ごくわずかにかかる場合あり） |

- 通常の利用なら、ほぼ0円（無料トライアルのクレジットもほとんど減らない）の見込みです。
- 最大1インスタンスにしているため、署名の無い要求を1か月休まず送り続けられた最悪の場合でも、費用には上限があります（概算で月1万円程度。この場合も、無料トライアル中はクレジットから差し引かれます）。予算アラートで早めに気づけるようにしてください。

## 無料トライアルの終了（2026年12月31日）

- Google Cloud の無料トライアルは **2026年12月31日** に終了します（残高を使い切った場合はそれより前）。
  **有料アカウントにアップグレードしない場合、終了と同時に Cloud Run の中継は止まり、アクセス解析のデータは取得できなくなります。**
- 止まっても、/staff/analytics/ は数値を推定・表示せず、「データは未取得です」と表示します（他のページ・機能には影響しません）。
- 執行部ポータルの /staff/analytics/ には、終了日と残り日数の案内を表示します（30日前から注意表示、終了後は「止まっている可能性」の案内）。
  設定は `src/config/analyticsRelayConfig.ts`（有料アカウントに切り替えたら `plan` を `"paid"` に変更）。
- 続けるかどうかは、終了日までに管理者が判断してください（有料アカウントに切り替えても、通常の利用なら無料枠の範囲内の見込みです）。

## シークレットの交換（年1回程度）

1. 新しい版を追加：`… | gcloud secrets versions add ga4-proxy-hmac --data-file=-`
2. 古い版を `PROXY_HMAC_SECRET_PREVIOUS` に指定して再デプロイ（`--update-secrets=PROXY_HMAC_SECRET=ga4-proxy-hmac:latest,PROXY_HMAC_SECRET_PREVIOUS=ga4-proxy-hmac:<古い版の番号>`）
3. Cloudflare の `GA4_PROXY_SECRET` を新しい値にして再デプロイ
4. `PROXY_HMAC_SECRET_PREVIOUS` を外して再デプロイし、古い版を無効化：`gcloud secrets versions disable <古い版の番号> --secret=ga4-proxy-hmac`

## 止めたいとき

- すぐ止める（インターネットから届かなくする）：`gcloud run services update ga4-proxy --region=asia-northeast1 --ingress=internal --project=nobeoka-ugokasu-staff`
- 完全にやめる：`gcloud run services delete ga4-proxy --region=asia-northeast1 --project=nobeoka-ugokasu-staff`
- シークレットの版を無効化しても、動いているインスタンスは起動時に読んだ値を使い続けます。漏れた疑いがあるときは、上の交換手順で新しい値にしてから再デプロイしてください
- Cloudflare 側は `GA4_PROXY_URL` を消して再デプロイすると、画面は「未設定」の案内に戻ります（数値は出ません）
