// イベント（執行部ポータル /staff/events/ で管理、D1: events テーブル）の型です。
//
// 【意見交換会との違い】
// 「意見交換会」は専用の管理機能（/staff/dialogue/、D1: dialogue_events、公開ページ /dialogue/）があります。
// このイベント管理とは別物です。意見交換会はイベント管理に重複して登録しないでください。
// カテゴリー「意見交換」（exchange）は、意見交換会以外の交流・懇談の催しのためのものです。

/** カテゴリー（D1に保存する内部値） */
export const EVENT_CATEGORIES = ["supporters", "community", "exchange", "volunteer", "street", "meeting", "other"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  supporters: "後援会活動",
  community: "地域イベント",
  exchange: "意見交換",
  volunteer: "ボランティア",
  street: "街頭活動",
  meeting: "会議",
  other: "その他",
};

/** 開催状況（D1に保存する内部値） */
export const EVENT_STATUSES = ["planning", "preparing", "open", "scheduled", "completed", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  planning: "企画中",
  preparing: "準備中",
  open: "受付中",
  scheduled: "開催予定",
  completed: "終了",
  cancelled: "中止",
};

/** 公開範囲。public（一般公開）のイベントだけを公開ページに表示する */
export const EVENT_VISIBILITIES = ["public", "internal"] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

export const EVENT_VISIBILITY_LABELS: Record<EventVisibility, string> = {
  public: "一般公開",
  internal: "執行部のみ",
};

/**
 * 公開ページへ出してよい項目だけを持つイベント。
 * 担当者・必要物品・内部メモ・ボランティア人数・作成者などは含めない（D1からも読み出さない）。
 */
export interface PublicEvent {
  id: number;
  title: string;
  /** 開催日（YYYY-MM-DD） */
  eventDate: string;
  /** 開始時刻（HH:MM） */
  startTime: string;
  /** 終了時刻（HH:MM）。未定の場合は空文字 */
  endTime: string;
  venue: string;
  address: string;
  description: string;
  category: EventCategory;
  status: EventStatus;
  displayOrder: number;
}

/** 執行部ポータルで扱うイベント（内部管理用の項目を含む。公開ページへは出さない） */
export interface EventRecord extends PublicEvent {
  visibility: EventVisibility;
  /** 定員（人）。定員を設けない場合は null */
  capacity: number | null;
  volunteerTarget: number;
  volunteerCount: number;
  personInCharge: string;
  requiredItems: string;
  internalNotes: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
  /** 「最新のお知らせ」に掲載中か（このイベントから作ったお知らせが公開中か） */
  postedToNews: boolean;
}
