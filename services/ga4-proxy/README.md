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
| 秘密情報の漏えい | Google のエラー本文・トークン・シークレットは応答にもログにも出さない（ログはイベント名と種類だけ）。ブラウザから直接呼べない（CORSを許可しない） |
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
| GA4用サービスアカウント（中継が使う） | GA4 プロパティの「閲覧者」 | GA4（設定済み） |
| 同上 | `roles/secretmanager.secretAccessor` | シークレット `ga4-proxy-hmac` だけ（プロジェクト全体には付けない） |
| 同上 | プロジェクトのロール | **付けない**（トークンはメタデータサーバーから取得でき、ログはCloud Runが自動で集める） |
| デプロイする人 | `roles/run.admin`・GA4用サービスアカウントへの `roles/iam.serviceAccountUser`・`roles/cloudbuild.builds.editor`・`roles/artifactregistry.admin`（初回のみ）・`roles/secretmanager.admin`（シークレット作成時） | プロジェクト（オーナーなら不要） |
| ビルド用サービスアカウント（`--source` のとき） | `roles/run.builder` | 組織ポリシー `iam.automaticIamGrantsForDefaultServiceAccounts` により既定のサービスアカウントに権限が付かない場合だけ、専用のものを作って付与 |

## 導入手順（承認後に、Cloud Shell で実行）

0. 確認（読み取りのみ）：`bash scripts/preflight.sh <GA4用サービスアカウント>`
1. 予算アラート（例：月300円で通知）を設定する。※予算アラートは通知だけで、自動では止まりません。**有料アカウントへのアップグレードはしません**（下の「無料トライアルの終了」を参照）
2. APIの有効化（2026年11月時点で有効化済み）：
   ```
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com --project=nobeoka-ugokasu-staff
   ```
3. シークレットを作る（値は画面に出さない）：
   ```
   head -c 48 /dev/urandom | base64 | tr -d '\n/+=' | gcloud secrets create ga4-proxy-hmac --data-file=- --replication-policy=user-managed --locations=asia-northeast1 --project=nobeoka-ugokasu-staff
   gcloud secrets add-iam-policy-binding ga4-proxy-hmac --member="serviceAccount:<SA>" --role=roles/secretmanager.secretAccessor --project=nobeoka-ugokasu-staff
   ```
4. デプロイ（このフォルダで）：`bash scripts/deploy.sh <SA>`
   - 無料枠を最大限使う設定（最小0・最大1インスタンス、要求を処理している間だけCPUを使う、256Mi、起動時のCPU増強なし）でデプロイし、
     古いコンテナイメージを自動で消す設定（`scripts/cleanup-policy.json`：最新2つを残し、7日より古いものを削除）も行います。
5. 確認：スクリプトの最後に表示される `healthz: 204`・`署名なしの POST: 401`
6. Cloudflare Pages（本番）に `GA4_PROPERTY_ID`・`GA4_PROXY_URL`・`GA4_PROXY_SECRET` を登録して再デプロイ。
   `GA4_PROXY_SECRET` は `gcloud secrets versions access latest --secret=ga4-proxy-hmac --project=nobeoka-ugokasu-staff` で取り出し、貼り付けたらすぐ画面を閉じる
7. /staff/analytics/ の「過去7日」が GA4 のレポートとおおむね一致することを確認

## 費用と無料枠

無料枠の数値は変わることがあるため、導入前に Google Cloud の料金ページで確認してください（以下は2026年11月時点の想定）。

| サービス | 使い方 | 無料枠に収めるための設定 |
|---|---|---|
| Cloud Run | KVキャッシュのおかげで月数千回以下の見込み（1回0.5秒程度） | 最小0・最大1インスタンス、リクエスト単位の課金（`--cpu-throttling`）、256Mi |
| Artifact Registry | コンテナイメージ（1つ数十MB） | 自動削除（最新2つを残す）で 0.5GB 以内 |
| Cloud Build | デプロイのたびに数分 | 毎月の無料のビルド時間の範囲内 |
| Secret Manager | シークレット1つ（版は2つまで） | 交換後は古い版を破棄して、有効な版を少なく保つ |
| Cloud Logging | 1回1行程度。不正な要求は1分に1行 | 無料の取り込み量の範囲内 |
| Cloud Storage | `--source` のアップロード（数十KB） | ほぼ0円（東京は無料枠の対象外のため、ごくわずかにかかる場合あり） |

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
