// setup.sh の判定ロジック（eval.mjs から使う。テストからも読み込む）。秘密情報は扱わない。

const REQUIRED_APIS = ["run.googleapis.com", "cloudbuild.googleapis.com", "artifactregistry.googleapis.com", "secretmanager.googleapis.com", "analyticsdata.googleapis.com"];
/** 組織ポリシーの判定（従来の Resource Manager API の形式：booleanPolicy / listPolicy） */
export function evaluatePolicy(constraint, policy) {
  const name = constraint.replace(/^constraints\//, "");
  const list = policy.listPolicy ?? null;
  const enforced = policy.booleanPolicy?.enforced === true;
  const allowed = list?.allowedValues ?? [];
  const denied = list?.deniedValues ?? [];
  const allValues = list?.allValues ?? "";
  const restricted = allowed.length > 0 || denied.length > 0 || allValues === "DENY";
  switch (name) {
    case "iam.disableServiceAccountKeyCreation":
      return ["OK", enforced ? "鍵の作成は禁止（この方式は鍵を使わないので影響なし）" : "鍵の作成は禁止されていない（この方式は鍵を作らない）"];
    case "iam.automaticIamGrantsForDefaultServiceAccounts":
      return ["OK", enforced ? "既定のサービスアカウントに権限が自動で付かない（専用のビルド用サービスアカウントを使うので影響なし）" : "制限なし"];
    case "iam.allowedPolicyMemberDomains":
      return ["OK", restricted ? "メンバーのドメインが制限されている（allUsers を使わない構成なので影響なし）" : "制限なし"];
    case "gcp.resourceLocations": {
      if (allValues === "DENY") return ["NG", "すべてのリージョンが禁止されている"];
      const tokyo = (v) => /asia-northeast1|jp-locations|asia-locations/.test(v);
      if (denied.some(tokyo)) return ["NG", `東京（asia-northeast1）が禁止されている：${denied.join(", ")}`];
      if (allowed.length > 0 && !allowed.some(tokyo)) return ["NG", `東京（asia-northeast1）が許可リストに無い：${allowed.join(", ")}`];
      return ["OK", allowed.length > 0 ? `東京を含む：${allowed.join(", ")}` : "制限なし"];
    }
    case "run.allowedIngress":
      if (allValues === "DENY" || denied.includes("all") || (allowed.length > 0 && !allowed.includes("all")))
        return ["NG", "Cloud Run の ingress=all（インターネットからの受け付け）が許可されていない"];
      return ["OK", allowed.length > 0 ? `許可：${allowed.join(", ")}` : "制限なし"];
    case "gcp.restrictServiceUsage": {
      const blocked = REQUIRED_APIS.filter((api) => denied.includes(api) || (allowed.length > 0 && !allowed.includes(api)) || allValues === "DENY");
      return blocked.length ? ["NG", `使えないAPIがある：${blocked.join(", ")}`] : ["OK", "必要なAPIは制限されていない"];
    }
    case "gcp.restrictNonCmekServices": {
      const needCmek = ["run.googleapis.com", "secretmanager.googleapis.com", "artifactregistry.googleapis.com", "cloudbuild.googleapis.com"].filter(
        (api) => denied.includes(api) || allValues === "DENY",
      );
      return needCmek.length ? ["NG", `顧客管理の暗号鍵（CMEK）が必須：${needCmek.join(", ")}（この構成は CMEK を使わない）`] : ["OK", "CMEK の必須化なし"];
    }
    case "run.allowedBinaryAuthorizationPolicies":
      return restricted ? ["NG", "Binary Authorization が必須（この構成は未対応）"] : ["OK", "制限なし"];
    default:
      return ["INFO", restricted || enforced ? "設定あり（内容は上の JSON を参照）" : "制限なし"];
  }
}

/** Cloud Run サービスの設定が、無料枠向け・最小権限の想定どおりか */
export function evaluateService(sa, svc) {
  const template = svc.spec?.template ?? {};
  const ta = template.metadata?.annotations ?? {};
  const sa_ = svc.metadata?.annotations ?? {};
  const container = template.spec?.containers?.[0] ?? {};
  const env = container.env ?? [];
  const problems = [];
  const expect = (ok, text) => ok || problems.push(text);
  const maxScale = ta["autoscaling.knative.dev/maxScale"] ?? sa_["run.googleapis.com/max-instances"];
  expect(maxScale === "1", `最大インスタンス数が1ではない（${maxScale ?? "未設定"}）`);
  expect(!ta["autoscaling.knative.dev/minScale"] || ta["autoscaling.knative.dev/minScale"] === "0", "最小インスタンス数が0ではない");
  expect(ta["run.googleapis.com/cpu-throttling"] !== "false", "CPUが常時割り当てになっている（リクエスト単位の課金ではない）");
  expect(template.spec?.serviceAccountName === sa, "GA4用サービスアカウントで動いていない");
  expect(container.resources?.limits?.memory === "256Mi", `メモリが256Miではない（${container.resources?.limits?.memory ?? "?"}）`);
  expect(Number(template.spec?.timeoutSeconds) <= 15, "タイムアウトが15秒を超えている");
  expect(sa_["run.googleapis.com/ingress"] === "all", "ingress が all ではない（Cloudflare から呼べない）");
  expect(env.some((e) => e.name === "GA4_PROPERTY_ID" && e.value === "546942310"), "GA4_PROPERTY_ID が 546942310 ではない");
  expect(env.some((e) => e.name === "PROXY_HMAC_SECRET" && e.valueFrom?.secretKeyRef?.name), "署名用シークレットが Secret Manager から渡されていない");
  expect(!env.some((e) => e.name === "PROXY_HMAC_SECRET" && typeof e.value === "string"), "署名用シークレットが環境変数に直接書かれている");
  return problems.length ? ["NG", problems.join("／")] : ["OK", "最小0・最大1インスタンス、リクエスト単位のCPU、256Mi、15秒、GA4用サービスアカウント、シークレットは Secret Manager"];
}
