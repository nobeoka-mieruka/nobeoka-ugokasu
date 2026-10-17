// イベントの登録・編集フォームの送信処理（ブラウザで動作）。
// 編集画面（/staff/events/:id/edit/）では、URLの :id の内容をAPIから読み込んでフォームへ入れる。
// 値は input.value / textContent でのみ扱い、HTMLとして解釈しない（XSS対策）。

import type { EventRecord } from "../../types/events";
import { apiErrorMessage, showNotice, staffApi } from "./api";
import { clearFieldErrors, showFieldErrors } from "./formErrors";

const form = document.querySelector<HTMLFormElement>("[data-event-form]");
const notice = document.querySelector<HTMLElement>("[data-staff-notice]");

function field<T extends HTMLElement = HTMLInputElement>(name: string): T {
  return form!.elements.namedItem(name) as unknown as T;
}

const visibility = () => (form!.querySelector<HTMLInputElement>('input[name="visibility"]:checked')?.value ?? "internal");

/** 「執行部のみ」のときは、お知らせへの掲載を選べないようにする */
function syncNewsCheckbox(): void {
  const checkbox = field("postToNews");
  const isPublic = visibility() === "public";
  checkbox.disabled = !isPublic;
  if (!isPublic) checkbox.checked = false;
}

function readForm() {
  return {
    title: field("title").value,
    eventDate: field("eventDate").value,
    startTime: field("startTime").value,
    endTime: field("endTime").value,
    venue: field("venue").value,
    address: field("address").value,
    description: field<HTMLTextAreaElement>("description").value,
    category: field<HTMLSelectElement>("category").value,
    status: field<HTMLSelectElement>("status").value,
    visibility: visibility(),
    capacity: field("capacity").value,
    volunteerTarget: field("volunteerTarget").value,
    volunteerCount: field("volunteerCount").value,
    personInCharge: field("personInCharge").value,
    requiredItems: field<HTMLTextAreaElement>("requiredItems").value,
    internalNotes: field<HTMLTextAreaElement>("internalNotes").value,
    displayOrder: field("displayOrder").value,
    postToNews: field("postToNews").checked,
  };
}

function fillForm(event: EventRecord): void {
  field("title").value = event.title;
  field("eventDate").value = event.eventDate;
  field("startTime").value = event.startTime;
  field("endTime").value = event.endTime;
  field("venue").value = event.venue;
  field("address").value = event.address;
  field<HTMLTextAreaElement>("description").value = event.description;
  field<HTMLSelectElement>("category").value = event.category;
  field<HTMLSelectElement>("status").value = event.status;
  form!.querySelectorAll<HTMLInputElement>('input[name="visibility"]').forEach((radio) => {
    radio.checked = radio.value === event.visibility;
  });
  field("capacity").value = event.capacity === null ? "" : String(event.capacity);
  field("volunteerTarget").value = String(event.volunteerTarget);
  field("volunteerCount").value = String(event.volunteerCount);
  field("personInCharge").value = event.personInCharge;
  field<HTMLTextAreaElement>("requiredItems").value = event.requiredItems;
  field<HTMLTextAreaElement>("internalNotes").value = event.internalNotes;
  field("displayOrder").value = String(event.displayOrder);
  field("postToNews").checked = event.postedToNews;
}

function editingId(): string | null {
  return /^\/staff\/events\/([1-9]\d{0,9})\/edit\/?$/.exec(location.pathname)?.[1] ?? null;
}

async function init(): Promise<void> {
  if (!form) return;
  const mode = form.dataset.mode;
  const id = mode === "edit" ? editingId() : null;
  const submit = form.querySelector<HTMLButtonElement>("[data-submit]");
  form.querySelectorAll('input[name="visibility"]').forEach((radio) => radio.addEventListener("change", syncNewsCheckbox));

  if (mode === "edit") {
    form.classList.add("hidden");
    if (!id) {
      showNotice(notice, "編集するイベントが指定されていません。一覧から選び直してください。", "error");
      return;
    }
    const result = await staffApi<{ event: EventRecord }>(`/staff/api/events/${id}`);
    if (!result.ok || !result.data) {
      showNotice(notice, apiErrorMessage(result, "イベント"), "error");
      return;
    }
    fillForm(result.data.event);
    form.classList.remove("hidden");
  }
  syncNewsCheckbox();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    if (submit) submit.disabled = true;
    const result = await staffApi<{ event: EventRecord; news: string }>(id ? `/staff/api/events/${id}` : "/staff/api/events", {
      method: id ? "PUT" : "POST",
      body: readForm(),
    });
    if (submit) submit.disabled = false;
    if (result.ok) {
      location.href = `/staff/events/?saved=${id ? "updated" : "created"}&news=${encodeURIComponent(result.data?.news ?? "none")}`;
      return;
    }
    showNotice(notice, apiErrorMessage(result, "イベント"), "error");
    if (result.data?.fields) showFieldErrors(form, result.data.fields);
  });
}

void init();
