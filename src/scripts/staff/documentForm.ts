// 資料の登録・編集フォームの送信処理（ブラウザで動作）。
// 編集画面（/staff/documents/:id/edit/）では、URLの :id の内容をAPIから読み込んでフォームへ入れる。
// 値は input.value / textContent でのみ扱い、HTMLとして解釈しない（XSS対策）。

import { DOCUMENT_TYPE_LABELS, type DocumentRecord } from "../../types/documents";
import { detectDocumentType } from "../../utils/documentType";
import { apiErrorMessage, showNotice, staffApi } from "./api";
import { clearFieldErrors, showFieldErrors } from "./formErrors";

const form = document.querySelector<HTMLFormElement>("[data-document-form]");
const notice = document.querySelector<HTMLElement>("[data-staff-notice]");

function field<T extends HTMLElement = HTMLInputElement>(name: string): T {
  return form!.elements.namedItem(name) as unknown as T;
}

function updateTypeHint(): void {
  const hint = form?.querySelector<HTMLElement>("[data-type-hint]");
  if (!hint) return;
  const value = field("url").value.trim();
  // 画面上の目安（実際の判定・保存はサーバー側で同じ関数を使う）
  hint.textContent = value ? `自動判定：${DOCUMENT_TYPE_LABELS[detectDocumentType(value)]}` : "判定できない場合は「その他」になります。";
}

function readForm() {
  return {
    title: field("title").value,
    url: field("url").value,
    category: field<HTMLSelectElement>("category").value,
    documentType: field<HTMLSelectElement>("documentType").value,
    description: field<HTMLTextAreaElement>("description").value,
    displayOrder: field("displayOrder").value,
    pinned: field("pinned").checked,
  };
}

function fillForm(doc: DocumentRecord): void {
  field("title").value = doc.title;
  field("url").value = doc.url;
  field<HTMLSelectElement>("category").value = doc.category;
  field<HTMLSelectElement>("documentType").value = doc.documentType;
  field<HTMLTextAreaElement>("description").value = doc.description;
  field("displayOrder").value = String(doc.displayOrder);
  field("pinned").checked = doc.pinned;
}

function editingId(): string | null {
  return /^\/staff\/documents\/([1-9]\d{0,9})\/edit\/?$/.exec(location.pathname)?.[1] ?? null;
}

async function init(): Promise<void> {
  if (!form) return;
  const mode = form.dataset.mode;
  const id = mode === "edit" ? editingId() : null;
  const submit = form.querySelector<HTMLButtonElement>("[data-submit]");
  field("url").addEventListener("input", updateTypeHint);

  if (mode === "edit") {
    form.classList.add("hidden");
    if (!id) {
      showNotice(notice, "編集する資料が指定されていません。一覧から選び直してください。", "error");
      return;
    }
    const result = await staffApi<{ document: DocumentRecord }>(`/staff/api/documents/${id}`);
    if (!result.ok || !result.data) {
      showNotice(notice, apiErrorMessage(result, "資料"), "error");
      return;
    }
    fillForm(result.data.document);
    form.classList.remove("hidden");
  }
  updateTypeHint();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    if (submit) submit.disabled = true;
    const result = await staffApi<{ document: DocumentRecord }>(id ? `/staff/api/documents/${id}` : "/staff/api/documents", {
      method: id ? "PUT" : "POST",
      body: readForm(),
    });
    if (submit) submit.disabled = false;
    if (result.ok) {
      location.href = `/staff/documents/?saved=${id ? "updated" : "created"}`;
      return;
    }
    showNotice(notice, apiErrorMessage(result, "資料"), "error");
    if (result.data?.fields) showFieldErrors(form, result.data.fields);
  });
}

void init();
