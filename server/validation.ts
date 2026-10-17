// 執行部ポータルの入力値検証で共通に使う処理です（意見交換会・お知らせなど）。
// 画面側の入力補助（maxlength 等）に頼らず、サーバー側で必ずこの検証を通します。

/** 改行・タブ以外の制御文字、および文字の向きを変える制御文字（表示の偽装に使われる）は受け付けない */
export const FORBIDDEN_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 文字数（サロゲートペアの絵文字なども1文字として数える） */
export const charLength = (value: string) => [...value].length;

/** "YYYY-MM-DD" の実在する日付か（2020〜2100年） */
export function isValidDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  if (y < 2020 || y > 2100) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** 文字列項目を検証する。誤りがあれば errors[key] に文言を入れ、整えた値を返す */
export function textField<K extends string>(
  raw: Record<string, unknown>,
  key: K,
  label: string,
  options: { required: boolean; max: number; multiline?: boolean },
  errors: Partial<Record<K, string>>,
): string {
  const value = raw[key];
  if (value !== undefined && value !== null && typeof value !== "string") {
    errors[key] = `${label}の形式が正しくありません。`;
    return "";
  }
  let result = (value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!options.multiline) result = result.replace(/\s+/g, " ");
  if (FORBIDDEN_CHARS.test(result)) errors[key] = `${label}に使用できない文字が含まれています。`;
  else if (options.required && result === "") errors[key] = `${label}を入力してください。`;
  else if (charLength(result) > options.max) errors[key] = `${label}は${options.max}文字以内で入力してください。`;
  return result;
}

/** チェックボックス等の真偽値。解釈できない値は null */
export function boolValue(value: unknown): boolean | null {
  if (value === true || value === "true" || value === "on" || value === "1" || value === 1) return true;
  if (value === false || value === "false" || value === "0" || value === 0 || value === undefined || value === null || value === "") return false;
  return null;
}

/** 整数。空欄は null、解釈できない値は "invalid" */
export function integerValue(value: unknown): number | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : "invalid";
  if (typeof value === "string" && /^-?\d{1,6}$/.test(value.trim())) return Number(value.trim());
  return "invalid";
}

/** URLの :id（正の整数のみ） */
export function parseId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
