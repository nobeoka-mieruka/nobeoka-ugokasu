// 意見交換会の開催予定の型です。
// 開催予定は執行部ポータル（/staff/dialogue/）から登録し、Cloudflare D1（dialogue_events テーブル）に保存します。
// 公開ページ /dialogue/ は、配信時に D1 の内容を読み込んで表示します（functions/dialogue/index.ts）。

/** 受付状況（D1に保存する内部値） */
export const DIALOGUE_STATUSES = ["open", "closed", "scheduling", "completed"] as const;
export type DialogueStatus = (typeof DIALOGUE_STATUSES)[number];

/** 受付状況の表示名 */
export const DIALOGUE_STATUS_LABELS: Record<DialogueStatus, string> = {
  open: "受付中",
  closed: "受付終了",
  scheduling: "日程調整中",
  completed: "開催済み",
};

/** 公開ページへ出してよい項目だけを持つ開催予定（個人情報・作成者は含めない） */
export interface DialogueEvent {
  id: number;
  title: string;
  /** 開催日（YYYY-MM-DD） */
  eventDate: string;
  /** 開始時刻（HH:MM） */
  startTime: string;
  /** 終了時刻（HH:MM）。未定の場合は空文字 */
  endTime: string;
  venue: string;
  /** 会場の住所。非公開・未定の場合は空文字 */
  address: string;
  description: string;
  /** 定員（人）。定員を設けない場合は null */
  capacity: number | null;
  status: DialogueStatus;
  /** 参加申込を受け付けているかどうか（受付中かつ true の間だけ「参加を申し込む」を表示） */
  applicationOpen: boolean;
  /** 表示順（小さいほど先。同じ値の間は開催日順） */
  displayOrder: number;
}

/** 執行部ポータルで扱う開催予定（管理用の項目を含む） */
export interface DialogueEventRecord extends DialogueEvent {
  /** 公開ページに表示するかどうか（false の間は下書き） */
  isPublished: boolean;
  /** UNIX時刻（秒） */
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}
