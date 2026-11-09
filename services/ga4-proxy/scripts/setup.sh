#!/bin/bash
# GA4 中継（Cloud Run）の本番導入を、Cloud Shell で1回の実行で行うスクリプトです。
#
#   bash scripts/setup.sh              確認 → 計画の表示 → 1回だけ承認（yes）→ 導入 → 動作テスト → 報告
#   bash scripts/setup.sh --check-only 確認と計画の表示だけ（何も変更しない）
#
# ・承認（yes）までは、読み取りと手元での自己テストだけを行い、Google Cloud には何も作成・変更しません。
# ・再実行できます。既にあるもの（シークレット・サービスアカウント・リポジトリ・権限・ログの除外設定）は再利用し、重複して作りません。
# ・重大なエラーが出たら、その場で止まります。公開後の安全性テストに失敗したら、自動で外部から届かない状態（ingress=internal）に戻します。
# ・シークレットの値は画面・ログ・レポートに出しません。JSON秘密鍵は作りません。有料アカウントへのアップグレードはしません。
# ・Cloudflare には接続しません（最後に、管理画面で行う設定を案内します）。
# ・結果は ~/ga4-proxy-setup-report.txt にも保存します（シークレットは含みません）。

set -uo pipefail
umask 077
export CLOUDSDK_CORE_DISABLE_PROMPTS=1 # 「APIを有効にしますか？」などの確認で止まらない（既定の「いいえ」になる）

PROJECT="nobeoka-ugokasu-staff"
REGION="asia-northeast1"
SERVICE="ga4-proxy"
PROPERTY_ID="546942310"
RUNTIME_SA="ga4-analytics-reader@${PROJECT}.iam.gserviceaccount.com"
BUILDER_ID="ga4-proxy-builder"
BUILDER_SA="${BUILDER_ID}@${PROJECT}.iam.gserviceaccount.com"
SECRET_NAME="ga4-proxy-hmac"
AR_REPO="ga4-proxy"
LOG_EXCLUSION="ga4-proxy-request-logs"
REQUIRED_APIS=(run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com analyticsdata.googleapis.com)
POLICIES=(
  iam.disableServiceAccountKeyCreation
  iam.automaticIamGrantsForDefaultServiceAccounts
  iam.allowedPolicyMemberDomains
  gcp.resourceLocations
  gcp.restrictServiceUsage
  gcp.restrictNonCmekServices
  run.allowedIngress
  run.allowedBinaryAuthorizationPolicies
)

CHECK_ONLY=0
[ "${1:-}" = "--check-only" ] && CHECK_ONLY=1

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE" || exit 1
REPORT="$HOME/ga4-proxy-setup-report.txt"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
exec > >(tee "$REPORT") 2>&1

RESULTS=()
PLAN=()
rec() { RESULTS+=("$1|$2|${3:-}"); printf '  [%s] %s%s\n' "$1" "$2" "${3:+ — $3}"; }
step() { printf '\n== %s ==\n' "$1"; }
summary() {
  printf '\n==================== 結果のまとめ ====================\n'
  local r s i d
  for r in "${RESULTS[@]}"; do
    IFS='|' read -r s i d <<<"$r"
    printf '%-8s %s%s\n' "[$s]" "$i" "${d:+（$d）}"
  done
  printf '\n（このまとめは %s にも保存しました。シークレットは含みません）\n' "$REPORT"
}
stop() {
  rec "停止" "$1" "${2:-}"
  printf '\n重大なエラーのため、ここで止めました。これまでに作成・変更したものはそのまま残ります（再実行すると続きから進みます）。\n'
  summary
  exit 1
}
# gcloud を実行し、失敗したらエラーの最後の数行だけを表示する（エラーにシークレットは含まれない）
run() {
  local label="$1"
  shift
  if "$@" >"$WORK/out" 2>"$WORK/err"; then return 0; fi
  printf '    %s に失敗しました：\n' "$label"
  tail -n 5 "$WORK/err" | sed 's/^/      /'
  return 1
}

printf 'GA4 中継（Cloud Run）の導入 %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
[ "$CHECK_ONLY" = 1 ] && printf '（確認だけのモード：何も変更しません）\n'

