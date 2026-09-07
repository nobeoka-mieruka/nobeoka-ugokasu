// =============================================================
// 活動報告を「サイト側」で管理するためのファイルです。
//
// このファイルに1件追加するだけで、
//   ・トップページの「最新の活動報告」（最新3件）
//   ・活動報告一覧ページ（/activities/）
// の両方へ自動的に反映されます（新しい日付順に並び替えられます）。
//
// SNS（Facebook・Instagram・Threads）のAPI取得に依存しないため、
// SNS側が一時的に取得できない場合でも、ここに登録した活動は必ず表示されます。
//
// -------------------------------------------------------------
// 【新しい活動を追加する手順】
// 1. 下の activityEntries 配列に、次の形でオブジェクトを1件追加する
// 2. 画像を載せる場合は public/images/activities/ にファイルを置き、
//    "/images/activities/ファイル名.jpg" のようなサイト内パスを指定する
//    （SNSの画像URLを直接指定しないこと。期限切れ・削除で表示できなくなるため）
// 3. npm run build が通ることを確認する
//
// 記入例：
// {
//   id: "2026-08-25-signboard",
//   date: "2026-08-25",
//   title: "新たに看板を設置しました",
//   summary: "延岡市内に活動をお知らせする看板を新しく設置しました。",
//   category: "地域活動",
//   platform: "facebook",
//   url: "https://www.facebook.com/xxxxxxxxx/posts/xxxxxxxxx",
//   image: { src: "/images/activities/2026-08-25-signboard.jpg", alt: "新しく設置した看板" },
// },
//
// -------------------------------------------------------------
// 【入力ルール】
// ・確認できていない内容・日付は登録しないでください（推測での入力は禁止です）。
// ・date は必ず "YYYY-MM-DD" 形式で入力してください。
// ・未来の日付を入力した記事は、その日が来るまで自動的に非表示になります。
// ・platform を "website" にすると、SNSへのリンクなしの活動報告として表示されます
//   （その場合 url は省略できます）。
// ・url を省略した場合、カードはリンクにならず情報のみの表示になります。
// =============================================================

/** 活動報告の掲載元。"website" はサイト独自の活動報告（SNS投稿なし）を表します。 */
export type ActivityEntryPlatform = "facebook" | "instagram" | "threads" | "website";

export interface ActivityEntry {
  /** 他の活動報告と重複しない識別子（例: "2026-08-25-signboard"） */
  id: string;
  /** 活動日・投稿日（"YYYY-MM-DD"形式） */
  date: string;
  /** 見出し */
  title: string;
  /** 本文概要（カードに表示されます。2〜3行程度） */
  summary: string;
  /** カテゴリ（例: "地域活動" / "意見交換会" / "福祉" / "子育て" / "防災"） */
  category: string;
  /** 掲載元SNS。SNS投稿がない場合は "website" */
  platform: ActivityEntryPlatform;
  /** SNS投稿など、詳細を見られる公開URL（省略可） */
  url?: string;
  /** サムネイル画像（省略可）。public/images/activities/ 配下のサイト内パスを指定する */
  image?: {
    src: string;
    alt: string;
  };
  /** 内容を後から更新した場合の更新日（"YYYY-MM-DD"形式、省略可） */
  updatedAt?: string;
}

/**
 * 活動報告の登録一覧。
 * 実際に確認できた活動だけを追加してください（架空の活動は登録しないでください）。
 */
export const activityEntries: ActivityEntry[] = [];

/** "YYYY-MM-DD" 等の日付文字列を安全に Date へ変換する（不正な値は null） */
function parseEntryDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * 公開対象の活動報告を、新しい日付順で返す。
 * ・日付が不正な項目は除外する（ビルドを止めず、表示だけを守る）
 * ・未来の日付の項目は、その日が来るまで除外する
 */
export function getSortedActivityEntries(now: number = Date.now()): ActivityEntry[] {
  return activityEntries
    .filter((entry) => {
      const date = parseEntryDate(entry.date);
      return date !== null && date.getTime() <= now;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/** この一覧の中で最も新しい更新日（updatedAt、なければ date）を返す。0件の場合は null */
export function getActivityEntriesLastUpdated(): string | null {
  const timestamps = activityEntries
    .map((entry) => parseEntryDate(entry.updatedAt ?? entry.date))
    .filter((date): date is Date => date !== null)
    .map((date) => date.getTime());

  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}
