// タスク一覧の並び順と、期限の状態（期限切れ・今日・近日中）の判定です（執行部ポータルの画面とテストで使用）。
// 公開ページでは使いません。

import type { TaskPriority, TaskRecord } from "../types/tasks";

/** 「近日中」とみなす日数（今日を含まず、この日数以内） */
export const DUE_SOON_DAYS = 3;

export type DueState = "overdue" | "today" | "soon" | "later" | "none";

/** 期限の表示用の文言（色だけに頼らず文字でも状態を示す） */
export const DUE_STATE_LABELS: Record<DueState, string> = {
  overdue: "期限切れ",
  today: "今日まで",
  soon: "近日中",
  later: "",
  none: "期限なし",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** 期限の状態（today は日本時間の YYYY-MM-DD） */
export function dueState(task: Pick<TaskRecord, "dueDate">, today: string): DueState {
  if (!task.dueDate) return "none";
  const days = daysBetween(today, task.dueDate);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= DUE_SOON_DAYS) return "soon";
  return "later";
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

/**
 * 並び順のグループ（小さいほど上）。
 * 0: 期限切れ → 1: 期限が近い（今日・近日中）→ 2: 優先度「高」 → 3: 期限あり（先の日付）→ 4: 期限なし → 5: 完了済み
 */
function group(task: TaskRecord, today: string): number {
  if (task.completed) return 5;
  const state = dueState(task, today);
  if (state === "overdue") return 0;
  if (state === "today" || state === "soon") return 1;
  if (task.priority === "high") return 2;
  return state === "later" ? 3 : 4;
}

/** 一覧の並び順。同じグループの中は期限の近い順 → 優先度の高い順（完了済みは完了の新しい順） */
export function sortTasks(tasks: TaskRecord[], today: string): TaskRecord[] {
  return [...tasks].sort((a, b) => {
    const ga = group(a, today);
    const gb = group(b, today);
    if (ga !== gb) return ga - gb;
    if (ga === 5) return (b.completedAt ?? 0) - (a.completedAt ?? 0) || b.id - a.id;
    const due = (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31");
    return due || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id - b.id;
  });
}
