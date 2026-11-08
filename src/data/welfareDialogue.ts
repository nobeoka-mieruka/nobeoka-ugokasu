// 「福祉の現場の声を聴く 意見交換会」（福祉のお仕事に携わる方向け・全3回）の掲載内容です。
// 出典：案内チラシ public/pdfs/welfare-discussion-meeting-2026.pdf（令和8年10月 主催：福富千恵と延岡を動かす会）。
// 日時・会場などはチラシの記載どおりです。内容を変更する場合はチラシと食い違わないようにしてください。
//
// ・意見交換会ページ（/dialogue/）の上部に表示します（src/components/WelfareDialogueSection.astro）。
// ・各回の受付状況（受付中／受付終了／開催終了）は、日本時間の「今日」で判定します。
//   ページは配信時に functions/dialogue/index.ts がその日の状況に書き換えるため、ビルドした日の表示で固定されません。
// ・各回は schema.org Event としても出力します（開催日を過ぎた回は出力しません。これも配信時に判定します）。
//   同じ回を執行部ポータル（/staff/dialogue/）にも登録すると構造化データが重複するため、登録しないでください。

import type { DialogueEvent } from "../types/dialogue";
import { dialogueEventSchemas, formatDialogueDate, formatDialogueTime } from "../utils/dialogueEvents";

export const WELFARE_DIALOGUE_SECTION_ID = "welfare-dialogue";

export const WELFARE_DIALOGUE_TITLE = "福祉の現場の声を聴く 意見交換会";

/** 案内チラシ（PDF）。元のファイル名は「福祉事業従事者_意見交換会のご案内 (1).pdf」 */
export const WELFARE_DIALOGUE_PDF_URL = "/pdfs/welfare-discussion-meeting-2026.pdf";

/** SNS共有用の画像（1200×630） */
export const WELFARE_DIALOGUE_OG_IMAGE = "/images/ogp/ogp-welfare-dialogue-2026.png";
export const WELFARE_DIALOGUE_OG_IMAGE_ALT = "福祉の現場の声を聴く 意見交換会のご案内";

export const WELFARE_DIALOGUE_TARGET = "福祉のお仕事に携わっている方";
export const WELFARE_DIALOGUE_DEADLINE = "各開催日の2日前まで";
/** 申込締切：開催日の何日前まで受け付けるか（WELFARE_DIALOGUE_DEADLINE の「2日前まで」と同じ値にする） */
export const WELFARE_DIALOGUE_DEADLINE_DAYS_BEFORE = 2;

/**
 * 申込フォーム（Googleフォーム）が回答を受け付けているか。
 * Googleフォームの「回答を受け付ける」をオフにしたときは、ここも false にしてください（全日程を「受付終了」と表示します）。
 * サイトの定期チェック（docs/site-monitoring.md）が、ページの表示とGoogleフォームの受付状態の食い違いを知らせます。
 */
export const WELFARE_DIALOGUE_FORM_ACCEPTING = true;
export const WELFARE_DIALOGUE_DURATION = "各回、1時間～1時間半程度を予定しています。";
export const WELFARE_DIALOGUE_NOTICE = "利用者さまなど個人が特定される情報は控えてお話しください。";

/** こんなお話をお聞かせください（チラシ本文の4項目） */
export const WELFARE_DIALOGUE_TOPICS = [
  "仕事のやりがい",
  "現場で困っていること",
  "制度や働く環境への想い",
  "こんな支援があったらいい",
] as const;

export interface WelfareDialogueSession {
  round: number;
  /** YYYY-MM-DD */
  eventDate: string;
  /** HH:MM */
  startTime: string;
  /** 施設の正式名称 */
  facility: string;
  room: string;
}

export const WELFARE_DIALOGUE_SESSIONS: WelfareDialogueSession[] = [
  { round: 1, eventDate: "2026-11-14", startTime: "18:00", facility: "東海コミュニティセンター", room: "中会議室" },
  { round: 2, eventDate: "2026-11-25", startTime: "18:30", facility: "川中コミュニティセンター", room: "小会議室2" },
  { round: 3, eventDate: "2026-12-06", startTime: "10:00", facility: "土々呂コミュニティセンター", room: "中会議室" },
];

