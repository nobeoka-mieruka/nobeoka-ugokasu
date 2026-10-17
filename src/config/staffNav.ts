// 執行部ポータル（/staff/）の機能一覧です。
// ポータルTOPのカード（src/pages/staff/index.astro）と、各画面の共通ナビゲーション（src/components/staff/StaffNav.astro）の
// 両方がこの一覧を使います。機能を追加・公開するときは、ここに href を設定してください（href が無い間は「準備中」）。
//
// 【注意】一般公開サイトのヘッダー・フッターのメニュー（src/data/navigation.ts）には、管理機能へのリンクを追加しないでください。

import type { IconName } from "../types/icon";

export interface StaffSection {
  key: "top" | "dialogue" | "news" | "events" | "tasks" | "sns" | "documents";
  /** ナビゲーションでの表示名 */
  label: string;
  /** ポータルTOPのカードの見出し・説明（TOP自身はカードを出さない） */
  cardTitle?: string;
  description?: string;
  icon: IconName;
  /** 利用できる機能の入口。未実装の間は undefined（「準備中」と表示し、押せない） */
  href?: string;
}

export const STAFF_SECTIONS: readonly StaffSection[] = [
  { key: "top", label: "ポータルTOP", icon: "arrow-right", href: "/staff/" },
  {
    key: "dialogue",
    label: "意見交換会",
    cardTitle: "意見交換会",
    description: "開催予定の登録・編集・受付状況の変更（公開ページ /dialogue/ へ反映）",
    icon: "users",
    href: "/staff/dialogue/",
  },
  {
    key: "news",
    label: "お知らせ",
    cardTitle: "お知らせ管理",
    description: "トップページ「最新のお知らせ」の登録・編集・公開／非公開",
    icon: "document",
    href: "/staff/news/",
  },
  {
    key: "events",
    label: "イベント",
    cardTitle: "イベント",
    description: "イベントの登録・進捗・担当者・内部メモの管理（一般公開分は /events/ へ反映）",
    icon: "clock",
    href: "/staff/events/",
  },
  { key: "tasks", label: "タスク", cardTitle: "タスク", description: "執行部内のやること・担当の管理", icon: "check" },
  { key: "sns", label: "SNS", cardTitle: "SNS", description: "SNS投稿の同期状況の確認", icon: "megaphone" },
  { key: "documents", label: "資料", cardTitle: "資料", description: "執行部内の資料の共有", icon: "document" },
];

/** URLのパスから、表示中の機能を判定する（例："/staff/events/12/edit/" → "events"） */
export function currentStaffSection(pathname: string): StaffSection["key"] {
  const match = STAFF_SECTIONS.find((section) => section.key !== "top" && section.href && pathname.startsWith(section.href));
  return match?.key ?? "top";
}
