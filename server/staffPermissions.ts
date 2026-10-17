// 執行部ポータルの権限です。
//
// 現在は STAFF_ALLOWED_EMAILS に登録された全員が同じ権限（すべての操作が可能）です。
// 将来「代表」「事務局」「閲覧のみ」などの役割を設ける場合は、staffRole() で役割を判定し
// ROLE_PERMISSIONS に役割ごとの権限を定義してください。各APIは hasStaffPermission() だけで判定しているため、
// API側の変更は不要です。

import type { StaffSession } from "./staffAuth";

export type StaffPermission =
  | "dialogue:read"
  | "dialogue:write"
  | "news:read"
  | "news:write"
  | "events:read"
  | "events:write"
  | "tasks:read"
  | "tasks:write"
  | "sns:read"
  | "sns:write"
  | "documents:read"
  | "documents:write";
export type StaffRole = "admin";

const ROLE_PERMISSIONS: Record<StaffRole, readonly StaffPermission[]> = {
  admin: [
    "dialogue:read",
    "dialogue:write",
    "news:read",
    "news:write",
    "events:read",
    "events:write",
    "tasks:read",
    "tasks:write",
    "sns:read",
    "sns:write",
    "documents:read",
    "documents:write",
  ],
};

/** ログイン中の方の役割（現在は全員 admin） */
export function staffRole(_session: StaffSession): StaffRole {
  return "admin";
}

export function hasStaffPermission(session: StaffSession | null | undefined, permission: StaffPermission): boolean {
  if (!session) return false;
  return ROLE_PERMISSIONS[staffRole(session)].includes(permission);
}
