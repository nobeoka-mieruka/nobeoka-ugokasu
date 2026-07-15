import { siteConfig } from "../config/siteConfig";

/** 相対パスから絶対URL（canonical等）を生成する */
export function absoluteUrl(path: string): string {
  const base = siteConfig.siteUrl.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

export type BreadcrumbItem = {
  name: string;
  path: string;
};

/** パンくずリスト用のJSON-LD（BreadcrumbList）データを生成する */
export function buildBreadcrumbList(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/**
 * ページごとのnoindex判定。
 * サイト全体の allowIndexing が false の間は、全ページを一律noindexにする。
 * allowIndexing が true でも、ページ個別に draft/noindex指定があればそれを優先する。
 */
export function shouldNoindex(pageNoindex = false): boolean {
  if (!siteConfig.allowIndexing) return true;
  return pageNoindex;
}

/** 日本語のdescriptionをおおむね120文字までで自然に切り詰める */
export function truncateDescription(text: string, max = 120): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
