// GA4 中継の HTTP サーバー（Cloud Run の入口）。処理の本体は proxy.mjs。
// 起動は main.mjs（PORT・GA4_PROPERTY_ID・PROXY_HMAC_SECRET が必要。詳しくは README.md）

import { createServer } from "node:http";
import { MAX_BODY_BYTES, createProxy } from "./proxy.mjs";

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'",
};

/** HTTPサーバーを作る（テストからも使う）。deps は proxy.mjs の createProxy と同じ */
export function createProxyServer(config, deps = {}) {
  const proxy = createProxy(config, deps);
  const log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const server = createServer((req, res) => {
    const send = (status, body) => {
      if (res.headersSent) return;
      res.writeHead(status, { ...SECURITY_HEADERS, ...(body ? { "Content-Type": "application/json" } : {}) });
      res.end(body || undefined);
    };
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > MAX_BODY_BYTES) {
      send(413, JSON.stringify({ error: "too_large" }));
      req.destroy();
      return;
    }
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        send(413, JSON.stringify({ error: "too_large" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", async () => {
      if (aborted) return;
      try {
        const path = (req.url ?? "/").split("?")[0];
        const result = await proxy.handle({ method: req.method, path, headers: req.headers, body: Buffer.concat(chunks) });
        send(result.status, result.body);
      } catch {
        log({ event: "ga4-proxy-error", kind: "internal" });
        send(500, JSON.stringify({ error: "internal" }));
      }
    });
    req.on("error", () => {});
  });
  // ゆっくり送る接続で居座られないようにする
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
