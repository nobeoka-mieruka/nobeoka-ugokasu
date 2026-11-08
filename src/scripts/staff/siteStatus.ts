// サイトの状態（ブラウザで動作）：/staff/api/site-status を読み込んで表示する。
// 値は textContent でのみ表示する（XSS対策）。状態は色だけでなく文字でも示す。

import { apiErrorMessage, showNotice, staffApi } from "./api";

type State = "ok" | "warning" | "error";
interface HealthItem {
  key: string;
  label: string;
  state: State;
  summary: string;
  at: string | null;
}
interface SiteStatus {
  items: HealthItem[];
  counts: Record<State, number>;
  generatedAt: string;
}

const STATE_VIEW: Record<State, { text: string; classes: string[] }> = {
  ok: { text: "正常", classes: ["bg-brand-orange-dark", "text-white"] },
  warning: { text: "要確認", classes: ["bg-brand-orange-light", "text-ink", "ring-1", "ring-brand-orange-dark"] },
  error: { text: "失敗", classes: ["bg-red-50", "text-red-800", "ring-1", "ring-red-700"] },
};
/** 失敗・要確認を先に並べる */
const ORDER: Record<State, number> = { error: 0, warning: 1, ok: 2 };

const notice = document.querySelector<HTMLElement>("[data-staff-notice]");
const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function render(status: SiteStatus): void {
  const overall = document.querySelector<HTMLElement>("[data-status-overall]")!;
  overall.textContent =
    status.counts.error > 0 ? "失敗している項目があります。" : status.counts.warning > 0 ? "確認が必要な項目があります。" : "すべて正常です。";
  overall.classList.toggle("text-red-800", status.counts.error > 0);
  for (const state of ["ok", "warning", "error"] as const) {
    document.querySelector(`[data-status-count="${state}"]`)!.textContent = String(status.counts[state]);
  }
  document.querySelector("[data-status-generated]")!.textContent = formatDateTime(status.generatedAt);

  const template = document.querySelector<HTMLTemplateElement>("[data-status-item-template]")!;
  const items = [...status.items].sort((a, b) => ORDER[a.state] - ORDER[b.state]);
  document.querySelector("[data-status-items]")!.replaceChildren(
    ...items.map((item) => {
      const row = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
      row.dataset.statusKey = item.key;
      row.dataset.statusState = item.state;
      row.querySelector('[data-field="label"]')!.textContent = item.label;
      const badge = row.querySelector<HTMLElement>('[data-field="state"]')!;
      badge.classList.add(...STATE_VIEW[item.state].classes);
      badge.textContent = STATE_VIEW[item.state].text;
      row.querySelector('[data-field="summary"]')!.textContent = item.summary;
      const at = row.querySelector<HTMLElement>('[data-field="at"]')!;
      at.textContent = item.at ? `日時：${formatDateTime(item.at)}` : "";
      at.classList.toggle("hidden", !item.at);
      return row;
    }),
  );
}

async function load(): Promise<void> {
  const result = await staffApi<{ status: SiteStatus }>("/staff/api/site-status");
  if (!result.ok || !result.data) return showNotice(notice, apiErrorMessage(result, "サイトの状態"), "error");
  notice?.classList.add("hidden");
  render(result.data.status);
}

document.querySelector("[data-status-reload]")?.addEventListener("click", () => void load());
void load();
