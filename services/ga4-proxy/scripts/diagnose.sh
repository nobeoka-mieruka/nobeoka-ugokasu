#!/bin/bash
# 執行部ポータルのアクセス解析が「未取得」（HTTP 502）になるときの診断です（Cloud Shell で実行・読み取りのみ）。
#   bash scripts/diagnose.sh [7d|30d|90d|today]
#
# 1) Cloud Run の設定（URL・受け付け状態・タイムアウト・最大インスタンス数・メモリ）を表示
# 2) ポータルと同じ3つの要求を、同じ署名方式で同時に中継へ送り、HTTP の状態・エラーの種類・所要時間を表示
# 3) 直近2日の中継のエラーログと、HTTP 400 以上のアクセスログを表示
#
# ・Google Cloud・Cloudflare・GA4 の設定は何も変更しません（gcloud の describe・logging read・secrets access だけ）。
# ・シークレットは環境変数で子プロセスに渡すだけで、画面・ファイルには出しません。GA4 の数値も表示しません。
# ・結果は ~/ga4-proxy-diagnose.txt にも保存します（シークレットは含みません）。

set -uo pipefail
umask 077
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

PROJECT="nobeoka-ugokasu-staff"
REGION="asia-northeast1"
SERVICE="ga4-proxy"
SECRET_NAME="ga4-proxy-hmac"
RANGE="${1:-7d}"
case "$RANGE" in 7d | 30d | 90d | today) ;; *) echo "使い方: bash scripts/diagnose.sh [7d|30d|90d|today]"; exit 1 ;; esac

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE" || exit 1
exec > >(tee "$HOME/ga4-proxy-diagnose.txt") 2>&1

printf '== 1. Cloud Run の設定 ==\n'
URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.url)' 2>/dev/null)"
if [ -z "$URL" ]; then
  echo "  Cloud Run $SERVICE が見つかりません（先に bash scripts/setup.sh を実行してください）"
  exit 1
fi
echo "  URL：$URL"
echo "  Cloudflare の GA4_PROXY_URL には、この URL を末尾の / やパスを付けずに登録します（別の URL でも同じサービスなら動作します）"
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=json 2>/dev/null |
  node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const j = JSON.parse(s), a = j.metadata?.annotations ?? {}, t = j.spec?.template ?? {}, ta = t.metadata?.annotations ?? {};
      const c = t.spec?.containers?.[0] ?? {};
      console.log("  受け付け（ingress）：" + (a["run.googleapis.com/ingress"] ?? "?"));
      console.log("  ほかの URL：" + ((j.status?.urls ?? []).join(" ") || "なし"));
      console.log("  最新の版：" + (j.status?.latestReadyRevisionName ?? "?") + "（すべての通信がこの版：" + ((j.status?.traffic ?? []).some((x) => x.latestRevision && x.percent === 100) ? "はい" : "いいえ") + "）");
      console.log("  タイムアウト：" + (t.spec?.timeoutSeconds ?? "?") + "秒、最大インスタンス：" + (ta["autoscaling.knative.dev/maxScale"] ?? "?") + "、メモリ：" + (c.resources?.limits?.memory ?? "?"));
      const env = (c.env ?? []).map((e) => e.name + (e.valueFrom ? "（Secret Manager）" : "=" + (e.name === "GA4_PROPERTY_ID" ? e.value : "設定あり")));
      console.log("  環境変数：" + env.join("、"));
    });'

printf '\n== 2. ポータルと同じ要求の再現（期間 %s） ==\n' "$RANGE"
PROXY_TEST_SECRET="$(gcloud secrets versions access latest --secret="$SECRET_NAME" --project="$PROJECT" 2>/dev/null)" || {
  echo "  シークレットを読み取れません"
  exit 1
}
PROXY_TEST_SECRET="$PROXY_TEST_SECRET" node scripts/portal-check.mjs "$URL" "$RANGE"
CHECK_RC=$?
unset PROXY_TEST_SECRET

printf '\n== 3. 中継のエラーログ（直近2日・新しい順に最大30件） ==\n'
gcloud logging read \
  "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\" AND (jsonPayload.event:\"ga4-proxy\" OR severity>=ERROR OR textPayload:\"Error\")" \
  --project="$PROJECT" --freshness=2d --limit=30 \
  --format='table(timestamp.date("%m-%d %H:%M:%S", tz="Asia/Tokyo"):label=日時,jsonPayload.event:label=記録,jsonPayload.kind:label=種類,jsonPayload.status:label=GA4の状態,jsonPayload.googleStatus:label=GA4のエラー,jsonPayload.reason:label=拒否の理由,jsonPayload.message:label=内容,textPayload:label=その他)' 2>/dev/null ||
  echo "  ログを読み取れません（ログを見る権限を確認してください）"

printf '\n== 4. HTTP 400 以上のアクセスログ（直近2日・最大30件。エラー以外の多くは記録しない設定です） ==\n'
gcloud logging read \
  "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\" AND logName:\"run.googleapis.com%2Frequests\" AND httpRequest.status>=400" \
  --project="$PROJECT" --freshness=2d --limit=30 \
  --format='table(timestamp.date("%m-%d %H:%M:%S", tz="Asia/Tokyo"):label=日時,httpRequest.status:label=状態,httpRequest.requestMethod:label=方式,httpRequest.requestUrl:label=URL,httpRequest.latency:label=所要時間)' 2>/dev/null ||
  echo "  ログを読み取れません"

printf '\n== 判定の目安 ==\n'
cat <<'EOF'
  ・2. がすべて OK なのにポータルが「未取得」 → Cloudflare 側（GA4_PROXY_URL の値・本番への再デプロイ）を確認
  ・HTTP 502 / upstream_error（GA4 400）     → GA4 が要求の内容を受け付けていない（3. の「GA4のエラー」「内容」を確認）
  ・HTTP 502 / upstream_forbidden           → GA4 の閲覧者の権限
  ・HTTP 400 / bad_request                  → 中継の本文の検査で拒否（中継とポータルの版の違い）
  ・HTTP 404 / JSON ではない応答             → URL のパスの誤り、または Cloud Run 本体のエラー
  ・HTTP 504・503 / 15秒で応答なし            → 起動の遅れ・タイムアウト
EOF
echo
echo "結果は ~/ga4-proxy-diagnose.txt にも保存しました（シークレット・GA4 の数値は含みません）。"
exit "$CHECK_RC"