# ---------------------------------------------------------------- 1
step "1. Google Cloud の認証とプロジェクト"
command -v gcloud >/dev/null || stop "gcloud が見つかりません" "Cloud Shell で実行してください"
command -v node >/dev/null || stop "node が見つかりません" "Cloud Shell で実行してください"
ACCOUNT="$(gcloud config get-value account 2>/dev/null)"
[ -n "$ACCOUNT" ] || stop "Google Cloud にログインしていません" "gcloud auth login を実行してください"
rec OK "ログイン中のアカウント" "$ACCOUNT"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)' 2>/dev/null)"
[ -n "$PROJECT_NUMBER" ] || stop "プロジェクト $PROJECT を参照できません" "アカウントとプロジェクトを確認してください"
rec OK "プロジェクト" "$PROJECT"

# ---------------------------------------------------------------- 2
step "2. 課金と必要なAPI"
BILLING="$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null)"
case "$BILLING" in
  True | true) rec OK "課金" "有効（無料トライアルのクレジットを含む。有料アカウントへのアップグレードはしません）" ;;
  False | false) stop "課金が無効です" "Cloud Run を使えません" ;;
  *) rec 未確認 "課金の状態" "Cloud Billing API で読み取れませんでした（デプロイで失敗した場合は課金を確認してください）" ;;
