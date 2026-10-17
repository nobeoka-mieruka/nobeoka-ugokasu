// 資料の一覧（ブラウザで動作）：一覧表示（PCは表・スマホはカード）・カテゴリーの絞り込み・ピン留め・削除（確認ダイアログ付き）。
// 値は textContent でのみ表示し、HTMLとして解釈しない（XSS対策）。「資料を開く」は https:// のURLだけをリンクにし、新しいタブで開く。

import { DOCUMENT_CATEGORY_LABELS, DOCUMENT_TYPE_LABELS, type DocumentRecord } from "../../types/documents";
import { apiErrorMessage, showNotice, staffApi } from "./api";

const rowTemplate = document.querySelector<HTMLTemplateElement>("[data-document-row-template]");
const cardTemplate = document.querySelector<HTMLTemplateElement>("[data-document-card-template]");
const notice = document.querySelector<HTMLElement>("[data-staff-notice]");
const dialog = document.querySelector<HTMLDialogElement>("[data-delete-dialog]");
const filterSelect = document.querySelector<HTMLSelectElement>("[data-category-filter]");
let documents: DocumentRecord[] = [];

const SAVED_MESSAGES: Record<string, string> = { created: "資料を登録しました。", updated: "変更を保存しました。" };
const formatDate = (seconds: number) => new Date(seconds * 1000).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });

function setText(root: ParentNode, name: string, value: string): void {
  root.querySelectorAll<HTMLElement>(`[data-field="${name}"]`).forEach((el) => (el.textContent = value));
}

function fill(root: HTMLElement, doc: DocumentRecord): HTMLElement {
  setText(root, "title", doc.title);
  setText(root, "description", doc.description);
  setText(root, "category", DOCUMENT_CATEGORY_LABELS[doc.category]);
  setText(root, "type", DOCUMENT_TYPE_LABELS[doc.documentType]);
  setText(root, "updated", formatDate(doc.updatedAt));
  if (doc.pinned) root.querySelector('[data-field="pin"]')?.classList.remove("hidden");

  const open = root.querySelector<HTMLAnchorElement>("[data-open-link]")!;
  if (/^https:\/\//.test(doc.url)) open.href = doc.url;
  open.setAttribute("aria-label", `「${doc.title}」を開く（新しいタブ）`);

  const edit = root.querySelector<HTMLAnchorElement>("[data-edit-link]")!;
  edit.href = `/staff/documents/${doc.id}/edit/`;
  edit.setAttribute("aria-label", `「${doc.title}」を編集`);

  const pin = root.querySelector<HTMLButtonElement>("[data-toggle-pin]")!;
  pin.textContent = doc.pinned ? "ピン留めを外す" : "ピン留めする";
  pin.addEventListener("click", async () => {
    const result = await staffApi(`/staff/api/documents/${doc.id}`, { method: "PATCH", body: { pinned: !doc.pinned } });
    if (!result.ok) return showNotice(notice, apiErrorMessage(result, "資料"), "error");
    showNotice(notice, `「${doc.title}」を${doc.pinned ? "ピン留めから外しました" : "ピン留めしました"}。`, "info");
    await load();
  });

  const deleteButton = root.querySelector<HTMLButtonElement>("[data-delete]")!;
  deleteButton.setAttribute("aria-label", `「${doc.title}」を削除`);
  deleteButton.addEventListener("click", () => confirmDelete(doc));
  return root;
}

function confirmDelete(doc: DocumentRecord): void {
  if (!dialog) return;
  dialog.querySelector<HTMLElement>("[data-delete-title]")!.textContent = doc.title;
  dialog.returnValue = "";
  dialog.addEventListener(
    "close",
    async () => {
      if (dialog.returnValue !== "confirm") return;
      const result = await staffApi(`/staff/api/documents/${doc.id}`, { method: "DELETE" });
      if (!result.ok) return showNotice(notice, apiErrorMessage(result, "資料"), "error");
      showNotice(notice, `「${doc.title}」を一覧から削除しました。`, "info");
      await load();
    },
    { once: true },
  );
  dialog.showModal();
}

function render(): void {
  if (!rowTemplate || !cardTemplate) return;
  const category = filterSelect?.value ?? "";
  const shown = documents.filter((doc) => !category || doc.category === category);
  document.querySelector("[data-documents-empty]")?.classList.toggle("hidden", shown.length > 0);
  const table = document.querySelector<HTMLElement>("[data-documents-table]");
  table?.classList.toggle("lg:block", shown.length > 0);
  document.querySelector("[data-documents-rows]")?.replaceChildren(...shown.map((doc) => fill(rowTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement, doc)));
  document.querySelector("[data-documents-cards]")?.replaceChildren(...shown.map((doc) => fill(cardTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement, doc)));
}

async function load(): Promise<void> {
  const result = await staffApi<{ documents: DocumentRecord[] }>("/staff/api/documents");
  document.querySelector("[data-documents-loading]")?.classList.add("hidden");
  if (!result.ok || !result.data) return showNotice(notice, apiErrorMessage(result, "資料"), "error");
  documents = result.data.documents;
  render();
}

filterSelect?.addEventListener("change", render);
const saved = new URLSearchParams(location.search).get("saved");
if (saved && SAVED_MESSAGES[saved]) {
  showNotice(notice, SAVED_MESSAGES[saved], "info");
  history.replaceState(null, "", location.pathname);
}
void load();
