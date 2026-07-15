// 公式SNS・外部連携リンク（未確認のものは空欄のままにしてください）
// 空欄の項目はボタン・アイコンが自動的に非表示になります。

export const socialLinks: Record<"line" | "instagram" | "x" | "facebook" | "youtube", string> = {
  /** LINE公式アカウントURL（未設定） */
  line: "",

  /** Instagram URL（未設定） */
  instagram: "",

  /** X（Twitter）URL（未設定） */
  x: "",

  /** Facebook URL（未設定） */
  facebook: "",

  /** YouTube URL（未設定） */
  youtube: "",
};

export type SocialLinks = typeof socialLinks;

/** 構造化データ Organization/Person の sameAs に含めてよい確認済みリンクのみ抽出 */
export function getConfirmedSocialLinks(): string[] {
  return Object.values(socialLinks).filter((url) => Boolean(url));
}
