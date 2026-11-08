// SNS管理画面（ブラウザで動作）：連携状況の表示と「今すぐ同期」。
// APIの応答には秘密情報は含まれない。値は textContent でのみ表示する（XSS対策）。

import { apiErrorMessage, showNotice, staffApi } from "./api";

type Platform = "facebook" | "instagram" | "threads";
type State = "ok" | "error" | "not_configured" | "not_synced";
type ErrorKind = "token_expired" | "permission_denied" | "rate_limited" | "api_error" | "network_error";

interface SnsStatus {
  platforms: {
    platform: Platform;
    state: State;
    postCount: number;
    errorKind: ErrorKind | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    failingSince: string | null;
    latestPostAt: string | null;
  }[];
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  postsUpdatedAt: string | null;
  recentPosts: { platform: Platform; title: string; publishedAt: string; permalink: string }[];
  manualSyncAvailableAt: number | null;
}

const LABELS: Record<Platform, string> = { facebook: "Facebook", instagram: "Instagram", threads: "Threads" };
/** 状態の表示（色だけでなく文字でも示す）。未設定のSNSを「連携中」と表示しない */
const STATE_VIEW: Record<State, { text: string; classes: string[]; hint?: string }> = {
  ok: { text: "連携中（正常）", classes: ["bg-brand-orange-dark", "text-white"] },
  error: { text: "エラー", classes: ["bg-red-50", "text-red-800", "ring-1", "ring-red-700"], hint: "直近の同期で取得に失敗しました。以前に取得できた投稿をそのまま表示しています。" },
  not_configured: { text: "未設定", classes: ["bg-black/5", "text-ink-soft"], hint: "連携に必要な設定が登録されていないため、同期していません。" },
  not_synced: { text: "未同期", classes: ["bg-brand-orange-light", "text-ink"], hint: "設定はありますが、まだ同期の記録がありません。" },
};

/** 失敗の種類ごとの案内（1行目は見出し） */
const ERROR_VIEW: Record<ErrorKind, { badge: string; lines: string[] }> = {
  token_expired: {
    badge: "トークンの更新が必要",
    lines: [
      "アクセストークンの有効期限が切れているため、投稿を取得できません。",
      "管理者がMetaでアクセストークンを再発行し、Cloudflare Pagesの環境変数（Metaのアクセストークン）を更新してください（手順：META_SOCIAL_SETUP.md の13章）。更新後は約3分以内に自動で取得が再開します。",
    ],
  },
  permission_denied: {
    badge: "権限の確認が必要",
    lines: ["アクセストークンに必要な権限が付いていないため、投稿を取得できません。", "Metaでトークンの権限（pages_read_engagement など）を確認してください。"],
  },
  rate_limited: { badge: "一時的な制限", lines: ["SNS側の呼び出し回数の制限に達しました。時間をおくと自動で回復します。"] },
  api_error: { badge: "エラー", lines: ["SNS側のエラーで取得に失敗しました。続く場合はサーバーログ（social-sync）を確認してください。"] },
  network_error: { badge: "通信エラー", lines: ["SNSへ接続できませんでした。一時的な障害の可能性があります。続く場合はサーバーログを確認してください。"] },
};

const notice = document.querySelector<HTMLElement>("[data-staff-notice]");
const resultBox = document.querySelector<HTMLElement>("[data-sns-result]");
const syncButton = document.querySelector<HTMLButtonElement>("[data-sns-sync]");
let cooldownTimer: number | undefined;

const formatDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "記録なし";

function setCooldown(availableAt: number | null): void {
  if (!syncButton) return;
  window.clearInterval(cooldownTimer);
  const tick = () => {
    const remaining = availableAt ? Math.ceil(availableAt - Date.now() / 1000) : 0;
    syncButton.disabled = remaining > 0;
    syncButton.textContent = remaining > 0 ? `今すぐ同期（あと${remaining}秒）` : "今すぐ同期";
    if (remaining <= 0) window.clearInterval(cooldownTimer);
  };
  tick();
  if (availableAt) cooldownTimer = window.setInterval(tick, 1000);
}

