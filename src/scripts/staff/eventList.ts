// イベントの管理一覧（ブラウザで動作）：一覧表示（PCは表・スマホはカード）・ステータス変更・削除（確認ダイアログ付き）。
// 値は textContent でのみ表示し、HTMLとして解釈しない（XSS対策）。

import { EVENT_CATEGORY_LABELS, EVENT_STATUS_LABELS, EVENT_VISIBILITY_LABELS, type EventRecord, type EventStatus } from "../../types/events";
import { formatDialogueDate, formatDialogueTime, todayInJapan } from "../../utils/dialogueEvents";
import { apiErrorMessage, showNotice, staffApi } from "./api";

const rowTemplate = document.querySelector<HTMLTemplateElement>("[data-event-row-template]");
const cardTemplate = document.querySelector<HTMLTemplateElement>("[data-event-card-template]");
const loading = document.querySelector<HTMLElement>("[data-events-loading]");
const notice = document.querySelector<HTMLElement>("[data-staff-notice]");
const dialog = document.querySelector<HTMLDialogElement>("[data-delete-dialog]");

const SAVED_MESSAGES: Record<string, string> = {
  created: "イベントを登録しました。",
  updated: "変更を保存しました。",
};
const NEWS_MESSAGES: Record<string, string> = {
  created: "「最新のお知らせ」にも掲載しました。",
  updated: "「最新のお知らせ」の内容も更新しました。",
  unpublished: "「最新のお知らせ」の掲載は非公開にしました。",
};

/** 終了・中止・開催日を過ぎたイベントか */
const isEnded = (event: EventRecord, today: string) => event.status === "completed" || event.status === "cancelled" || event.eventDate < today;

function setText(root: ParentNode, name: string, value: string): void {
  root.querySelectorAll<HTMLElement>(`[data-field="${name}"]`).forEach((el) => {
    el.textContent = value;
  });
}

function fill(root: HTMLElement, event: EventRecord): HTMLElement {
  setText(root, "title", event.title);
  setText(root, "date", formatDialogueDate(event.eventDate) ?? event.eventDate);
  setText(root, "time", formatDialogueTime(event) ?? "");
  setText(root, "venue", event.venue);
  setText(root, "category", EVENT_CATEGORY_LABELS[event.category] ?? event.category);
  setText(root, "person", event.personInCharge || "未定");
  const visibility = root.querySelector<HTMLElement>('[data-field="visibility"]')!;
  visibility.textContent = EVENT_VISIBILITY_LABELS[event.visibility];
  visibility.classList.add(...(event.visibility === "public" ? ["bg-brand-orange-dark", "text-white"] : ["bg-black/10", "text-ink"]));
  if (event.postedToNews) root.querySelector('[data-field="news"]')?.classList.remove("hidden");

  const edit = root.querySelector<HTMLAnchorElement>("[data-edit-link]")!;
  edit.href = `/staff/events/${event.id}/edit/`;
  edit.setAttribute("aria-label", `「${event.title}」を編集`);

  const select = root.querySelector<HTMLSelectElement>("[data-status-form] select")!;
  select.value = event.status;
  select.setAttribute("aria-label", `「${event.title}」のステータス`);
  root.querySelector<HTMLButtonElement>("[data-status-submit]")!.addEventListener("click", async () => {
    const status = select.value as EventStatus;
    if (status === event.status) return showNotice(notice, "ステータスは変更されていません。", "info");
    const result = await staffApi(`/staff/api/events/${event.id}`, { method: "PATCH", body: { status } });
    if (!result.ok) return showNotice(notice, apiErrorMessage(result, "イベント"), "error");
    showNotice(notice, `「${event.title}」のステータスを「${EVENT_STATUS_LABELS[status]}」に変更しました。`, "info");
    await load();
  });

  const deleteButton = root.querySelector<HTMLButtonElement>("[data-delete]")!;
  deleteButton.setAttribute("aria-label", `「${event.title}」を削除`);
  deleteButton.addEventListener("click", () => confirmDelete(event));
  return root;
}

function confirmDelete(event: EventRecord): void {
  if (!dialog) return;
  dialog.querySelector<HTMLElement>("[data-delete-date]")!.textContent = formatDialogueDate(event.eventDate) ?? event.eventDate;
  dialog.querySelector<HTMLElement>("[data-delete-title]")!.textContent = `${event.title}（${event.venue}）`;
  dialog.returnValue = "";
  dialog.addEventListener(
    "close",
    async () => {
      if (dialog.returnValue !== "confirm") return;
      const result = await staffApi<{ news: string }>(`/staff/api/events/${event.id}`, { method: "DELETE" });
      if (!result.ok) return showNotice(notice, apiErrorMessage(result, "イベント"), "error");
      showNotice(notice, `「${event.title}」を削除しました。${NEWS_MESSAGES[result.data?.news ?? ""] ?? ""}`, "info");
      await load();
    },
    { once: true },
  );
  dialog.showModal();
}

async function load(): Promise<void> {
  if (!rowTemplate || !cardTemplate) return;
  const result = await staffApi<{ events: EventRecord[] }>("/staff/api/events");
  loading?.classList.add("hidden");
  if (!result.ok || !result.data) {
    showNotice(notice, apiErrorMessage(result, "イベント"), "error");
    return;
  }
  const today = todayInJapan();
  const upcoming = result.data.events.filter((event) => !isEnded(event, today));
  // 終了したものは新しい順
  const ended = result.data.events.filter((event) => isEnded(event, today)).reverse();
  for (const [key, events] of [["upcoming", upcoming], ["ended", ended]] as const) {
    const group = document.querySelector<HTMLElement>(`[data-events-group="${key}"]`);
    if (!group) continue;
    group.classList.remove("hidden");
    group.querySelector("[data-events-empty]")?.classList.toggle("hidden", events.length > 0);
    group.querySelector("[data-events-rows]")?.replaceChildren(
      ...events.map((event) => fill(rowTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement, event)),
    );
    group.querySelector("[data-events-cards]")?.replaceChildren(
      ...events.map((event) => fill(cardTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement, event)),
    );
    group.querySelector("table")?.closest("div")?.classList.toggle("lg:block", events.length > 0);
  }
}

const params = new URLSearchParams(location.search);
const saved = params.get("saved");
if (saved && SAVED_MESSAGES[saved]) {
  showNotice(notice, `${SAVED_MESSAGES[saved]}${NEWS_MESSAGES[params.get("news") ?? ""] ?? ""}`, "info");
  history.replaceState(null, "", location.pathname);
}
void load();
