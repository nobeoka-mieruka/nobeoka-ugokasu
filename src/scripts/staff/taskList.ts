// タスクの管理一覧（ブラウザで動作）：一覧表示（PCは表・スマホはカード）・絞り込み・完了／未完了・優先度と進捗の変更・削除。
// 値は textContent でのみ表示し、HTMLとして解釈しない（XSS対策）。
// 期限の状態は色だけでなく文字（期限切れ・今日まで・近日中）でも示す。

import { TASK_PRIORITY_LABELS, type TaskPriority, type TaskRecord } from "../../types/tasks";
import { formatDialogueDate, todayInJapan } from "../../utils/dialogueEvents";
import { DUE_STATE_LABELS, dueState, sortTasks, type DueState } from "../../utils/taskOrder";
import { apiErrorMessage, showNotice, staffApi } from "./api";

const rowTemplate = document.querySelector<HTMLTemplateElement>("[data-task-row-template]");
const cardTemplate = document.querySelector<HTMLTemplateElement>("[data-task-card-template]");
const loading = document.querySelector<HTMLElement>("[data-tasks-loading]");
const notice = document.querySelector<HTMLElement>("[data-staff-notice]");
const dialog = document.querySelector<HTMLDialogElement>("[data-delete-dialog]");

type Filter = "open" | "overdue" | "all";
let filter: Filter = "open";
let tasks: TaskRecord[] = [];

const SAVED_MESSAGES: Record<string, string> = { created: "タスクを登録しました。", updated: "変更を保存しました。" };

const PRIORITY_CLASS: Record<TaskPriority, string[]> = {
  high: ["bg-red-700", "text-white"],
  medium: ["bg-brand-orange-light", "text-ink"],
  low: ["bg-black/5", "text-ink-soft"],
};
const DUE_CLASS: Partial<Record<DueState, string[]>> = {
  overdue: ["bg-red-50", "text-red-800", "ring-1", "ring-red-700"],
  today: ["bg-brand-orange-dark", "text-white"],
  soon: ["bg-brand-orange-light", "text-brand-orange-dark"],
};

function setText(root: ParentNode, name: string, value: string): void {
  root.querySelectorAll<HTMLElement>(`[data-field="${name}"]`).forEach((el) => {
    el.textContent = value;
  });
}

function fill(root: HTMLElement, task: TaskRecord, today: string): HTMLElement {
  setText(root, "title", task.title);
  setText(root, "assignee", task.assignee ? `担当：${task.assignee}` : "担当：未定");
  root.querySelectorAll<HTMLElement>('dd[data-field="assignee"]').forEach((el) => (el.textContent = task.assignee || "未定"));
  setText(root, "due", task.dueDate ? (formatDialogueDate(task.dueDate) ?? task.dueDate) : "期限なし");
  setText(root, "progress", `${task.progress}%`);
  root.querySelectorAll<HTMLElement>('[data-field="progressBar"]').forEach((el) => (el.style.width = `${task.progress}%`));

  const priority = root.querySelector<HTMLElement>('[data-field="priority"]')!;
  priority.textContent = `優先度：${TASK_PRIORITY_LABELS[task.priority]}`;
  priority.classList.add(...PRIORITY_CLASS[task.priority]);

  const state = task.completed ? "none" : dueState(task, today);
  const stateBadge = root.querySelector<HTMLElement>('[data-field="dueState"]')!;
  if (!task.completed && DUE_CLASS[state]) {
    stateBadge.textContent = DUE_STATE_LABELS[state];
    stateBadge.classList.add(...DUE_CLASS[state]!);
    stateBadge.classList.remove("hidden");
  }
  if (task.completed) {
    stateBadge.textContent = "完了";
    stateBadge.classList.add("bg-black/10", "text-ink");
    stateBadge.classList.remove("hidden");
  }
  if (task.notes) {
    root.querySelector('[data-field="notesFlag"]')?.classList.remove("hidden");
    const notes = root.querySelector<HTMLElement>('div[data-field="notes"]');
    if (notes) {
      notes.textContent = task.notes;
      notes.classList.remove("hidden");
    }
  }

  const edit = root.querySelector<HTMLAnchorElement>("[data-edit-link]")!;
  edit.href = `/staff/tasks/${task.id}/edit/`;
  edit.setAttribute("aria-label", `「${task.title}」を編集`);

  // 優先度・進捗の変更
  const quick = root.querySelector<HTMLElement>("[data-quick-change]")!;
  const prioritySelect = quick.querySelector<HTMLSelectElement>('select[name="priority"]')!;
  const progressSelect = quick.querySelector<HTMLSelectElement>('select[name="progress"]')!;
  prioritySelect.value = task.priority;
  if (![...progressSelect.options].some((option) => option.value === String(task.progress))) {
    progressSelect.add(new Option(`進捗：${task.progress}%`, String(task.progress)));
  }
  progressSelect.value = String(task.progress);
  prioritySelect.setAttribute("aria-label", `「${task.title}」の優先度`);
  progressSelect.setAttribute("aria-label", `「${task.title}」の進捗`);
  quick.querySelector<HTMLButtonElement>("[data-quick-submit]")!.addEventListener("click", async () => {
    const body: Record<string, unknown> = {};
    if (prioritySelect.value !== task.priority) body.priority = prioritySelect.value;
    if (progressSelect.value !== String(task.progress)) body.progress = Number(progressSelect.value);
    if (Object.keys(body).length === 0) return showNotice(notice, "優先度・進捗は変更されていません。", "info");
    await change(task, body, `「${task.title}」の${body.priority ? "優先度" : ""}${body.priority && body.progress !== undefined ? "・" : ""}${body.progress !== undefined ? "進捗" : ""}を変更しました。`);
  });

  const toggle = root.querySelector<HTMLButtonElement>("[data-toggle-complete]")!;
  toggle.textContent = task.completed ? "未完了に戻す" : "完了にする";
  toggle.setAttribute("aria-label", `「${task.title}」を${task.completed ? "未完了に戻す" : "完了にする"}`);
  toggle.addEventListener("click", () =>
    change(task, { completed: !task.completed }, task.completed ? `「${task.title}」を未完了に戻しました。` : `「${task.title}」を完了にしました。`),
  );

  const deleteButton = root.querySelector<HTMLButtonElement>("[data-delete]")!;
  deleteButton.setAttribute("aria-label", `「${task.title}」を削除`);
  deleteButton.addEventListener("click", () => confirmDelete(task));
  return root;
}