esac
ENABLED="$(gcloud services list --enabled --project="$PROJECT" --format='value(config.name)' 2>/dev/null)"
[ -n "$ENABLED" ] || stop "有効なAPIの一覧を取得できません"
MISSING=()
for api in "${REQUIRED_APIS[@]}"; do grep -qx "$api" <<<"$ENABLED" || MISSING+=("$api"); done
[ ${#MISSING[@]} -eq 0 ] || stop "無効なAPIがあります" "${MISSING[*]}（このスクリプトはAPIを有効化しません）"
rec OK "必要なAPI（5つ）" "すべて有効"
grep -qx logging.googleapis.com <<<"$ENABLED" && LOGGING_API=1 || LOGGING_API=0

# ---------------------------------------------------------------- 3
step "3. 組織ポリシーと実行する人の権限"
# Organization Policy API（orgpolicy.googleapis.com）は使わず、従来の Resource Manager API で読む。
# 読めない制約は「未確認」として記録し、止まらずに次へ進む。
for c in "${POLICIES[@]}"; do
  if gcloud resource-manager org-policies describe "$c" --project="$PROJECT" --effective --format=json >"$WORK/policy.json" 2>"$WORK/err"; then
    IFS='|' read -r status text < <(node scripts/eval.mjs policy "$c" <"$WORK/policy.json")
    if [ "$status" = "NG" ]; then stop "組織ポリシー $c" "$text"; fi
    rec OK "組織ポリシー $c" "$text"
  else
    reason="読み取れません"
    # 「APIが無効」のときも PERMISSION_DENIED と一緒に返るため、より具体的な「APIが無効」を後で判定して優先する
    grep -qi "permission\|PERMISSION_DENIED" "$WORK/err" && reason="権限が無いため読み取れません"
    grep -qi "has not been used\|is disabled\|SERVICE_DISABLED" "$WORK/err" && reason="APIが無効のため読み取れません"
    rec 未確認 "組織ポリシー $c" "$reason"
  fi
done
rec 未確認 "組織ポリシー run.managed.requireInvokerIam" "従来のAPIでは読めない制約です。有効な場合はデプロイで失敗し、ここで止まります"

if gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" --filter="bindings.members:user:$ACCOUNT" --format='value(bindings.role)' >"$WORK/roles" 2>/dev/null; then
  if grep -qx "roles/owner" "$WORK/roles"; then
    rec OK "実行する人の権限" "オーナー"
  else
    NEED=(roles/run.admin roles/iam.serviceAccountUser roles/iam.serviceAccountAdmin roles/secretmanager.admin roles/resourcemanager.projectIamAdmin roles/cloudbuild.builds.editor roles/artifactregistry.admin)
    LACK=()
    for r in "${NEED[@]}"; do grep -qx "$r" "$WORK/roles" || LACK+=("$r"); done
    if [ ${#LACK[@]} -eq 0 ]; then rec OK "実行する人の権限" "必要なロールあり"; else rec 未確認 "実行する人の権限" "直接は付いていないロール：${LACK[*]}（グループ経由の場合あり。足りなければ途中で止まります）"; fi
  fi
else
  rec 未確認 "実行する人の権限" "IAMポリシーを読み取れません"
fi

# ---------------------------------------------------------------- 4
step "4. GA4 用サービスアカウント"
SA_DISABLED="$(gcloud iam service-accounts describe "$RUNTIME_SA" --project="$PROJECT" --format='value(disabled)' 2>/dev/null)" ||
  stop "GA4用サービスアカウントが見つかりません" "$RUNTIME_SA"
case "$SA_DISABLED" in True | true) stop "GA4用サービスアカウントが無効化されています" "$RUNTIME_SA" ;; esac
rec OK "サービスアカウント" "$RUNTIME_SA（有効）"
KEYS="$(gcloud iam service-accounts keys list --iam-account="$RUNTIME_SA" --project="$PROJECT" --managed-by=user --format='value(name)' 2>/dev/null | grep -c . || true)"
if [ "${KEYS:-0}" = "0" ]; then rec OK "ユーザー管理の秘密鍵" "0件（このスクリプトも作りません）"; else rec 注意 "ユーザー管理の秘密鍵" "${KEYS}件あります（使いません・削除もしません。不要なら管理者が削除してください）"; fi
SA_ROLES="$(gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" --filter="bindings.members:serviceAccount:$RUNTIME_SA" --format='value(bindings.role)' 2>/dev/null | tr '\n' ' ')"
if [ -z "${SA_ROLES// /}" ]; then rec OK "サービスアカウントのプロジェクトのロール" "なし（最小権限）"; else rec 注意 "サービスアカウントのプロジェクトのロール" "${SA_ROLES}（中継には不要です。このスクリプトは変更しません）"; fi
rec 未確認 "GA4 の「閲覧者」権限" "gcloud では確認できないため、手順9の実接続テストで確認します"

# ---------------------------------------------------------------- コードの検査と自己テスト
step "コードの検査と自己テスト（Google には接続しません）"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || stop "node のバージョンが古すぎます" "$(node --version)"
for f in src/proxy.mjs src/server.mjs src/main.mjs scripts/selftest.mjs scripts/remote-check.mjs scripts/eval.mjs scripts/eval-lib.mjs; do
  node --check "$f" 2>"$WORK/err" || stop "構文エラー" "$f"
done
if grep -rIl -- "-----BEGIN [A-Z ]*PRIVATE KEY-----" . >/dev/null 2>&1; then stop "秘密鍵のようなファイルがあります" "このフォルダに鍵を置かないでください"; fi
if node scripts/selftest.mjs >"$WORK/selftest" 2>&1; then
  rec OK "自己テスト" "$(grep -c '^OK' "$WORK/selftest")項目（署名・時刻・再送・レート制限・プロパティの固定・秘密情報を出さない）"
else
  sed 's/^/    /' "$WORK/selftest"
  stop "自己テストに失敗しました" "デプロイしません"
fi

# ---------------------------------------------------------------- 現在の状態と計画
step "現在の状態と、これから行う変更"
SECRET_EXISTS=0
SECRET_VERSIONS=0
SECRET_BOUND=0
if gcloud secrets describe "$SECRET_NAME" --project="$PROJECT" >/dev/null 2>&1; then
  SECRET_EXISTS=1
  SECRET_VERSIONS="$(gcloud secrets versions list "$SECRET_NAME" --project="$PROJECT" --filter='state=ENABLED' --format='value(name)' 2>/dev/null | grep -c . || true)"
  gcloud secrets get-iam-policy "$SECRET_NAME" --project="$PROJECT" --format=json 2>/dev/null | grep -q "serviceAccount:$RUNTIME_SA" && SECRET_BOUND=1
fi
BUILDER_EXISTS=0
gcloud iam service-accounts describe "$BUILDER_SA" --project="$PROJECT" >/dev/null 2>&1 && BUILDER_EXISTS=1
REPO_EXISTS=0
gcloud artifacts repositories describe "$AR_REPO" --project="$PROJECT" --location="$REGION" >/dev/null 2>&1 && REPO_EXISTS=1
SERVICE_URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.url)' 2>/dev/null || true)"
EXCLUSION_EXISTS=0
if [ "$LOGGING_API" = 1 ]; then
  gcloud logging sinks describe _Default --project="$PROJECT" --format='value(exclusions[].name)' 2>/dev/null | tr ';,' '\n\n' | grep -qx "$LOG_EXCLUSION" && EXCLUSION_EXISTS=1
fi

[ "$SECRET_EXISTS" = 1 ] && rec 既存 "シークレット $SECRET_NAME" "有効な版 ${SECRET_VERSIONS}件（再利用します。値は変えません）" ||
  PLAN+=("シークレット $SECRET_NAME を作成し、ランダムな値（約60文字）を登録する（東京リージョンに保存。値は表示しない）")
[ "$SECRET_EXISTS" = 1 ] && [ "${SECRET_VERSIONS:-0}" = "0" ] && PLAN+=("シークレット $SECRET_NAME に有効な値が無いため、新しい値を登録する")
[ "$SECRET_BOUND" = 1 ] || PLAN+=("GA4用サービスアカウントに、シークレット $SECRET_NAME だけを読む権限（secretAccessor）を付ける")
[ "$BUILDER_EXISTS" = 1 ] && rec 既存 "ビルド用サービスアカウント" "$BUILDER_SA" ||
  PLAN+=("ビルド専用のサービスアカウント $BUILDER_ID を作成する（鍵は作らない）")
PLAN+=("ビルド用サービスアカウントに、ログの書き込み（logging.logWriter）・ビルド元ファイルの読み取り（storage.objectViewer）・このリポジトリへのイメージの保存（artifactregistry.writer）だけを付ける（付いていれば何もしない）")
[ "$REPO_EXISTS" = 1 ] && rec 既存 "Artifact Registry" "$AR_REPO" ||
  PLAN+=("コンテナイメージの保存先 $AR_REPO（Artifact Registry・東京）を作成する")
PLAN+=("古いイメージを自動で消す設定（最新2つを残し、7日より古いものを削除。無料枠 0.5GB に収めるため）")
PLAN+=("Cloud Build でコンテナイメージを作る（既定のマシン。数分）")
if [ -n "$SERVICE_URL" ]; then
  rec 既存 "Cloud Run $SERVICE" "$SERVICE_URL（新しい版に更新します）"
  PLAN+=("Cloud Run $SERVICE を新しいイメージで更新する（設定は下と同じ）")
else
  PLAN+=("Cloud Run $SERVICE を作成し、インターネットから受け付ける状態で公開する（Googleのログイン確認は使わず、HMAC署名のない要求はすべて拒否）")
fi
PLAN+=("  設定：東京・最小0・最大1インスタンス・リクエスト単位のCPU・256Mi・同時10件・15秒・起動時のCPU増強なし・GA4用サービスアカウントで実行")
[ "$LOGGING_API" = 1 ] && [ "$EXCLUSION_EXISTS" = 0 ] && PLAN+=("中継へのアクセスログ（エラー以外）の95%を記録しない設定を追加する（ログの量を抑える。エラーは全件残す）")
PLAN+=("公開後に安全性テスト（署名なし・別のシークレット・古い時刻・再送の拒否）と、GA4 への実接続テストを行う。安全性テストに失敗したら、自動で外部から届かない状態に戻す")

printf '\n  承認（yes）すると、次のことを行います。\n'
for p in "${PLAN[@]}"; do printf '   ・%s\n' "$p"; done
printf '\n  行わないこと：有料アカウントへのアップグレード、APIの有効化、組織ポリシーの変更、JSON秘密鍵の作成、\n'
printf '              Cloudflare・本番D1・Facebook連携・Googleログインの変更\n'
printf '  費用：通常の利用は無料枠の範囲内の見込みです（0円は保証できません）。無料トライアル中はクレジットから差し引かれます。\n'

if [ "$CHECK_ONLY" = 1 ]; then
  rec 確認のみ "変更は行っていません" "bash scripts/setup.sh で導入できます"
  summary
  exit 0
fi

printf '\n'
read -r -p "上の変更を実行しますか？（実行する場合だけ yes と入力）: " ANSWER </dev/tty
if [ "$ANSWER" != "yes" ]; then
  rec 中止 "承認されなかったため、何も変更していません"
  summary
  exit 0
fi

# ---------------------------------------------------------------- 5
step "5. Secret Manager"
if [ "$SECRET_EXISTS" = 0 ]; then
  run "シークレットの作成" gcloud secrets create "$SECRET_NAME" --project="$PROJECT" \
    --replication-policy=user-managed --locations="$REGION" --labels=app=nobeoka-ugokasu,purpose=ga4-proxy ||
    stop "シークレットを作成できません"
  rec 作成 "シークレット $SECRET_NAME"
fi
if [ "$SECRET_EXISTS" = 0 ] || [ "${SECRET_VERSIONS:-0}" = "0" ]; then
  # 値はパイプで直接渡し、変数・画面・ログに残さない
  head -c 48 /dev/urandom | base64 | tr -d '\n/+=' |
    gcloud secrets versions add "$SECRET_NAME" --project="$PROJECT" --data-file=- >/dev/null 2>"$WORK/err" ||
    stop "シークレットの値を登録できません" "$(tail -n 1 "$WORK/err")"
  rec 作成 "シークレットの値" "ランダムな値を登録（表示していません）"
fi
run "シークレットの読み取り権限" gcloud secrets add-iam-policy-binding "$SECRET_NAME" --project="$PROJECT" \
  --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor --condition=None ||
  stop "シークレットの読み取り権限を付けられません"
rec OK "シークレットの読み取り権限" "GA4用サービスアカウント → $SECRET_NAME だけ"

# ---------------------------------------------------------------- 6
step "6. 最小権限の設定"
if [ "$BUILDER_EXISTS" = 0 ]; then
  run "ビルド用サービスアカウントの作成" gcloud iam service-accounts create "$BUILDER_ID" --project="$PROJECT" \
    --display-name="GA4 中継のビルド専用（鍵なし）" || stop "ビルド用サービスアカウントを作成できません"
  rec 作成 "ビルド用サービスアカウント" "$BUILDER_SA"
  sleep 15 # 作成直後は権限の付与に失敗することがあるため待つ
fi
for role in roles/logging.logWriter roles/storage.objectViewer; do
  run "ビルド用サービスアカウントへの $role" gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$BUILDER_SA" --role="$role" --condition=None ||
    stop "ビルド用サービスアカウントに $role を付けられません"
done
if [ "$REPO_EXISTS" = 0 ]; then
  run "Artifact Registry の作成" gcloud artifacts repositories create "$AR_REPO" --project="$PROJECT" --location="$REGION" \
    --repository-format=docker --description="GA4 中継のコンテナイメージ" --labels=app=nobeoka-ugokasu,purpose=ga4-proxy ||
    stop "Artifact Registry を作成できません"
  rec 作成 "Artifact Registry" "$AR_REPO"
fi
run "リポジトリへの書き込み権限" gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" --project="$PROJECT" --location="$REGION" \
  --member="serviceAccount:$BUILDER_SA" --role=roles/artifactregistry.writer ||
  stop "ビルド用サービスアカウントにリポジトリへの書き込み権限を付けられません"
rec OK "ビルド用サービスアカウントの権限" "ログの書き込み・ビルド元の読み取り・$AR_REPO への保存だけ"
if run "古いイメージの自動削除" gcloud artifacts repositories set-cleanup-policies "$AR_REPO" --project="$PROJECT" --location="$REGION" \
  --policy=scripts/cleanup-policy.json --no-dry-run; then
  rec OK "古いイメージの自動削除" "最新2つを残す"
else
  rec 未確認 "古いイメージの自動削除" "設定できませんでした（容量が増えたら手動で削除してください）"
fi
rec OK "GA4用サービスアカウントの権限" "追加なし（GA4の閲覧者とシークレットの読み取りだけ）"

# ---------------------------------------------------------------- 7
step "7. コンテナイメージの作成と Cloud Run のデプロイ"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}/${SERVICE}:$(date +%Y%m%d-%H%M%S)"
printf '  イメージを作成しています（数分かかります）…\n'
run "イメージの作成" gcloud builds submit . --project="$PROJECT" --region="$REGION" --config=cloudbuild.yaml \
  --substitutions="_IMAGE=$IMAGE" --service-account="projects/$PROJECT/serviceAccounts/$BUILDER_SA" ||
  stop "イメージを作成できません" "Cloud Build の権限・課金・組織ポリシーを確認してください"
