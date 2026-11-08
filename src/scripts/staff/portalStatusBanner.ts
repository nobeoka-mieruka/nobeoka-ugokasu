// 執行部ポータルTOPの「サイトの状態」のお知らせ（ブラウザで動作）。
// /staff/api/site-status を読み、失敗・要確認の項目があるときだけ件数と「サイトの状態」へのリンクを表示する。
// 読み込めない場合は何も表示しない（ポータルTOPの表示を妨げない）。値は textContent でのみ扱う。

import { staffApi } from "./api";

const banner = document.querySelector<HTMLElement>("[data-portal-status]");

async function load(): Promise<void> {
  if (!banner) return;
  const result = await staffApi<{ status: { counts: { ok: number; warning: number; error: number } } }>("/staff/api/site-status");
  if (!result.ok || !result.data) return;
  const { error, warning } = result.data.status.counts;
  if (error === 0 && warning === 0) return;
  const text = banner.querySelector<HTMLElement>("[data-portal-status-text]")!;
  text.textContent = [error > 0 ? `失敗 ${error}件` : "", warning > 0 ? `要確認 ${warning}件` : ""].filter(Boolean).join("・");
  banner.classList.toggle("border-red-700", error > 0);
  banner.classList.remove("hidden");
}

void load();
