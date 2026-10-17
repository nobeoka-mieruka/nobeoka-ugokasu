// 執行部ポータルのフォームで、項目ごとの入力エラーを表示・消去する共通処理（ブラウザで動作）。
// 文言は textContent で入れる（HTMLとして解釈しない）。

export function clearFieldErrors(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLElement>("[data-error-for]").forEach((el) => {
    el.textContent = "";
    el.classList.add("hidden");
  });
  form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
}

export function showFieldErrors(form: HTMLFormElement, fields: Record<string, string>): void {
  let first: HTMLElement | null = null;
  for (const [name, message] of Object.entries(fields)) {
    const error = form.querySelector<HTMLElement>(`[data-error-for="${CSS.escape(name)}"]`);
    if (error) {
      error.textContent = message;
      error.classList.remove("hidden");
    }
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLElement) {
      input.setAttribute("aria-invalid", "true");
      first ??= input;
    }
  }
  first?.focus();
}
