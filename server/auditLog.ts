// 執行部ポータルの操作ログ（D1: staff_audit_log）です。
// ・追加・編集・状態変更・削除を、変更と同じトランザクションで記録する。
// ・操作者のメールアドレスはD1内にのみ保存する。サーバーログ（Cloudflareのログ）には
//   操作の種類・ID・変更した項目名だけを出し、内容やメールアドレスは出さない。

export const AUDIT_SCHEMA_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS staff_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
)`,
  "CREATE INDEX IF NOT EXISTS staff_audit_log_target ON staff_audit_log (target_type, target_id, created_at)",
];

export const nowSeconds = () => Math.floor(Date.now() / 1000);

/** 操作ログを1行追加する文（変更処理と同じ batch に入れて使う） */
export function auditStatement(
  db: D1Database,
  action: string,
  targetType: string,
  targetId: number | string,
  actor: string,
  detail: Record<string, unknown>,
  now: number,
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO staff_audit_log (action, target_type, target_id, actor_email, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(action, targetType, String(targetId), actor, JSON.stringify(detail), now);
}

/** 直前の INSERT で採番された行の操作ログを追加する文（RETURNING と同じ batch の中で使う） */
export function auditLastInsertStatement(
  db: D1Database,
  action: string,
  targetType: string,
  actor: string,
  detail: Record<string, unknown>,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO staff_audit_log (action, target_type, target_id, actor_email, detail, created_at) VALUES (?1, ?2, CAST(last_insert_rowid() AS TEXT), ?3, ?4, ?5)",
    )
    .bind(action, targetType, actor, JSON.stringify(detail), now);
}

/** サーバーログ（内容・メールアドレスは出さない） */
export function logStaffChange(event: string, action: string, id: number, detail: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, action, id, ...detail }));
}
