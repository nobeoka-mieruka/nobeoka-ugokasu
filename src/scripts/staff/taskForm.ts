// タスクの登録・編集フォームの送信処理（ブラウザで動作）。
// 編集画面（/staff/tasks/:id/edit/）では、URLの :id の内容をAPIから読み込んでフォームへ入れる。
// 完了のチェックと進捗を連動させる（完了 → 100%、未完了に戻す → 90%以下）。最終的な判定はサーバー側（server/tasks.ts）。
// 値は input.value / textContent でのみ扱い、HTMLとして解釈しない（XSS対策）。

import type { TaskRecord } from "../../types/tasks";
import { apiErrorMessage, showNotice, staffApi } from "./api";
import { clearFieldErrors, showFieldErrors } from "./formErrors";

const form = document.querySelector<HTMLFormElement>("[data-task-form]");
const notice = document.querySelector<HTMLElement>("[data-staff-notice]");
const MAX_OPEN_PROGRESS = 90;

function field<T extends HTMLElement = HTMLInputElement>(name: string): T {
  return form!.elements.namedItem(name) as unknown as T;
}

/** 進捗が100%のときは完了、完了を外したら90%以下にする（画面上の補助） */
function linkProgressAndCompletion(): void {
  const completed = field("completed");
  const progress = field<HTMLSelectElement>("progress");
  let progressBeforeCompletion = progress.value === "100" ? String(MAX_OPEN_PROGRESS) : progress.value;
  completed.addEventListener("change", () => {
    if (completed.checked) {
      progressBeforeCompletion = progress.value === "100" ? progressBeforeCompletion : progress.value;
      progress.value = "100";
    } else if (progress.value === "100") {
      progress.value = progressBeforeCompletion;
    }
  });
  progress.addEventListener("change", () => {
    completed.checked = progress.value === "100";
  });
}

function readForm() {
  return {
    title: field("title").value,
    assignee: field("assignee").value,
    dueDate: field("dueDate").value,
    priority: field<HTMLSelectElement>("priority").value,
    progress: field<HTMLSelectElement>("progress").value,
    notes: field<HTMLTextAreaElement>("notes").value,
    completed: field("completed").checked,
  };
}

function fillForm(task: TaskRecord): void {
  field("title").value = task.title;
  field("assignee").value = task.assignee;
  field("dueDate").value = task.dueDate;
  field<HTMLSelectElement>("priority").value = task.priority;
  const progress = field<HTMLSelectElement>("progress");
  // 10%刻み以外の値（APIから直接設定された場合など）も表示できるようにする
  if (![...progress.options].some((option) => option.value === String(task.progress))) {
    progress.add(new Option(`${task.progress}%`, String(task.progress)));
  }
  progress.value = String(task.progress);
  field<HTMLTextAreaElement>("notes").value = task.notes;
  field("completed").checked = task.completed;
}

function editingId(): string | null {
  return /^\/staff\/tasks\/([1-9]\d{0,9})\/edit\/?$/.exec(location.pathname)?.[1] ?? null;
}

async function init(): Promise<void> {
  if (!form) return;
  const mode = form.dataset.mode;
  const id = mode === "edit" ? editingId() : null;
  const submit = form.querySelector<HTMLButtonElement>("[data-submit]");

  if (mode === "edit") {
    form.classList.add("hidden");
    if (!id) {
      showNotice(notice, "編集するタスクが指定されていません。一覧から選び直してください。", "error");
      return;
    }
    const result = await staffApi<{ task: TaskRecord }>(`/staff/api/tasks/${id}`);
    if (!result.ok || !result.data) {
      showNotice(notice, apiErrorMessage(result, "タスク"), "error");
      return;
    }
    fillForm(result.data.task);
    form.classList.remove("hidden");
  }
  linkProgressAndCompletion();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    if (submit) submit.disabled = true;
    const result = await staffApi<{ task: TaskRecord }>(id ? `/staff/api/tasks/${id}` : "/staff/api/tasks", {
      method: id ? "PUT" : "POST",
      body: readForm(),
    });
    if (submit) submit.disabled = false;
    if (result.ok) {
      location.href = `/staff/tasks/?saved=${id ? "updated" : "created"}`;
      return;
    }
    showNotice(notice, apiErrorMessage(result, "タスク"), "error");
    if (result.data?.fields) showFieldErrors(form, result.data.fields);
  });
}

void init();
