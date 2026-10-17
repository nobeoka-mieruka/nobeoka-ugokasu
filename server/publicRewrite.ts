// 公開ページの静的HTML（ビルド結果）の一部を、配信時にD1の内容で差し替える共通処理です。
//
// ・部分（セクション）ごとにHTMLを組み立て、[data-…] の目印の中身を置き換える。
// ・ある部分の組み立てに失敗しても、その部分だけ静的HTMLのまま残し、ページ自体は必ず表示する。
// ・ログ（public-rewrite-error）には、失敗した部分の名前とエラーの種類だけを出す。

export interface PublicSection {
  /** ログ用の名前 */
  name: string;
  /** 差し替える要素（例："[data-news-home]"） */
  selector: string;
  /** 要素の中身にするHTML（呼び出し側でエスケープ済みのもの） */
  html: () => Promise<string>;
  /** <head> の末尾に追加するHTML（構造化データなど。任意） */
  head?: () => Promise<string>;
}

export async function rewritePublicPage(
  context: EventContext<unknown, string, Record<string, unknown>>,
  sections: PublicSection[],
): Promise<Response> {
  const response = await context.next();
  if (response.status !== 200 || !(response.headers.get("Content-Type") ?? "").includes("text/html")) return response;

  const results = await Promise.all(
    sections.map(async (section) => {
      try {
        return { section, html: await section.html(), head: section.head ? await section.head() : "" };
      } catch (err) {
        console.error(JSON.stringify({ event: "public-rewrite-error", section: section.name, error: err instanceof Error ? err.name : "unknown" }));
        return null;
      }
    }),
  );
  const ready = results.filter((result): result is NonNullable<typeof result> => result !== null);
  if (ready.length === 0) return response;

  const headers = new Headers(response.headers);
  // 内容が静的ファイルと変わるため、静的ファイル用の検証子は外し、毎回最新の内容を確認させる
  headers.delete("ETag");
  headers.delete("Content-Length");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  let rewriter = new HTMLRewriter();
  for (const { section, html } of ready) {
    rewriter = rewriter.on(section.selector, {
      element(el) {
        el.setInnerContent(html, { html: true });
      },
    });
  }
  const headHtml = ready.map((result) => result.head).join("");
  if (headHtml) {
    rewriter = rewriter.on("head", {
      element(el) {
        el.append(headHtml, { html: true });
      },
    });
  }
  return rewriter.transform(new Response(response.body, { status: response.status, headers }));
}
