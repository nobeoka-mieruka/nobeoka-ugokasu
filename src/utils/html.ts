// サーバー側（Pages Functions）でHTMLを組み立てる際に使う、エスケープ処理です。
// D1など外部から来た値は、必ずこれらを通してから埋め込んでください（XSS対策）。
// Functionsからも読み込むため、実行環境に依存するファイルを import しないでください。

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** <script type="application/ld+json"> へ安全に埋め込めるJSON（</script> などで抜け出せないようにする） */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
