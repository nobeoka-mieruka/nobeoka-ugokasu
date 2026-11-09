// GA4 中継の起動（Cloud Run のコンテナが実行する）。設定が不正なら、値を出さずに理由の種類だけ記録して終了する。
import { readProxyConfig } from "./proxy.mjs";
import { createProxyServer } from "./server.mjs";

const setting = readProxyConfig(process.env);
if (!setting.ok) {
  console.error(JSON.stringify({ event: "ga4-proxy-config-invalid", issue: setting.issue }));
  process.exit(1);
}
const port = Number(process.env.PORT) || 8080;
const server = createProxyServer(setting.config);
server.listen(port, () => console.log(JSON.stringify({ event: "ga4-proxy-started" })));
// Cloud Run の停止要求（SIGTERM）で、受け付け中の処理を終えてから止まる
process.on("SIGTERM", () => server.close(() => process.exit(0)));
