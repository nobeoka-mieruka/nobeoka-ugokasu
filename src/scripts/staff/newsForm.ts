// お知らせの登録・編集フォームの送信処理（ブラウザで動作）。
// 編集画面（/staff/news/:id/edit/）では、URLの :id の内容をAPIから読み込んでフォームへ入れる。
// 値は input.value / textContent でのみ扱い、HTMLとして解釈しない（XSS対策）。

import { NEWS_CATEGORY_LABELS, type NewsItemRecord } from "../../types/news";
import { todayInJapan } from "../../utils/dialogueEvents";
import { apiErrorMessage, showNotice, staffApi } from "./api";
import { clearFieldErrors, showFieldErrors } from "./formErrors";

const form = document.querySelector<HTMLFormElement>("[data-news-form]");
const notice = document.querySelector<HTMLElement>("[data-staff-notice]");

function field<T extends HTMLElement = HTMLInputElement>(name: string): T {
  return form!.elements.namedItem(name) as unknown as T;
}

function readForm() {
  return {
    publishedOn: field("publishedOn").value,
    category: field<HTMLSelectElement>("category").value,
    title: field("title").value,
    summary: field<HTMLTextAreaElement>("summary").value,
    linkUrl: field("linkUrl").value,
    displayOrder: field("displayOrder").value,
    isPublished: field("isPublished").checked,
  };
}

function fillForm(item: NewsItemRecord): void {
  const category = field<HTMLSelectElement>("category");
  // 「サイト更新」は新規登録では選べない。既存のお知らせがそのカテゴリーの場合だけ選択肢に加える
  if (![...category.options].some((option) => option.value === item.category)) {
    category.add(new Option(`${NEWS_CATEGORY_LABELS[item.category]}（既存データ用）`, item.category));
  }
  field("publishedOn").value = item.publishedOn;
  category.value = item.category;
  field("title").value = item.title;
  field<HTMLTextAreaElement>("summary").value = item.summary;
  field("linkUrl").value = item.linkUrl;
  field("displayOrder").value = String(item.displayOrder);
  field("isPublished").checked = item.isPublished;
}

function editingId(): string | null {
  return /^\/staff\/news\/([1-9]\d{0,9})\/edit\/?$/.exec(location.pathname)?.[1] ?? null;
}

async function init(): Promise<void> {
  if (!form) return;
  const mode = form.dataset.mode;
  const id = mode === "edit" ? editingId() : null;
  const submit = form.querySelector<HTMLButtonElement>("[data-submit]");

  form.querySelectorAll<HTMLButtonElement>("[data-link-example]").forEach((button) => {
    button.addEventListener("click", () => {
      field("linkUrl").value = button.dataset.linkExample ?? "";
      field("linkUrl").focus();
    });
  });

  if (mode === "create") {
    field("publishedOn").value = todayInJapan();
  } else {
    form.classList.add("hidden");
    if (!id) {
      showNotice(notice, "編集するお知らせが指定されていません。一覧から選び直してください。", "error");
      return;
    }
    const result = await staffApi<{ item: NewsItemRecord }>(`/staff/api/news-items/${id}`);
    if (!result.ok || !result.data) {
      showNotice(notice, apiErrorMessage(result, "お知らせ"), "error");
      return;
    }
    fillForm(result.data.item);
    form.classList.remove("hidden");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    if (submit) submit.disabled = true;
    const result = await staffApi<{ item: NewsItemRecord }>(id ? `/staff/api/news-items/${id}` : "/staff/api/news-items", {
      method: id ? "PUT" : "POST",
      body: readForm(),
    });
    if (submit) submit.disabled = false;
    if (result.ok) {
      location.href = `/staff/news/?saved=${id ? "updated" : "created"}`;
      return;
    }
    showNotice(notice, apiErrorMessage(result, "お知らせ"), "error");
    if (result.data?.fields) showFieldErrors(form, result.data.fields);
  });
}

void init();