rec OK "イメージの作成" "$IMAGE"
printf '  Cloud Run にデプロイしています…\n'
run "Cloud Run のデプロイ" gcloud run deploy "$SERVICE" --project="$PROJECT" --region="$REGION" --image="$IMAGE" \
  --service-account="$RUNTIME_SA" --no-invoker-iam-check --ingress=all \
  --set-env-vars="GA4_PROPERTY_ID=$PROPERTY_ID" --set-secrets="PROXY_HMAC_SECRET=${SECRET_NAME}:latest" \
  --min-instances=0 --max-instances=1 --cpu-throttling --no-cpu-boost --cpu=1 --memory=256Mi --execution-environment=gen1 \
  --concurrency=10 --timeout=15 --labels=app=nobeoka-ugokasu,purpose=ga4-proxy ||
  stop "Cloud Run にデプロイできません" "組織ポリシー（Googleのログイン確認の必須化）・権限・メモリの設定を確認してください"
SERVICE_URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
rec OK "Cloud Run のデプロイ" "$SERVICE_URL"
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=json >"$WORK/service.json" 2>/dev/null
IFS='|' read -r status text < <(node scripts/eval.mjs service "$RUNTIME_SA" <"$WORK/service.json")
rec "$status" "Cloud Run の設定" "$text"
if [ "$LOGGING_API" = 1 ] && [ "$EXCLUSION_EXISTS" = 0 ]; then
  FILTER="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\" AND logName:\"run.googleapis.com%2Frequests\" AND httpRequest.status<500 AND sample(insertId, 0.95)"
  if run "ログの抑制" gcloud logging sinks update _Default --project="$PROJECT" --add-exclusion="^|^name=$LOG_EXCLUSION|filter=$FILTER"; then
    rec OK "ログの抑制" "エラー以外のアクセスログの95%を記録しない"
  else
    rec 未確認 "ログの抑制" "設定できませんでした（ログの量は少ない見込みです）"
  fi
