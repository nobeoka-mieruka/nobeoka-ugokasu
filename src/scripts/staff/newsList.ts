// お知らせの管理一覧（ブラウザで動作）：一覧表示・公開／非公開の切り替え・削除（確認ダイアログ付き）。
// 値は textContent でのみ表示し、HTMLとして解釈しない（XSS対策）。

import { NEWS_CATEGORY_LABELS, type NewsItemRecord } from "../../types/news";
import { formatNewsDate } from "../../utils/newsCards";
import { apiErrorMessage, showNotice, staffApi } from "./api";

const list = document.querySelector<HTMLUListElement>("[data-news-admin-list]");
const template = document.querySelector<HTMLTemplateElement>("[data-news-card-template]");
const loading = document.querySelector<HTMLElement>("[data-news-loading]");
const empty = document.querySelector<HTMLElement>("[data-news-empty]");
const notice = document.querySelector<HTMLElement>("[data-staff-notice]");
const dialog = document.querySelector<HTMLDialogElement>("[data-delete-dialog]");

const SAVED_MESSAGES: Record<string, string> = {
  created: "お知らせを登録しました。公開ページにも反映されています。",
  updated: "変更を保存しました。公開ページにも反映されています。",
};

function setText(root: ParentNode, name: string, value: string): void {
  const el = root.querySelector<HTMLElement>(`[data-field="${name}"]`);
  if (el) el.textContent = value;
}

function renderCard(item: NewsItemRecord): HTMLElement {
  const card = template!.content.firstElementChild!.cloneNode(true) as HTMLElement;
  setText(card, "category", NEWS_CATEGORY_LABELS[item.category] ?? item.category);
  setText(card, "date", formatNewsDate(item.publishedOn));
  setText(card, "title", item.title);
  setText(card, "summary", item.summary);
  setText(card, "link", item.linkUrl || "なし");
  setText(card, "order", String(item.displayOrder));
  if (item.sourceKey) card.querySelector('[data-field="migrated"]')?.classList.remove("hidden");

  const published = card.querySelector<HTMLElement>('[data-field="published"]')!;
  published.textContent = item.isPublished ? "公開中" : "非公開";
  published.classList.add(...(item.isPublished ? ["bg-brand-orange-dark", "text-white"] : ["bg-black/10", "text-ink"]));

  const edit = card.querySelector<HTMLAnchorElement>("[data-edit-link]")!;
  edit.href = `/staff/news/${item.id}/edit/`;
  edit.setAttribute("aria-label", `「${item.title}」を編集`);

  const toggle = card.querySelector<HTMLButtonElement>("[data-toggle-publish]")!;
  toggle.textContent = item.isPublished ? "非公開にする" : "公開する";
  toggle.setAttribute("aria-label", `「${item.title}」を${item.isPublished ? "非公開にする" : "公開する"}`);
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    const result = await staffApi(`/staff/api/news-items/${item.id}`, { method: "PATCH", body: { isPublished: !item.isPublished } });
    toggle.disabled = false;
    if (!result.ok) return showNotice(notice, apiErrorMessage(result, "お知らせ"), "error");
    showNotice(notice, `「${item.title}」を${item.isPublished ? "非公開に" : "公開"}しました。`, "info");
    await load();
  });

  const deleteButton = card.querySelector<HTMLButtonElement>("[data-delete]")!;
  deleteButton.setAttribute("aria-label", `「${item.title}」を削除`);
  deleteButton.addEventListener("click", () => confirmDelete(item));
  return card;
}

function confirmDelete(item: NewsItemRecord): void {
  if (!dialog) return;
  dialog.querySelector<HTMLElement>("[data-delete-date]")!.textContent = formatNewsDate(item.publishedOn);
  dialog.querySelector<HTMLElement>("[data-delete-title]")!.textContent = item.title;
  dialog.returnValue = "";
  dialog.addEventListener(
    "close",
    async () => {
      if (dialog.returnValue !== "confirm") return;
      const result = await staffApi(`/staff/api/news-items/${item.id}`, { method: "DELETE" });
      if (!result.ok) return showNotice(notice, apiErrorMessage(result, "お知らせ"), "error");
      showNotice(notice, `「${item.title}」を削除しました。`, "info");
      await load();
    },
    { once: true },
  );
  dialog.showModal();
}

async function load(): Promise<void> {
  if (!list || !template) return;
  const result = await staffApi<{ items: NewsItemRecord[] }>("/staff/api/news-items");
  loading?.classList.add("hidden");
  if (!result.ok || !result.data) {
    showNotice(notice, apiErrorMessage(result, "お知らせ"), "error");
    return;
  }
  list.replaceChildren(...result.data.items.map(renderCard));
  empty?.classList.toggle("hidden", result.data.items.length > 0);
}

const saved = new URLSearchParams(location.search).get("saved");
if (saved && SAVED_MESSAGES[saved]) {
  showNotice(notice, SAVED_MESSAGES[saved], "info");
  history.replaceState(null, "", location.pathname);
}
void load();