function render(status: SnsStatus): void {
  document.querySelector('[data-sns="lastCheckedAt"]')!.textContent = formatDateTime(status.lastCheckedAt);
  document.querySelector('[data-sns="lastSuccessAt"]')!.textContent = formatDateTime(status.lastSuccessAt);
  for (const item of status.platforms) {
    const card = document.querySelector<HTMLElement>(`[data-sns-platform="${item.platform}"]`);
    if (!card) continue;
    const view = STATE_VIEW[item.state];
    const badge = card.querySelector<HTMLElement>('[data-sns-field="state"]')!;
    badge.className = "rounded-full px-3 py-1 text-xs font-bold";
    badge.classList.add(...view.classes);
    const errorView = item.state === "error" && item.errorKind ? ERROR_VIEW[item.errorKind] : null;
    badge.textContent = errorView ? errorView.badge : view.text;
    const off = item.state === "not_configured";
    card.querySelector('[data-sns-field="postCount"]')!.textContent = off ? "—" : `${item.postCount}件`;
    card.querySelector('[data-sns-field="checkedAt"]')!.textContent = off ? "—" : formatDateTime(status.lastCheckedAt);
    card.querySelector('[data-sns-field="lastSuccessAt"]')!.textContent = off ? "—" : formatDateTime(item.lastSuccessAt);
    card.querySelector('[data-sns-field="latestPostAt"]')!.textContent = off ? "—" : formatDateTime(item.latestPostAt);
    const action = card.querySelector<HTMLElement>('[data-sns-field="action"]')!;
    action.replaceChildren(
      ...(errorView
        ? [
            ...errorView.lines.map((line, i) => {
              const p = document.createElement("p");
              p.textContent = line;
              if (i === 0) p.className = "font-bold";
              return p;
            }),
            ...(item.failingSince ? [Object.assign(document.createElement("p"), { textContent: `失敗が続いている期間：${formatDateTime(item.failingSince)} から` })] : []),
          ]
        : []),
    );
    action.classList.toggle("hidden", !errorView);
    const hint = card.querySelector<HTMLElement>('[data-sns-field="hint"]')!;
    hint.textContent = view.hint ?? "";
    hint.classList.toggle("hidden", !view.hint);
  }
  const list = document.querySelector<HTMLUListElement>("[data-sns-posts]")!;
  const template = document.querySelector<HTMLTemplateElement>("[data-sns-post-template]")!;
  list.replaceChildren(
    ...status.recentPosts.map((post) => {
      const row = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
      row.querySelector('[data-post="platform"]')!.textContent = LABELS[post.platform];
      row.querySelector('[data-post="date"]')!.textContent = formatDateTime(post.publishedAt);
      const link = row.querySelector<HTMLAnchorElement>('[data-post="link"]')!;
      link.textContent = post.title || "（本文なし）";
      // SNSの投稿URL（https）だけをリンクにする
      if (/^https:\/\//.test(post.permalink)) link.href = post.permalink;
      return row;
    }),
  );
  document.querySelector("[data-sns-posts-empty]")?.classList.toggle("hidden", status.recentPosts.length > 0);
  setCooldown(status.manualSyncAvailableAt);
}

async function load(): Promise<void> {
  const result = await staffApi<{ status: SnsStatus }>("/staff/api/sns/status");
  if (!result.ok || !result.data) return showNotice(notice, apiErrorMessage(result, "SNSの情報"), "error");
  render(result.data.status);
}

function showResult(lines: string[], tone: "ok" | "error"): void {
  if (!resultBox) return;
  resultBox.replaceChildren(
    ...lines.map((line, i) => {
      const p = document.createElement("p");
      p.textContent = line;
      if (i === 0) p.className = tone === "ok" ? "font-bold text-ink" : "font-bold text-red-800";
      return p;
    }),
  );
  resultBox.classList.remove("hidden");
}

syncButton?.addEventListener("click", async () => {
  syncButton.disabled = true;
  syncButton.textContent = "同期しています…";
  const result = await staffApi<{ synced: boolean; checkedAt: string; counts: Record<Platform, number>; retryAt?: number }>("/staff/api/sns/sync", { method: "POST", body: {} });
  if (result.status === 429) {
    showResult(["手動同期は60秒に1回までです。しばらく待ってからお試しください。"], "error");
    setCooldown((result.data as { retryAt?: number } | null)?.retryAt ?? null);
    return;
  }
  if (!result.ok || !result.data || !result.data.synced) {
    const when = result.data && "checkedAt" in result.data && result.data.checkedAt ? `同期日時：${formatDateTime(result.data.checkedAt)}` : "";
    showResult(["SNSの同期に失敗しました。", when].filter(Boolean), "error");
  } else {
    const { counts, checkedAt } = result.data;
    showResult(
      [
        "SNSの同期が完了しました。",
        `取得件数：Facebook ${counts.facebook}件／Instagram ${counts.instagram}件／Threads ${counts.threads}件`,
        `同期日時：${formatDateTime(checkedAt)}`,
      ],
      "ok",
    );
  }
  await load();
});

void load();