async function change(task: TaskRecord, body: Record<string, unknown>, message: string): Promise<void> {
  const result = await staffApi(`/staff/api/tasks/${task.id}`, { method: "PATCH", body });
  if (!result.ok) return showNotice(notice, apiErrorMessage(result, "タスク"), "error");
  showNotice(notice, message, "info");
  await load();
}

function confirmDelete(task: TaskRecord): void {
  if (!dialog) return;
  dialog.querySelector<HTMLElement>("[data-delete-title]")!.textContent = task.title;
  dialog.returnValue = "";
  dialog.addEventListener(
    "close",
    async () => {
      if (dialog.returnValue !== "confirm") return;
      const result = await staffApi(`/staff/api/tasks/${task.id}`, { method: "DELETE" });
      if (!result.ok) return showNotice(notice, apiErrorMessage(result, "タスク"), "error");
      showNotice(notice, `「${task.title}」を削除しました。`, "info");
      await load();
    },
    { once: true },
  );
  dialog.showModal();
}

function render(): void {
  if (!rowTemplate || !cardTemplate) return;
  const today = todayInJapan();
  const sorted = sortTasks(tasks, today);
  const open = sorted.filter((task) => !task.completed && (filter !== "overdue" || dueState(task, today) === "overdue"));
  const done = filter === "all" ? sorted.filter((task) => task.completed) : [];
  for (const [key, list, visible] of [["open", open, true], ["done", done, filter === "all"]] as const) {
    const group = document.querySelector<HTMLElement>(`[data-tasks-group="${key}"]`);
    if (!group) continue;
    group.classList.toggle("hidden", !visible);
    group.querySelector("[data-tasks-count]")!.textContent = `（${list.length}件）`;
    group.querySelector("[data-tasks-empty]")?.classList.toggle("hidden", list.length > 0);
    group.querySelector("[data-tasks-table]")?.classList.toggle("lg:block", list.length > 0);
    group.querySelector("[data-tasks-rows]")?.replaceChildren(...list.map((task) => fill(rowTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement, task, today)));
    group.querySelector("[data-tasks-cards]")?.replaceChildren(...list.map((task) => fill(cardTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement, task, today)));
  }
  const openGroupTitle = document.querySelector<HTMLElement>('[data-tasks-group="open"] h2');
  if (openGroupTitle?.firstChild) openGroupTitle.firstChild.textContent = filter === "overdue" ? "期限切れのタスク" : "未完了のタスク";
}

async function load(): Promise<void> {
  const result = await staffApi<{ tasks: TaskRecord[] }>("/staff/api/tasks");
  loading?.classList.add("hidden");
  if (!result.ok || !result.data) {
    showNotice(notice, apiErrorMessage(result, "タスク"), "error");
    return;
  }
  tasks = result.data.tasks;
  render();
}

document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    filter = button.dataset.filter as Filter;
    document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    render();
  });
});

const saved = new URLSearchParams(location.search).get("saved");
if (saved && SAVED_MESSAGES[saved]) {
  showNotice(notice, SAVED_MESSAGES[saved], "info");
  history.replaceState(null, "", location.pathname);
}
void load();