/** "2026年11月14日（土）" と "18:00～" */
export function welfareSessionLabels(session: WelfareDialogueSession) {
  return {
    date: formatDialogueDate(session.eventDate) ?? session.eventDate,
    time: formatDialogueTime({ startTime: session.startTime, endTime: "" }) ?? "",
  };
}

const SCHEMA_DESCRIPTION =
  "延岡市で福祉のお仕事に携わる皆さまを対象に、仕事のやりがいや現場で困っていること、制度や働く環境への想いなどを語り合う意見交換会です。話を聴くだけのご参加も歓迎です。";

/** 各回の schema.org Event（意見交換会ページの他の回と同じ形式。住所は確認できている市・県までに留める） */
export function welfareDialogueEventSchemas(today: string) {
  return dialogueEventSchemas(welfareDialogueEvents(today), today);
}

// ---- 受付状況（日本時間の日付で判定） ----

/** open … 受付中／closed … 受付終了（締切を過ぎた、またはフォームの受付を止めた）／finished … 開催終了（開催日を過ぎた） */
export type WelfareSessionStatus = "open" | "closed" | "finished";

export const WELFARE_SESSION_STATUS_LABELS: Record<WelfareSessionStatus, string> = {
  open: "受付中",
  closed: "受付終了",
  finished: "開催終了",
};

/** YYYY-MM-DD の日付を days 日ずらす */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 申込締切日（この日まで受け付ける。YYYY-MM-DD） */
export function welfareSessionDeadline(session: Pick<WelfareDialogueSession, "eventDate">): string {
  return shiftDate(session.eventDate, -WELFARE_DIALOGUE_DEADLINE_DAYS_BEFORE);
}

/** today は日本時間の今日（todayInJapan()）。開催日当日は「受付終了」、翌日から「開催終了」 */
export function welfareSessionStatus(
  session: Pick<WelfareDialogueSession, "eventDate">,
  today: string,
  formAccepting: boolean = WELFARE_DIALOGUE_FORM_ACCEPTING,
): WelfareSessionStatus {
  if (today > session.eventDate) return "finished";
  if (!formAccepting || today > welfareSessionDeadline(session)) return "closed";
  return "open";
}

export interface WelfareDialogueState {
  today: string;
  sessions: (WelfareDialogueSession & { status: WelfareSessionStatus; deadline: string })[];
  /** 受付中の回があるか（申込ボタンを表示するか） */
  anyOpen: boolean;
  /** 全回とも開催日を過ぎたか */
  allFinished: boolean;
}

export function welfareDialogueState(today: string, formAccepting: boolean = WELFARE_DIALOGUE_FORM_ACCEPTING): WelfareDialogueState {
  const sessions = WELFARE_DIALOGUE_SESSIONS.map((session) => ({
    ...session,
    status: welfareSessionStatus(session, today, formAccepting),
    deadline: welfareSessionDeadline(session),
  }));
  return {
    today,
    sessions,
    anyOpen: sessions.some((session) => session.status === "open"),
    allFinished: sessions.every((session) => session.status === "finished"),
  };
}

/** 各回の DialogueEvent（構造化データ用）。受付状況を反映する */
export function welfareDialogueEvents(today: string, formAccepting: boolean = WELFARE_DIALOGUE_FORM_ACCEPTING): DialogueEvent[] {
  return welfareDialogueState(today, formAccepting).sessions.map((session) => ({
    id: session.round,
    title: `${WELFARE_DIALOGUE_TITLE}（第${session.round}回）`,
    eventDate: session.eventDate,
    startTime: session.startTime,
    endTime: "",
    venue: session.facility,
    address: "",
    description: `${SCHEMA_DESCRIPTION}会場：${session.facility}（${session.room}）`,
    capacity: null,
    status: session.status === "finished" ? "completed" : session.status,
    applicationOpen: session.status === "open",
    displayOrder: session.round,
  }));
}
