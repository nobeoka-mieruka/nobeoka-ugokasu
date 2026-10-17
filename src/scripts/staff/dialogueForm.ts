// 意見交換会の登録・編集フォームの送信処理（ブラウザで動作）。
// 編集画面（/staff/dialogue/:id/edit/）では、URLの :id の内容をAPIから読み込んでフォームへ入れる。
// 値は input.value / textContent でのみ扱い、HTMLとして解釈しない（XSS対策）。

import type { DialogueEventRecord } from "../../types/dialogue";
import { apiErrorMessage, showNotice, staffApi } from "./api";

const form = document.querySelector<HTMLFormElement>("[data-dialogue-form]");
const notice = document.querySelector<HTMLElement>("[data-staff-notice]");

function field<T extends HTMLElement = HTMLInputElement>(name: string): T {
  return form!.elements.namedItem(name) as unknown as T;
}

function clearErrors(): void {
  form?.querySelectorAll<HTMLElement>("[data-error-for]").forEach((el) => {
    el.textContent = "";
    el.classList.add("hidden");
  });
  form?.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
}

function showFieldErrors(fields: Record<string, string>): void {
  let first: HTMLElement | null = null;
  for (const [name, message] of Object.entries(fields)) {
    const error = form?.querySelector<HTMLElement>(`[data-error-for="${CSS.escape(name)}"]`);
    if (error) {
      error.textContent = message;
      error.classList.remove("hidden");
    }
    const input = form?.elements.namedItem(name);
    if (input instanceof HTMLElement) {
      input.setAttribute("aria-invalid", "true");
      first ??= input;
    }
  }
  first?.focus();
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
    capacity: field("capacity").value,
    status: field<HTMLSelectElement>("status").value,
    applicationOpen: field("applicationOpen").checked,
    isPublished: field("isPublished").checked,
    displayOrder: field("displayOrder").value,
  };
}

function fillForm(event: DialogueEventRecord): void {
  field("title").value = event.title;
  field("eventDate").value = event.eventDate;
  field("startTime").value = event.startTime;
  field("endTime").value = event.endTime;
  field("venue").value = event.venue;
  field("address").value = event.address;
  field<HTMLTextAreaElement>("description").value = event.description;
  field("capacity").value = event.capacity === null ? "" : String(event.capacity);
  field<HTMLSelectElement>("status").value = event.status;
  field("applicationOpen").checked = event.applicationOpen;
  field("isPublished").checked = event.isPublished;
  field("displayOrder").value = String(event.displayOrder);
}

function editingId(): string | null {
  return /^\/staff\/dialogue\/([1-9]\d{0,9})\/edit\/?$/.exec(location.pathname)?.[1] ?? null;
}

async function init(): Promise<void> {
  if (!form) return;
  const mode = form.dataset.mode;
  const id = mode === "edit" ? editingId() : null;
  const submit = form.querySelector<HTMLButtonElement>("[data-submit]");

  if (mode === "edit") {
    form.classList.add("hidden");
    if (!id) {
      showNotice(notice, "編集する意見交換会が指定されていません。一覧から選び直してください。", "error");
      return;
    }
    const result = await staffApi<{ event: DialogueEventRecord }>(`/staff/api/dialogue-events/${id}`);
    if (!result.ok || !result.data) {
      showNotice(notice, apiErrorMessage(result), "error");
      return;
    }
    fillForm(result.data.event);
    form.classList.remove("hidden");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors();
    if (submit) submit.disabled = true;
    const result = await staffApi<{ event: DialogueEventRecord }>(id ? `/staff/api/dialogue-events/${id}` : "/staff/api/dialogue-events", {
      method: id ? "PUT" : "POST",
      body: readForm(),
    });
    if (submit) submit.disabled = false;
    if (result.ok) {
      location.href = `/staff/dialogue/?saved=${id ? "updated" : "created"}`;
      return;
    }
    showNotice(notice, apiErrorMessage(result), "error");
    if (result.data?.fields) showFieldErrors(result.data.fields);
  });
}

void init();
