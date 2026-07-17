// 公式SNS・外部連携リンク（未確認のものは空欄のままにしてください）
// 空欄の項目はボタン・アイコンが自動的に非表示になります。
// Facebook・InstagramのURLはここへ直接書き込まず、src/config/socialConfig.ts で
// 一元管理しています（環境変数 FACEBOOK_PAGE_URL / INSTAGRAM_PROFILE_URL で上書き可能）。

import { socialConfig } from "../config/socialConfig";

export const socialLinks: Record<"line" | "instagram" | "x" | "facebook" | "youtube", string> = {
  /** LINE公式アカウントURL（未設定） */
  line: "",

  /** Instagram URL（src/config/socialConfig.ts で管理） */
  instagram: socialConfig.instagramProfileUrl,

  /** X（Twitter）URL（未設定） */
  x: "",

  /** Facebook URL（src/config/socialConfig.ts で管理） */
  facebook: socialConfig.facebookPageUrl,

  /** YouTube URL（未設定） */
  youtube: "",
};

export type SocialLinks = typeof socialLinks;

/** 構造化データ Organization/Person の sameAs に含めてよい確認済みリンクのみ抽出 */
export function getConfirmedSocialLinks(): string[] {
  return Object.values(socialLinks).filter((url) => Boolean(url));
}