fi

# ---------------------------------------------------------------- 8・9
step "8・9. 安全性テストと GA4 への実接続テスト"
# シークレットは環境変数で子プロセスにだけ渡す（表示・保存しない）
PROXY_TEST_SECRET="$(gcloud secrets versions access latest --secret="$SECRET_NAME" --project="$PROJECT" 2>/dev/null)" ||
  stop "テスト用にシークレットを読み取れません"
PROXY_TEST_SECRET="$PROXY_TEST_SECRET" node scripts/remote-check.mjs "$SERVICE_URL"
CHECK_RC=$?
unset PROXY_TEST_SECRET
case "$CHECK_RC" in
  0)
    rec OK "安全性テスト" "署名なし・別のシークレット・古い時刻・再送はすべて拒否"
    rec OK "GA4 への実接続" "プロパティ $PROPERTY_ID の実データを取得（上の数値をポータル・GA4と照合してください）"
    ;;
  3)
    rec OK "安全性テスト" "署名なし・別のシークレット・古い時刻・再送はすべて拒否"
    rec NG "GA4 への実接続" "取得できません。上の案内（GA4の閲覧者の権限など）を確認し、もう一度 setup.sh を実行してください"
    ;;
  *)
    run "外部からの受け付けの停止" gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" --ingress=internal
    stop "安全性テストに失敗しました" "安全のため、中継を外部から届かない状態（ingress=internal）に戻しました"
    ;;
