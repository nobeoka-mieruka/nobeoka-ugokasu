import { siteConfig } from "../config/siteConfig";
import { getConfirmedSocialLinks } from "../data/socialLinks";
import { absoluteUrl } from "./seo";

/** サイト全体で使い回す@id（WebSiteとOrganizationを相互参照させるため） */
export const organizationId = `${siteConfig.siteUrl}/#organization`;
export const websiteId = `${siteConfig.siteUrl}/#website`;

/** ロゴの実寸法（public/images/logo/kouenkainamaeirilogo.png） */
const logoImageObject = {
  "@type": "ImageObject" as const,
  url: absoluteUrl(siteConfig.logo),
  width: 2172,
  height: 724,
};

/** Organization構造化データ（確認済み情報のみ含める：19章） */
export function organizationSchema() {
  const sameAs = getConfirmedSocialLinks();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": organizationId,
    name: siteConfig.organizationName,
    url: siteConfig.siteUrl,
    ...(siteConfig.logo ? { logo: logoImageObject } : {}),
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

/** WebSite構造化データ（publisherはOrganizationの@id参照） */
export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": websiteId,
    name: siteConfig.siteName,
    url: siteConfig.siteUrl,
    inLanguage: "ja",
    publisher: { "@id": organizationId },
  };
}

/**
 * Person（福富千恵本人）の@id。
 * ページをまたいで同一人物として認識できるよう、Personを出力する全ページで
 * このURLに統一する（ProfilePage.mainEntityからの参照にも使用：SEO 20章）。
 */
export const personId = `${siteConfig.siteUrl}/#person`;

/** Person構造化データ（確認済み情報のみ含める：19章） */
export function personSchema(options?: { image?: string; imageWidth?: number; imageHeight?: number }) {
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
      "@id": organizationId,
      name: siteConfig.organizationName,
      url: siteConfig.siteUrl,
    },
    ...(options?.image
      ? {
          image: {
            "@type": "ImageObject",
            url: absoluteUrl(options.image),
            ...(options.imageWidth ? { width: options.imageWidth } : {}),
            ...(options.imageHeight ? { height: options.imageHeight } : {}),
          },
        }
      : {}),
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
  /** imageの実寸法。省略時は共通OGP画像の寸法（1200×630）を使用 */
  imageWidth?: number;
  imageHeight?: number;
  /**
   * mainEntityとして参照する既存ノードの@id（例：personId）。
   * ProfilePageではGoogleがmainEntityを必須項目として扱うため、
   * 同一ページに出力済みのPersonなどを@id参照で指定する（Personを二重定義しないこと）。
   */
  mainEntityId?: string;
}) {
  const imagePath = options.image ?? siteConfig.defaultOgpImage;
  const hasCustomImage = options.image !== undefined;
  return {
    "@context": "https://schema.org",
    "@type": options.type ?? "WebPage",
    name: options.name,
    description: options.description,
    url: absoluteUrl(options.path),
    inLanguage: "ja",
    isPartOf: { "@id": websiteId },
    ...(options.mainEntityId ? { mainEntity: { "@id": options.mainEntityId } } : {}),
    primaryImageOfPage: {
      "@type": "ImageObject",
      url: absoluteUrl(imagePath),
      width: hasCustomImage ? (options.imageWidth ?? 1200) : 1200,
      height: hasCustomImage ? (options.imageHeight ?? 630) : 630,
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
  /** imageの実寸法（画面に表示している実画像の寸法と一致させること） */
  imageWidth?: number;
  imageHeight?: number;
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
      "@id": organizationId,
      name: siteConfig.organizationName,
    },
    publisher: {
      "@type": "Organization",
      "@id": organizationId,
      name: siteConfig.organizationName,
      ...(siteConfig.logo ? { logo: logoImageObject } : {}),
    },
    ...(options.image
      ? {
          image: {
            "@type": "ImageObject",
            url: absoluteUrl(options.image),
            ...(options.imageWidth ? { width: options.imageWidth } : {}),
            ...(options.imageHeight ? { height: options.imageHeight } : {}),
          },
        }
      : {}),
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
