// 「SNS最終更新：10月3日 18:42」の表示文言を作るユーティリティです。
// ビルド時（.astro）とブラウザ実行時（ページ内スクリプト）の両方から使います。
// 閲覧者の端末のタイムゾーンに関係なく、日本時間で表示します。

export function formatSnsLastUpdated(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `SNS最終更新：${get("month")}月${get("day")}日 ${get("hour")}:${get("minute")}`;
}

/** ページ内の [data-sns-last-updated] 要素を、最新の取得時刻で書き換える（取得時刻が無ければ何もしない） */
export function applySnsLastUpdated(iso: string | null | undefined): void {
  const label = formatSnsLastUpdated(iso);
  if (!label) return;
  document.querySelectorAll<HTMLElement>("[data-sns-last-updated]").forEach((el) => {
    el.textContent = label;
    if (iso) el.setAttribute("datetime", iso);
    el.classList.remove("hidden");
  });
}
