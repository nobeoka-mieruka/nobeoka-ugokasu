// =============================================================
// 「みんなの声ポスト」ページ（/voice-post/）に関する設定です。
//
// 【フォームを公開する場合】
// VOICE_POST_FORM_URL に、福富千恵と延岡を動かす会が管理する専用フォームの回答用URLを設定してください。
// 他団体が管理するフォームのURLは設定しないでください。
// 空のあいだは送信への導線を表示せず、ページは検索エンジンにも登録しません（noindex・サイトマップ除外）。
// 手順は docs/voice-post.md を参照してください。
// =============================================================

import { dialogueConfig } from "./dialogueConfig";
import { voicesConfig } from "./voicesConfig";

/** 専用フォームの回答用URL（架空のURLを入れない） */
const VOICE_POST_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfX-tqdj8dt4g0qvPTjupxEn-QlBbHFmZEQ4ITsO4foLCLrZw/viewform";

/** 公開してよいURLだけを返します。空欄・https以外・編集用URL・サイト内の既存フォームと同じURLは null です。 */
export function resolveVoicePostFormUrl(rawUrl: string): string | null {
  const value = rawUrl.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname === "docs.google.com" && /\/edit\/?$/.test(url.pathname)) return null;
  const formPath = (target: URL) => `${target.hostname}${target.pathname.replace(/\/[^/]*\/?$/, "")}`;
  const existingForms = [dialogueConfig.formUrl, voicesConfig.googleFormUrl];
  if (existingForms.some((form) => formPath(new URL(form)) === formPath(url))) return null;
  return value;
}

const formUrl = resolveVoicePostFormUrl(VOICE_POST_FORM_URL);

export const voicePostConfig = {
  /** 専用フォームの回答用URL。未設定なら null */
  formUrl,
} as const;

/** フォームの回答項目。ページでは説明として表示します（入力欄にはしません）。フォームと文言を合わせてください */
export const VOICE_POST_OPTIONS = ["困っていること", "疑問に思うこと", "こうなったらいいな！"] as const;

/** 回答の前に表示する説明文（指定の文言のため、変更する場合は主催者に確認してください） */
export const VOICE_POST_NOTICES = [
  "お寄せいただいたご意見は、福富千恵と延岡を動かす会が管理し、地域の福祉課題の把握や今後の活動・政策検討・提案の参考として活用します。",
  "個人が特定されないよう整理した集計結果を、公表したり関係機関等と共有したりする場合があります。",
  "氏名・施設名・病歴など、個人が特定される情報は入力しないでください。",
  "このフォームは延岡市の公式相談窓口ではありません。",
] as const;
