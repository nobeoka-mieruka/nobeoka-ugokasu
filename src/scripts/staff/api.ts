// 執行部ポータルの画面から /staff/api/ を呼び出すための共通処理（ブラウザで動作）です。
// CSRFトークンは、配信時にミドルウェアがページ内の <input name="csrf_token"> へ差し込みます。

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: (T & { ok: boolean; error?: string; fields?: Record<string, string> }) | null;
}

function csrfToken(): string {
  return document.querySelector<HTMLInputElement>('input[name="csrf_token"]')?.value ?? "";
}

export async function staffApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") headers["X-CSRF-Token"] = csrfToken();
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const res = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = (await res.json().catch(() => null)) as ApiResult<T>["data"];
    return { ok: res.ok && Boolean(data?.ok), status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/** 失敗時に画面へ表示する文言（内部の情報は表示しない） */
export function apiErrorMessage(result: ApiResult<unknown>): string {
  if (result.status === 401) return "ログインの有効期限が切れました。ページを再読み込みして、もう一度ログインしてください。";
  if (result.status === 403) return "操作を受け付けられませんでした。ページを再読み込みしてからやり直してください。";
  if (result.status === 404) return "対象の意見交換会が見つかりません。すでに削除された可能性があります。";
  if (result.status === 422) return "入力内容を確認してください。";
  if (result.status === 413) return "入力内容が長すぎます。";
  if (result.status === 0) return "通信できませんでした。インターネット接続を確認してから、もう一度お試しください。";
  return "一時的に保存・読み込みができません。時間をおいてから、もう一度お試しください。";
}

/** お知らせ欄（role="status"）へ文言を表示する */
export function showNotice(element: HTMLElement | null, message: string, tone: "error" | "info"): void {
  if (!element) return;
  element.textContent = message;
  element.classList.remove("hidden", "bg-red-50", "text-red-800", "bg-brand-orange-light", "text-ink");
  element.classList.add(...(tone === "error" ? ["bg-red-50", "text-red-800"] : ["bg-brand-orange-light", "text-ink"]));
  element.focus({ preventScroll: false });
}
