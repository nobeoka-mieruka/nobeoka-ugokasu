// =============================================================
// 「最終更新」表示を、サイト全体で同じルール・同じ書式に揃えるための共通処理です。
//
// 【方針（4章）】
// ・ページやデータに更新日（updatedAt / lastUpdated）がある場合は、その日付を表示する。
// ・無い場合は、そのデータファイルを最後に変更したGitコミットの日時
//   （scripts/generate-build-info.mjs が生成する src/data/build-info.json）を使う。
// ・アクセス時刻・ビルド実行時刻をそのまま「更新日時」として表示することはしない。
//   内容が変わっていないのに毎回日付が変わる表示は、閲覧者の判断を誤らせるため禁止。
// ・書式は「2026年9月7日」の形（時刻は表示しない）で統一する。
// =============================================================

import buildInfo from "../data/build-info.json";

/** build-info.json のうち、コンテンツごとの最終変更日時（Gitコミット日時）を持つ部分 */
type ContentLastModifiedKey = keyof typeof buildInfo.contentLastModified;

function toValidDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** サイト全体の最終更新日時（mainブランチの最新コミット日時）。取得できない場合は null */
export function getSiteLastUpdated(): Date | null {
  return toValidDate(buildInfo.lastUpdated);
}

/**
 * 指定したコンテンツ（データファイル）の最終更新日時を返す。
 * Gitが使えない環境などで取得できなかった場合は、サイト全体の最終更新日時へ、
 * それも無ければ null へ順に切り替える。
 */
export function getContentLastUpdated(key: ContentLastModifiedKey): Date | null {
  return toValidDate(buildInfo.contentLastModified?.[key]) ?? getSiteLastUpdated();
}

/**
 * 「最終更新」として表示する日付を決める。
 *
 * @param explicitDate 各コンテンツが持つ更新日（updatedAt / lastUpdated）。無ければ undefined
 * @param contentKey   更新日が無い場合に参照する、データファイルのGitコミット日時のキー
 * @returns 表示に使う Date。何も決められない場合は undefined（呼び出し側で非表示になる）
 */
export function resolveLastUpdated(
  explicitDate?: string | Date | null,
  contentKey?: ContentLastModifiedKey,
): Date | undefined {
  const explicit = toValidDate(explicitDate);
  if (explicit) return explicit;

  const fromContent = contentKey ? getContentLastUpdated(contentKey) : getSiteLastUpdated();
  return fromContent ?? undefined;
}

/** 「2026年9月7日」の形式へ整える（時刻は表示しない） */
export function formatLastUpdated(date: Date): string {
  return date.toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
