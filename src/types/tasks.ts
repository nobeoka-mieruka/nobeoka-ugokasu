// タスク（執行部ポータル /staff/tasks/ で管理、D1: tasks テーブル）の型です。
// 執行部内だけで使う機能で、公開ページには一切表示しません。

/** 優先度（D1に保存する内部値） */
export const TASK_PRIORITIES = ["high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

/** 進捗（%）の選択肢。10%刻み */
export const TASK_PROGRESS_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

export interface TaskRecord {
  id: number;
  title: string;
  /** 担当者（自由記入）。未定の場合は空文字 */
  assignee: string;
  /** 期限（YYYY-MM-DD）。期限なしの場合は空文字 */
  dueDate: string;
  priority: TaskPriority;
  /** 進捗（0〜100、10刻み） */
  progress: number;
  notes: string;
  completed: boolean;
  /** 完了した日時（UNIX時刻・秒）。未完了の場合は null */
  completedAt: number | null;
  completedBy: string | null;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}
