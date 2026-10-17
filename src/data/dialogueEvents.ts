// 意見交換会の開催予定（/dialogue/ の「今後の意見交換会」に表示）
//
// 【開催予定を追加する場合】
// dialogueEvents 配列に1件ずつ追加してください。例：
//
//   {
//     id: "2026-11-ohno",
//     title: "意見交換会",
//     date: "2026-11-08",       // YYYY-MM-DD（未定の間は空文字 ""）
//     startTime: "10:00",       // HH:MM（未定の間は空文字 ""）
//     endTime: "11:30",
//     venue: "○○公民館",
//     address: "宮崎県延岡市○○町1-2-3",
//     description: "福富千恵と、延岡のこれからについて気軽にお話ししませんか？",
//     capacity: 20,             // 定員を設けない場合は null
//     status: "受付中",
//     applicationOpen: true,    // true の間だけ「参加を申し込む」ボタンを表示
//   },
//
// 【注意】
// ・仮の日付や架空の会場は登録しないでください。日時・会場が確定するまでは
//   status を "日程調整中" にし、date / startTime / venue を空文字にしてください。
// ・日時・会場がすべて確定し、status が "日程調整中" 以外のものだけが
//   schema.org の Event 構造化データとして出力されます。
// ・終了した回は削除せず status を "開催済み" に変更すると、
//   「これまでの意見交換会」として表示されます。

export type DialogueEventStatus = "受付中" | "受付終了" | "開催済み" | "日程調整中";

export interface DialogueEvent {
  id: string;
  title: string;
  /** 開催日（YYYY-MM-DD）。未定の場合は空文字 */
  date: string;
  /** 開始時刻（HH:MM）。未定の場合は空文字 */
  startTime: string;
  /** 終了時刻（HH:MM）。未定の場合は空文字 */
  endTime: string;
  /** 会場名。未定の場合は空文字 */
  venue: string;
  /** 会場の住所。非公開・未定の場合は空文字 */
  address: string;
  description: string;
  /** 定員（人）。定員を設けない場合は null */
  capacity: number | null;
  status: DialogueEventStatus;
  /** 参加申込を受け付けているかどうか */
  applicationOpen: boolean;
}

export const dialogueEvents: DialogueEvent[] = [];