esac

# ---------------------------------------------------------------- 10
step "10. Cloudflare Pages に登録する設定（管理画面で手作業）"
cat <<EOF
  Cloudflare ダッシュボード → Workers & Pages → nobeoka-ugokasu → 設定 → 変数とシークレット → 本番（Production）に、
  3つとも種類「シークレット（暗号化）」で追加し、保存後に本番を再デプロイしてください（手順は services/ga4-proxy/CLOUDFLARE.md）。

    GA4_PROPERTY_ID   = $PROPERTY_ID
    GA4_PROXY_URL     = $SERVICE_URL
    GA4_PROXY_SECRET  = 次のコマンドで1回だけ表示して貼り付けてください（このレポートには含めていません）
                        bash scripts/show-secret.sh

  既存のシークレット（GOOGLE_CLIENT_SECRET・META_ACCESS_TOKEN など）は変更しないでください。
EOF
rec 手作業 "Cloudflare Pages への3つの登録と再デプロイ" "CLOUDFLARE.md の手順"

# ---------------------------------------------------------------- 11
step "11. 稼働確認"
HEALTH="$(curl -s -o /dev/null -w '%{http_code}' "$SERVICE_URL/healthz" || true)"
[ "$HEALTH" = "204" ] && rec OK "中継の稼働" "/healthz 204" || rec NG "中継の稼働" "/healthz $HEALTH"
KEYS_AFTER="$(gcloud iam service-accounts keys list --iam-account="$RUNTIME_SA" --project="$PROJECT" --managed-by=user --format='value(name)' 2>/dev/null | grep -c . || true)"
rec OK "ユーザー管理の秘密鍵（実行後）" "${KEYS_AFTER:-0}件（このスクリプトでは作成していません）"
summary
printf '\n次に行うこと：\n  1) bash scripts/show-secret.sh で値を表示し、Cloudflare に3つ登録して本番を再デプロイ\n  2) 執行部ポータル /staff/analytics/ で、上の「過去7日・30日・90日」の数値と一致することを確認（CLOUDFLARE.md の確認手順）\n'
