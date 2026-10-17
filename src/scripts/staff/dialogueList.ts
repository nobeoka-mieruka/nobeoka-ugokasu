// 意見交換会の管理一覧（ブラウザで動作）：一覧表示・受付状況の変更・削除（確認ダイアログ付き）。
// 値は textContent でのみ表示し、HTMLとして解釈しない（XSS対策）。

import { DIALOGUE_STATUS_LABELS, type DialogueEventRecord, type DialogueStatus } from "../../types/dialogue";
import { formatDialogueDate, formatDialogueTime } from "../../utils/dialogueEvents";
import { apiErrorMessage, showNotice, staffApi } from "./api";

const list = document.querySelector<HTMLUListElement>("[data-dialogue-list]");
const template = document.querySelector<HTMLTemplateElement>("[data-dialogue-card-template]");
const loading = document.querySelector<HTMLElement>("[data-dialogue-loading]");
const empty = document.querySelector<HTMLElement>("[data-dialogue-empty]");
const notice = document.querySelector<HTMLElement>("[data-staff-notice]");
const dialog = document.querySelector<HTMLDialogElement>("[data-delete-dialog]");

const SAVED_MESSAGES: Record<string, string> = {
  created: "意見交換会を登録しました。公開ページにも反映されています。",
  updated: "変更を保存しました。公開ページにも反映されています。",
};

function setText(root: ParentNode, name: string, value: string): void {
  const el = root.querySelector<HTMLElement>(`[data-field="${name}"]`);
  if (el) el.textContent = value;
}

function renderCard(event: DialogueEventRecord): HTMLElement {
  const card = template!.content.firstElementChild!.cloneNode(true) as HTMLElement;
  setText(card, "title", event.title);
  setText(card, "date", formatDialogueDate(event.eventDate) ?? event.eventDate);
  setText(card, "time", formatDialogueTime(event) ?? "—");
  setText(card, "venue", event.venue);
  setText(card, "status", DIALOGUE_STATUS_LABELS[event.status]);
  setText(card, "capacity", event.capacity ? `${event.capacity}名` : "定員なし");
  setText(
    card,
    "apply",
    event.status === "open" && event.applicationOpen ? "表示する" : event.status === "open" ? "表示しない（受付可否がオフ）" : "表示しない",
  );
  const published = card.querySelector<HTMLElement>('[data-field="published"]')!;
  published.textContent = event.isPublished ? "公開中" : "非公開（下書き）";
  published.classList.add(...(event.isPublished ? ["bg-brand-orange-dark", "text-white"] : ["bg-black/10", "text-ink"]));

  card.querySelector<HTMLAnchorElement>("[data-edit-link]")!.href = `/staff/dialogue/${event.id}/edit/`;
  card.querySelector<HTMLAnchorElement>("[data-edit-link]")!.setAttribute("aria-label", `「${event.title}」を編集`);

  const statusForm = card.querySelector<HTMLFormElement>("[data-status-form]")!;
  const select = statusForm.elements.namedItem("status") as HTMLSelectElement;
  select.value = event.status;
  statusForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = select.value as DialogueStatus;
    if (status === event.status) {
      showNotice(notice, "受付状況は変更されていません。", "info");
      return;
    }
    const result = await staffApi(`/staff/api/dialogue-events/${event.id}`, { method: "PATCH", body: { status } });
    if (!result.ok) return showNotice(notice, apiErrorMessage(result), "error");
    showNotice(notice, `「${event.title}」の受付状況を「${DIALOGUE_STATUS_LABELS[status]}」に変更しました。`, "info");
    await load();
  });

  const deleteButton = card.querySelector<HTMLButtonElement>("[data-delete]")!;
  deleteButton.setAttribute("aria-label", `「${event.title}」を削除`);
  deleteButton.addEventListener("click", () => confirmDelete(event));
  return card;
}

function confirmDelete(event: DialogueEventRecord): void {
  if (!dialog) return;
  dialog.querySelector<HTMLElement>("[data-delete-date]")!.textContent = formatDialogueDate(event.eventDate) ?? event.eventDate;
  dialog.querySelector<HTMLElement>("[data-delete-title]")!.textContent = `${event.title}（${event.venue}）`;
  dialog.returnValue = "";
  dialog.addEventListener(
    "close",
    async () => {
      if (dialog.returnValue !== "confirm") return;
      const result = await staffApi(`/staff/api/dialogue-events/${event.id}`, { method: "DELETE" });
      if (!result.ok) return showNotice(notice, apiErrorMessage(result), "error");
      showNotice(notice, `「${event.title}」を削除しました。`, "info");
      await load();
    },
    { once: true },
  );
  dialog.showModal();
}

async function load(): Promise<void> {
  if (!list || !template) return;
  const result = await staffApi<{ events: DialogueEventRecord[] }>("/staff/api/dialogue-events");
  loading?.classList.add("hidden");
  if (!result.ok || !result.data) {
    showNotice(notice, apiErrorMessage(result), "error");
    return;
  }
  list.replaceChildren(...result.data.events.map(renderCard));
  empty?.classList.toggle("hidden", result.data.events.length > 0);
}

const saved = new URLSearchParams(location.search).get("saved");
if (saved && SAVED_MESSAGES[saved]) {
  showNotice(notice, SAVED_MESSAGES[saved], "info");
  history.replaceState(null, "", location.pathname);
}
void load();
