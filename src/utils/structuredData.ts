import { siteConfig } from "../config/siteConfig";
import { getConfirmedSocialLinks } from "../data/socialLinks";
import { absoluteUrl } from "./seo";

/** Organization構造化データ（確認済み情報のみ含める：19章） */
export function organizationSchema() {
  const sameAs = getConfirmedSocialLinks();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteConfig.organizationName,
    url: siteConfig.siteUrl,
    ...(siteConfig.logo ? { logo: absoluteUrl(siteConfig.logo) } : {}),
    address: {
      "@type": "PostalAddress",
      postalCode: siteConfig.postalCode.replace("〒", ""),
      streetAddress: siteConfig.address,
      addressCountry: "JP",
    },
    email: siteConfig.email,
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

/** WebSite構造化データ */
export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.siteName,
    url: siteConfig.siteUrl,
    inLanguage: "ja",
  };
}

/**
 * Person（福富千恵本人）の@id。
 * ページをまたいで同一人物として認識できるよう、Personを出力する全ページで
 * このURLに統一する（ProfilePage.mainEntityからの参照にも使用：SEO 20章）。
 */
export const personId = `${siteConfig.siteUrl}/#person`;

/** Person構造化データ（確認済み情報のみ含める：19章） */
export function personSchema(options?: { image?: string }) {
  const sameAs = getConfirmedSocialLinks();
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": personId,
    name: siteConfig.personName,
    alternateName: siteConfig.personNameKana,
    url: absoluteUrl("/profile"),
    memberOf: {
      "@type": "Organization",
      name: siteConfig.organizationName,
      url: siteConfig.siteUrl,
    },
    ...(options?.image ? { image: absoluteUrl(options.image) } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

/** WebPage / ProfilePage 構造化データ */
export function webPageSchema(options: {
  type?: "WebPage" | "ProfilePage";
  path: string;
  name: string;
  description: string;
  /** 画面に実際に表示している画像のパス（例：OGP画像）。省略時は共通OGP画像を使用 */
  image?: string;
  /**
   * mainEntityとして参照する既存ノードの@id（例：personId）。
   * ProfilePageではGoogleがmainEntityを必須項目として扱うため、
   * 同一ページに出力済みのPersonなどを@id参照で指定する（Personを二重定義しないこと）。
   */
  mainEntityId?: string;
}) {
  const imagePath = options.image ?? siteConfig.defaultOgpImage;
  return {
    "@context": "https://schema.org",
    "@type": options.type ?? "WebPage",
    name: options.name,
    description: options.description,
    url: absoluteUrl(options.path),
    inLanguage: "ja",
    ...(options.mainEntityId ? { mainEntity: { "@id": options.mainEntityId } } : {}),
    primaryImageOfPage: {
      "@type": "ImageObject",
      url: absoluteUrl(imagePath),
      width: 1200,
      height: 630,
    },
  };
}

/** Article / NewsArticle 構造化データ */
export function articleSchema(options: {
  type?: "Article" | "NewsArticle";
  path: string;
  title: string;
  description: string;
  datePublished: Date;
  dateModified?: Date;
  image?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": options.type ?? "Article",
    headline: options.title,
    description: options.description,
    url: absoluteUrl(options.path),
    datePublished: options.datePublished.toISOString(),
    dateModified: (options.dateModified ?? options.datePublished).toISOString(),
    inLanguage: "ja",
    author: {
      "@type": "Organization",
      name: siteConfig.organizationName,
    },
    publisher: {
      "@type": "Organization",
      name: siteConfig.organizationName,
      ...(siteConfig.logo ? { logo: { "@type": "ImageObject", url: absoluteUrl(siteConfig.logo) } } : {}),
    },
    ...(options.image ? { image: absoluteUrl(options.image) } : {}),
  };
}

/** FAQPage構造化データ（画面に表示されているQ&Aのみ渡すこと：19章） */
export function faqPageSchema(items: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}
