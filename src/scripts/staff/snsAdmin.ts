// SNS管理画面（ブラウザで動作）：連携状況の表示と「今すぐ同期」。
// APIの応答には秘密情報は含まれない。値は textContent でのみ表示する（XSS対策）。

import { apiErrorMessage, showNotice, staffApi } from "./api";

type Platform = "facebook" | "instagram" | "threads";
type State = "ok" | "error" | "not_configured" | "not_synced";

interface SnsStatus {
  platforms: { platform: Platform; state: State; postCount: number }[];
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
    badge.textContent = view.text;
    card.querySelector('[data-sns-field="postCount"]')!.textContent = item.state === "not_configured" ? "—" : `${item.postCount}件`;
    card.querySelector('[data-sns-field="checkedAt"]')!.textContent = item.state === "not_configured" ? "—" : formatDateTime(status.lastCheckedAt);
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
