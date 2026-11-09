// /staff/analytics/ に出す「Google Cloud の無料トライアル終了」の案内文を作ります（設定は src/config/analyticsRelayConfig.ts）。
// 終了後に数値を推定・表示することはしません。止まったときは、今まで通り「データは未取得です」と表示します。

import type { AnalyticsRelayHosting } from "../config/analyticsRelayConfig";

export interface RelayNotice {
  /** info：お知らせ／warning：終了が近い／ended：終了日を過ぎた */
  level: "info" | "warning" | "ended";
  title: string;
  lines: string[];
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayNumber(date: string): number | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** 「2026年12月31日」の形にする */
export function japaneseDate(date: string): string {
  const match = DATE_PATTERN.exec(date);
  return match ? `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日` : date;
}

/** today（日本時間の YYYY-MM-DD）時点の案内。案内が不要なら null */
export function relayHostingNotice(hosting: AnalyticsRelayHosting, today: string): RelayNotice | null {
  if (hosting.plan !== "free_trial") return null;
  const end = dayNumber(hosting.freeTrialEndsOn);
  const now = dayNumber(today);
  if (end === null || now === null) return null;
  const endText = japaneseDate(hosting.freeTrialEndsOn);
  const remaining = end - now;
  const howToContinue = "続ける場合は、管理者が Google Cloud の「お支払い」で有料アカウントへの切り替えを判断してください（中継の費用は、通常の利用なら無料枠の範囲内の見込みです）。";
  if (remaining < 0) {
    return {
      level: "ended",
      title: `Google Cloud の無料トライアルは${endText}に終了しました`,
      lines: [
        "有料アカウントに切り替えていない場合、アクセス解析の中継（Cloud Run）は止まっており、GA4 のデータは取得できません（数値は表示されません）。",
        howToContinue,
        "切り替えた後は、src/config/analyticsRelayConfig.ts の plan を \"paid\" に変更すると、この案内は表示されなくなります。",
      ],
    };
  }
  const when = remaining === 0 ? "本日" : `${endText}（あと${remaining}日）`;
  return {
    level: remaining <= hosting.warnDaysBefore ? "warning" : "info",
    title: `アクセス解析の中継は、Google Cloud の無料トライアルで動いています（${when}に終了）`,
    lines: [
      `無料トライアルが終了すると、有料アカウントに切り替えていない限り、アクセス解析のデータを取得できなくなります（数値は表示されなくなります）。残高（クレジット）を使い切った場合も、${endText}より前に終了します。`,
      howToContinue,
    ],
  };
}
