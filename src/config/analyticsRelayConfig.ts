// アクセス解析の中継（services/ga4-proxy。Google Cloud の Cloud Run）を動かしている Google Cloud の契約状況です。
// 執行部ポータル /staff/analytics/ に、無料トライアルの終了でアクセス解析が止まることを案内するために使います
// （src/utils/analyticsRelayNotice.ts）。
//
// ・plan: "free_trial" … 無料トライアル中（freeTrialEndsOn の日に終了する）。
//          "paid"       … 有料アカウントに切り替え済み（案内を出さない）。
//          null         … 中継を使っていない（案内を出さない）。
// ・有料アカウントに切り替えたら plan を "paid" に、別の方式にしたら null に変更してください。
// ・無料トライアルは、期限より前でも残高（クレジット）を使い切ると終了します。

export interface AnalyticsRelayHosting {
  plan: "free_trial" | "paid" | null;
  /** 無料トライアルの終了日（日本時間。YYYY-MM-DD） */
  freeTrialEndsOn: string;
  /** 終了日のこの日数前から、案内を「注意」として強調する */
  warnDaysBefore: number;
}

export const analyticsRelayHosting: AnalyticsRelayHosting = {
  plan: "free_trial",
  freeTrialEndsOn: "2026-12-31",
  warnDaysBefore: 30,
};
